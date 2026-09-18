/**
 * 启动上下文的 daemon 那一半 —— PRD-M8-017 AC-1 / AC-3（`--chat` 也在这里验一次，AC-2）
 *
 * `domi` 不给 kind 时由 daemon 按目录判断：项目 / git 仓库 / 有 AGENT.md → 任务，否则 → 自由会话。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { PROTOCOL_VERSION, type RpcNotification, type RpcResponse } from '@domi/protocol'
import { createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载里删不掉就算了
    }
  }
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-launch-'))
  dirs.push(d)
  return d
}

let n = 0
function daemon() {
  const home = tmp()
  let k = 0
  const host = createRuntimeHost({
    config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
    dbPath: join(home, 'events.db'),
    defaultCwd: home,
    provider: new StubProvider([[{ type: 'delta', text: 'ok' }]], { onExhausted: 'repeat-last' }),
    newId: () => `s${++k}`,
  })
  hosts.push(host)
  const d = new Daemon(host)
  const conn = { id: `c${++n}`, send: (_m: RpcNotification | RpcResponse) => undefined }
  const call = async (method: string, params: unknown = {}): Promise<Record<string, unknown>> => {
    const r = await d.handle(conn, { jsonrpc: '2.0', id: ++n, method, params })
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
    return r.result as Record<string, unknown>
  }
  return { call, home }
}

async function kindOf(call: (m: string, p?: unknown) => Promise<Record<string, unknown>>, id: string) {
  const { sessions } = (await call('session.list', {})) as {
    sessions: Array<{ id: string; kind?: string; projectId?: string }>
  }
  return sessions.find((s) => s.id === id)
}

describe('PRD-M8-017 AC-1 · 按目录判断开任务还是自由会话', () => {
  test('git 仓库里 → 任务，并自动登记项目', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const repo = tmp()
    execSync('git init -q', { cwd: repo })
    const { sessionId } = (await call('session.create', { cwd: repo })) as { sessionId: string }
    const row = await kindOf(call, sessionId)
    expect(row?.kind).toBe('task')
    expect(row?.projectId).toBeDefined()
  })

  test('有 AGENT.md 的目录 → 任务', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const dir = tmp()
    writeFileSync(join(dir, 'AGENT.md'), '# 规矩')
    const { sessionId } = (await call('session.create', { cwd: dir })) as { sessionId: string }
    expect((await kindOf(call, sessionId))?.kind).toBe('task')
  })

  test('已登记项目的子目录 → 任务，归到那个项目', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const repo = tmp()
    execSync('git init -q', { cwd: repo })
    const { project } = (await call('project.create', { path: repo })) as { project: { id: string } }
    const sub = join(repo, 'packages', 'core')
    mkdirSync(sub, { recursive: true })
    const { sessionId } = (await call('session.create', { cwd: sub })) as { sessionId: string }
    const row = await kindOf(call, sessionId)
    expect(row).toMatchObject({ kind: 'task', projectId: project.id })
  })

  test('普通目录 → 自由会话（工作目录换成沙盒）', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const { sessionId } = (await call('session.create', { cwd: tmp() })) as { sessionId: string }
    expect((await kindOf(call, sessionId))?.kind).toBe('chat')
  })
})

describe('PRD-M8-017 AC-2 · --chat 强制自由会话', () => {
  test('--chat 在仓库里也开自由会话', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const repo = tmp()
    execSync('git init -q', { cwd: repo })
    const { sessionId } = (await call('session.create', { kind: 'chat' })) as { sessionId: string }
    expect((await kindOf(call, sessionId))?.kind).toBe('chat')
  })
})

describe('PRD-M8-017 AC-3 · 打开已有会话不改 kind', () => {
  test('自由会话在仓库目录里被打开，仍然是自由会话', async () => {
    const { call } = daemon()
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'tui' })
    const { sessionId } = (await call('session.create', { kind: 'chat' })) as { sessionId: string }
    await call('session.subscribe', { sessionId, fromSeq: 0 })
    await call('session.submit', { sessionId, text: '你好' })
    await Bun.sleep(200)
    expect((await kindOf(call, sessionId))?.kind).toBe('chat')
  })
})
