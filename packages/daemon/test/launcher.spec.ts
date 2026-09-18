/**
 * PRD-M3-002 AC-4 · `domi` 在 daemon 未运行时自动拉起，并发调用只拉起一个实例
 *
 * 全是真进程：真 spawn、真锁、真端口。不发模型请求（INV-08），凭据是假的。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomiClient, type WireSocket } from '@domi/client-core'
import { DaemonStartError, daemonPaths, ensureDaemon, findDaemon, isAlive, readLock } from '../src/index.ts'

const MAIN = join(import.meta.dir, '../src/main.ts')
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) {
    const info = readLock(daemonPaths(home).lock)
    if (info && isAlive(info.pid)) {
      process.kill(info.pid, 'SIGTERM')
      for (let i = 0; i < 50 && isAlive(info.pid); i++) await Bun.sleep(20)
    }
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  }
})

function newHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'domi-launch-'))
  homes.push(h)
  return h
}

const env = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  DOMI_API_KEY: 'test-not-a-real-key',
  DOMI_PORT: '0',
  ...extra,
})

describe('自动拉起', () => {
  test('没有 daemon → 拉起一个，客户端能连上；再调一次复用同一个', async () => {
    const home = newHome()
    const first = await ensureDaemon({ home, command: ['bun', MAIN], env: env() })
    expect(first.spawned).toBe(true)
    expect(first.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)

    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(first.url) as unknown as WireSocket,
    })
    await client.start()
    client.close()

    const again = await ensureDaemon({ home, command: ['bun', MAIN], env: env() })
    expect(again).toEqual({ ...first, spawned: false })
  }, 30_000)

  test('三个 domi 同时启动 → 只有一个 domid，大家连的是同一个', async () => {
    const home = newHome()
    const results = await Promise.all([0, 1, 2].map(() => ensureDaemon({ home, command: ['bun', MAIN], env: env() })))
    expect(new Set(results.map((r) => r.pid)).size).toBe(1)
    expect(new Set(results.map((r) => r.url)).size).toBe(1)
    expect(results.filter((r) => r.spawned)).toHaveLength(1)
    expect(await findDaemon(home)).toMatchObject({ pid: results[0]?.pid })
  }, 30_000)

  test('崩溃留下的陈锁（进程已死）不挡路', async () => {
    const home = newHome()
    const { lock } = daemonPaths(home)
    mkdirSync(join(home, '.domi'), { recursive: true })
    writeFileSync(lock, JSON.stringify({ pid: 2147483647, port: 1, startedAt: 1 }), 'utf8')
    expect(await findDaemon(home)).toBeNull()
    const r = await ensureDaemon({ home, command: ['bun', MAIN], env: env() })
    expect(r.spawned).toBe(true)
  }, 30_000)

  // 以前用「没有凭据」造起不来的 domid；OPT-M8-001 之后没 key 也能起，改用写坏的配置文件
  test('domid 自己起不来（配置文件写坏了）→ 报错里带日志路径和日志内容，而不是傻等', async () => {
    const home = newHome()
    mkdirSync(join(home, '.domi'), { recursive: true })
    writeFileSync(join(home, '.domi', 'config.yaml'), 'model: [没闭合\n')
    const started = Date.now()
    const err = await ensureDaemon({
      home,
      command: ['bun', MAIN],
      env: { PATH: process.env.PATH ?? '', DOMI_PORT: '0' },
      timeoutMs: 15_000,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DaemonStartError)
    expect((err as Error).message).toContain(daemonPaths(home).log)
    expect((err as Error).message).toContain('config.yaml')
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 30_000)
})
