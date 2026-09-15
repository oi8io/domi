/**
 * PRD-M3-006 AC-1 · `domi --connect ws://host:port`：不拉起本地 domid，带着 token 直接连过去
 *
 * 「远程」在测试里是本进程起的一个要求 token 的 daemon——对 TUI 的接线来说，
 * 它和另一台机器上的 domid 没有区别：只有一个地址和一个 token。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Daemon, type DaemonHost, daemonPaths, serveWs, type WsServer } from '@domi/daemon'
import type { EventEnvelope } from '@domi/protocol'
import { connectChat, RemoteConnectError } from '../src/connect.ts'

const TOKEN = 'remote-token-remote-token-remote'
const servers: WsServer[] = []
const closers: Array<() => void> = []
afterEach(async () => {
  for (const c of closers.splice(0)) c()
  for (const s of servers.splice(0)) await s.stop()
})

function memHost(): DaemonHost {
  const created: string[] = []
  return {
    async open(id) {
      return {
        id,
        async submit() {},
        async switchModel() {
          return { lost: [] }
        },
        async compactNow() {
          return { ok: false, detail: '' }
        },
        async readEvents(): Promise<EventEnvelope[]> {
          return []
        },
        async head() {
          return 0
        },
        async close() {},
      }
    },
    async create() {
      created.push(`r${created.length + 1}`)
      return created.at(-1) as string
    },
    async list() {
      return []
    },
    async remove() {},
    async restore() {},
    async branch() {
      return 'b'
    },
    onEvents() {},
  }
}

describe('--connect', () => {
  test('带 token 连上远程 daemon，建会话、订阅；本地不拉起任何进程', async () => {
    const s = serveWs(new Daemon(memHost()), { hostname: '0.0.0.0', port: 0, token: TOKEN })
    servers.push(s)
    const home = mkdtempSync(join(tmpdir(), 'domi-remote-'))
    const conn = await connectChat({
      home,
      cwd: home,
      model: { provider: 'x', name: 'y' },
      connect: `ws://127.0.0.1:${s.port}`,
      token: TOKEN,
    })
    closers.push(() => conn.client.close())
    expect(conn.daemon).toMatchObject({ url: `ws://127.0.0.1:${s.port}`, spawned: false })
    expect(conn.sessionId).toBe('r1')
    expect(existsSync(daemonPaths(home).lock)).toBe(false)
  })

  test('token 不对：说清楚是认证没过、去哪拿 token，而不是一直重连', async () => {
    const s = serveWs(new Daemon(memHost()), { hostname: '0.0.0.0', port: 0, token: TOKEN })
    servers.push(s)
    const home = mkdtempSync(join(tmpdir(), 'domi-remote-'))
    const attempt = connectChat({
      home,
      cwd: home,
      model: { provider: 'x', name: 'y' },
      connect: `ws://127.0.0.1:${s.port}`,
      token: 'wrong-wrong-wrong-wrong-wrong-wr',
    })
    const err = await attempt.then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(RemoteConnectError)
    expect(String((err as Error).message)).toContain('DOMI_TOKEN')
    expect(String((err as Error).message)).toContain('daemon.token')
  }, 10_000)
})
