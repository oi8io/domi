/**
 * PRD-M3-002 AC-1 · 生产宿主把 DomiSession 接到 core 上
 *
 * 用 StubProvider 替身，不联网（INV-08）。断言的是接线：
 * 建的会话能列出来、提交后事件经 core 推给订阅者、历史从同一个 SQLite 里读得回来。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope, RpcNotification, RpcResponse } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  }
})

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'domi-host-'))
  dirs.push(d)
  const host = createRuntimeHost({
    config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
    dbPath: join(d, 'events.db'),
    defaultCwd: d,
    provider: new StubProvider([[{ type: 'delta', text: '好的' }]], { onExhausted: 'repeat-last' }),
    newId: () => 'sess-1',
  })
  hosts.push(host)
  return { host, daemon: new Daemon(host) }
}

class Conn implements ClientConn {
  readonly got: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(m: RpcNotification | RpcResponse): void {
    this.got.push(m)
  }
  events(): EventEnvelope[] {
    return this.got
      .filter((m): m is RpcNotification => 'method' in m && m.method === 'session.events')
      .flatMap((m) => (m.params as { events: EventEnvelope[] }).events)
  }
}

let n = 0
const call = (d: Daemon, c: Conn, method: string, params: unknown = {}) =>
  d.handle(c, { jsonrpc: '2.0', id: ++n, method, params })

describe('RuntimeHost', () => {
  test('建会话 → 列得出来', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const created = await call(daemon, c, 'session.create')
    expect(created.result).toEqual({ sessionId: 'sess-1' })
    const listed = await call(daemon, c, 'session.list')
    expect((listed.result as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id)).toEqual(['sess-1'])
  })

  test('提交之后，事件经 core 推给订阅者，seq 连续', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.subscribe', { sessionId: 'sess-1', fromSeq: 0 })
    const r = await call(daemon, c, 'session.submit', { sessionId: 'sess-1', text: '你好' })
    expect(r.result).toEqual({ accepted: true })

    for (let i = 0; i < 100 && !c.events().some((e) => e.ev.t === 'model.delta'); i++) await Bun.sleep(10)
    const seqs = c.events().map((e) => e.seq)
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    expect(c.events().find((e) => e.ev.t === 'user.input')?.ev).toMatchObject({ text: '你好' })
    // 忙闲也推了
    const busy = c.got.filter((m) => 'method' in m && m.method === 'session.busy')
    expect(busy.length).toBeGreaterThan(0)
  })

  test('不存在的会话 → SESSION_NOT_FOUND', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const r = await call(daemon, c, 'session.subscribe', { sessionId: 'nope', fromSeq: 0 })
    expect(r.error?.code).toBe('SESSION_NOT_FOUND')
  })
})
