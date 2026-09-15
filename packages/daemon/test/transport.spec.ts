/**
 * PRD-M3-002 AC-1 · PRD-M3-006 AC-2 · 真 WebSocket 往返
 *
 * core 的正确性在 daemon.spec 里证过了；这里只证传输层没把它弄坏，
 * 以及两道本地边界（只监听回环、浏览器来源必须是本机）是真的挡得住。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createSessionStore, DomiClient, type WireSocket } from '@domi/client-core'
import type { EventEnvelope } from '@domi/protocol'
import {
  Daemon,
  type DaemonHost,
  DEFAULT_HOSTNAME,
  isAllowedOrigin,
  NonLocalListenError,
  type SessionHandle,
  SessionNotFoundError,
  serveWs,
  type WsServer,
} from '../src/index.ts'

const servers: WsServer[] = []
const clients: DomiClient[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  for (const s of servers.splice(0)) await s.stop()
})

/** 一个会回声的内存宿主：submit 之后追加一条 model.delta */
function echoHost(): DaemonHost {
  const events: EventEnvelope[] = []
  let emit: ((s: string, e: EventEnvelope[]) => void) | null = null
  const handle: SessionHandle = {
    id: 's1',
    async submit(text) {
      const e: EventEnvelope = {
        seq: events.length + 1,
        sessionId: 's1',
        parentSeq: null,
        ts: 1_700_000_000_000,
        schemaVersion: 5,
        ev: { t: 'model.delta', text: `回声：${text}` },
      }
      events.push(e)
      emit?.('s1', [e])
    },
    async compactNow() {
      return { ok: false, detail: '' }
    },
    async switchModel() {
      return { lost: [] }
    },
    async readEvents(from) {
      return events.filter((e) => e.seq > from)
    },
    async head() {
      return events.length
    },
    async close() {},
  }
  return {
    async open(id) {
      if (id !== 's1') throw new SessionNotFoundError(id)
      return handle
    },
    async create() {
      return 's1'
    },
    async list() {
      return []
    },
    async remove() {},
    async restore() {},
    async branch() {
      return 's2'
    },
    onEvents(cb) {
      emit = cb
    },
  }
}

function start(): WsServer {
  const s = serveWs(new Daemon(echoHost()), { port: 0 })
  servers.push(s)
  return s
}

describe('PRD-M3-006 AC-2 · 默认只监听本地', () => {
  test('不传 hostname 时监听 127.0.0.1', () => {
    expect(DEFAULT_HOSTNAME).toBe('127.0.0.1')
    expect(start().hostname).toBe('127.0.0.1')
  })

  test('非回环地址不带 token 直接拒绝（认证见 auth.spec.ts）', () => {
    expect(() => serveWs(new Daemon(echoHost()), { hostname: '0.0.0.0', port: 0 })).toThrow(NonLocalListenError)
    expect(() => serveWs(new Daemon(echoHost()), { hostname: '0.0.0.0', port: 0, token: null })).toThrow(
      NonLocalListenError,
    )
  })
})

describe('浏览器来源必须是本机页面（跨站 WebSocket 劫持）', () => {
  test('来源判定', () => {
    expect(isAllowedOrigin(null)).toBe(true) // 命令行客户端不带 Origin
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:7437')).toBe(true)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false)
    expect(isAllowedOrigin('not a url')).toBe(false)
  })

  test('外站来源的升级请求被 403 挡在握手之前', async () => {
    const s = start()
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      headers: {
        Origin: 'https://evil.example',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    expect(res.status).toBe(403)
  })
})

describe('PRD-M3-002 AC-1 · 客户端经真 WebSocket 连上 daemon', () => {
  test('握手 → 订阅 → 提交 → 事件推到 store', async () => {
    const s = start()
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(s.url) as unknown as WireSocket,
    })
    clients.push(client)
    const hs = await client.start()
    expect(hs.methods).toContain('session.subscribe')

    const store = createSessionStore()
    await client.watch('s1', store)
    await client.submit('s1', '你好')
    for (let i = 0; i < 50 && store.$items.get().length === 0; i++) await Bun.sleep(10)
    expect(store.$items.get().map((x) => x.text)).toEqual(['回声：你好'])
  })

  test('服务端关掉之后客户端状态变成 closed，而不是一直显示已连接', async () => {
    const s = start()
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(s.url) as unknown as WireSocket,
    })
    clients.push(client)
    await client.start()
    await s.stop()
    servers.splice(servers.indexOf(s), 1)
    for (let i = 0; i < 50 && client.$state.get() === 'open'; i++) await Bun.sleep(10)
    expect(client.$state.get()).toBe('closed')
  })
})
