/**
 * PRD-M3-002 AC-1 / AC-4 · domid 是独立进程，并发拉起只有一个活下来
 *
 * lock.spec 在函数层证了 O_EXCL；这里在**进程层**再证一次：
 * 真起一个 domid，真用 WebSocket 连上去，再起第二个看它是不是拿着第一个的端口退出。
 * 不发任何模型请求（只握手、建会话、列会话），所以凭据是假的也没关系（INV-08）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomiClient, DomiRpcError, missingCredentialOf, type WireSocket } from '@domi/client-core'
import { EXIT_LOCK_HELD } from '../src/main.ts'

const MAIN = join(import.meta.dir, '../src/main.ts')
const dirs: string[] = []
const procs: Bun.Subprocess[] = []
afterEach(() => {
  for (const p of procs.splice(0)) p.kill()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载：不因清理失败而报红
    }
  }
})

function env(home: string, withKey = true): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    ...(withKey ? { ANTHROPIC_API_KEY: 'test-not-a-real-key' } : {}),
    DOMI_PORT: '0',
  }
}

function spawnDomid(home: string, cwd: string, withKey = true): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  const p = Bun.spawn(['bun', MAIN], {
    env: env(home, withKey),
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  procs.push(p)
  return p
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  let buf = ''
  while (!buf.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    buf += new TextDecoder().decode(value)
  }
  reader.releaseLock()
  return buf.split('\n')[0] ?? ''
}

describe('domid 独立进程', () => {
  test('起来之后第一行报地址；客户端能握手、建会话、列出会话', async () => {
    const home = mkdtempSync(join(tmpdir(), 'domid-'))
    dirs.push(home)
    const p = spawnDomid(home, home)
    const line = await firstLine(p.stdout)
    expect(line).toMatch(/^domid listening ws:\/\/127\.0\.0\.1:\d+$/)
    const url = line.replace('domid listening ', '')

    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(url) as unknown as WireSocket,
    })
    await client.start()
    const id = await client.createSession()
    const { sessions } = await client.listSessions()
    expect(sessions.map((s) => s.id)).toContain(id)
    client.close()

    p.kill('SIGTERM')
    await p.exited
    // 正常退出会释放锁
    expect(existsSync(join(home, '.domi', 'domid.lock'))).toBe(false)
  }, 20_000)

  test('第二个 domid 拿着第一个的端口退出，不会起两份', async () => {
    const home = mkdtempSync(join(tmpdir(), 'domid-'))
    dirs.push(home)
    const first = spawnDomid(home, home)
    const url = (await firstLine(first.stdout)).replace('domid listening ', '')
    const port = url.split(':').pop() ?? ''

    const second = spawnDomid(home, home)
    const code = await second.exited
    const err = await new Response(second.stderr).text()
    expect(code).toBe(EXIT_LOCK_HELD)
    // 锁里记的是真实端口（DOMI_PORT=0 时系统挑的那个），不是请求的 0
    expect(err).toContain(`端口 ${port}`)
  }, 20_000)

  test('OPT-M8-001 没有 key 也能起；提交被拒并指明缺哪一家，设置页填上后同一个会话直接能发', async () => {
    const home = mkdtempSync(join(tmpdir(), 'domid-'))
    dirs.push(home)
    const p = spawnDomid(home, home, false)
    const line = await firstLine(p.stdout)
    expect(line).toMatch(/^domid listening ws:\/\/127\.0\.0\.1:\d+$/)
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(line.replace('domid listening ', '')) as unknown as WireSocket,
    })
    await client.start()
    expect((await client.getSettings()).secrets.anthropic?.set).toBe(false)

    const id = await client.createSession()
    const err = await client.submit(id, '你好').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DomiRpcError)
    expect((err as DomiRpcError).code).toBe('INVALID_PARAMS')
    expect((err as DomiRpcError).data).toMatchObject({
      reason: 'MISSING_CREDENTIAL',
      messageKey: 'error.missing_credential',
      provider: 'anthropic',
    })
    expect((err as DomiRpcError).message).toContain('设置 › 模型供应商')
    expect(missingCredentialOf(err)).toBe('anthropic')
    // 被拒的提交不占着会话：填完 key 马上能再发
    // base_url 指向一个不会有人听的本地端口：只证「被接受了」，不真的出网（INV-08）
    await client.setSettings({
      'providers.anthropic.api_key': 'test-not-a-real-key',
      'providers.anthropic.base_url': 'http://127.0.0.1:9',
    })
    expect(await client.submit(id, '你好')).toMatchObject({ accepted: true })
    client.close()
    p.kill('SIGTERM')
    await p.exited
  }, 20_000)
})
