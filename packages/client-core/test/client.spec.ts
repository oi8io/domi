/**
 * PRD-M3-001 AC-2 / PRD-M3-002 AC-2 · 客户端那一半
 *
 * daemon 那一半（按 lastSeq 推、不降级）在 packages/daemon/test 里测过了。
 * 这里测的是**客户端自己也要守住的三件事**：版本不对就停、断线后按锚点续订、重复的 seq 不进 store。
 * 用一个脚本化的假 socket，不起网络——真 WebSocket 的往返在 daemon 的 transport 测试里。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { createSessionStore, DomiClient, DomiRpcError, type WireSocket } from '../src/index.ts'

type Listener = (ev: { data: unknown }) => void

/** 假 socket：记下发出去的请求，由测试决定怎么回 */
class FakeSocket implements WireSocket {
  readyState = 0
  readonly sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = []
  private readonly on: Record<string, Array<(ev: { data: unknown }) => void>> = {}
  constructor(private readonly reply: (req: FakeSocket['sent'][number], sock: FakeSocket) => unknown) {
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open')
    })
  }
  addEventListener(type: string, fn: Listener | (() => void)): void {
    const list = this.on[type] ?? []
    list.push(fn as Listener)
    this.on[type] = list
  }
  send(data: string): void {
    const req = JSON.parse(data) as FakeSocket['sent'][number]
    this.sent.push(req)
    const r = this.reply(req, this)
    if (r !== undefined) queueMicrotask(() => this.push({ jsonrpc: '2.0', id: req.id, ...(r as object) }))
  }
  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.emit('close'))
  }
  push(msg: unknown): void {
    this.emit('message', { data: JSON.stringify(msg) })
  }
  private emit(type: string, ev: { data: unknown } = { data: null }): void {
    for (const fn of this.on[type] ?? []) fn(ev)
  }
}

const okHandshake = { result: { protocolVersion: PROTOCOL_VERSION, serverVersion: 't', methods: [] } }

function ev(seq: number, text: string): EventEnvelope {
  return {
    seq,
    sessionId: 's1',
    parentSeq: null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 5,
    ev: { t: 'model.delta', text },
  }
}

/** 手动推进的定时器：重连时机由测试掌握，不靠 sleep */
function manualTimers() {
  const queue: Array<() => void> = []
  return {
    timers: { set: (fn: () => void) => queue.push(fn), clear: () => undefined },
    fire: () => {
      for (const fn of queue.splice(0)) fn()
    },
    get size() {
      return queue.length
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('握手不降级', () => {
  test('版本不匹配 → start() 抛 PROTOCOL_VERSION_MISMATCH，停在 incompatible，不重连', async () => {
    const t = manualTimers()
    let connects = 0
    const client = new DomiClient({
      clientName: 'test',
      protocolVersion: 999,
      reconnectMs: 10,
      timers: t.timers,
      connect: () => {
        connects++
        return new FakeSocket((req) =>
          req.method === 'handshake'
            ? {
                error: {
                  code: 'PROTOCOL_VERSION_MISMATCH',
                  message: '不匹配',
                  data: { clientVersion: 999, serverVersion: 1 },
                },
              }
            : undefined,
        )
      },
    })
    const err = await client.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DomiRpcError)
    expect((err as DomiRpcError).code).toBe('PROTOCOL_VERSION_MISMATCH')
    await tick()
    expect(client.$state.get()).toBe('incompatible')
    expect(t.size).toBe(0) // 没有排上重连
    expect(connects).toBe(1)
  })
})

describe('断线重连 + 断点续订', () => {
  test('重连后用最后收到的 seq 续订，断开期间的事件补回来且不重复', async () => {
    const t = manualTimers()
    const sockets: FakeSocket[] = []
    const onDaemon = [ev(1, 'a'), ev(2, 'b'), ev(3, 'c')]
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 10,
      timers: t.timers,
      connect: () => {
        const s = new FakeSocket((req, sock) => {
          if (req.method === 'handshake') return okHandshake
          if (req.method === 'session.subscribe') {
            // daemon 的行为：补发 fromSeq 之后的历史
            const from = req.params.fromSeq as number
            const history = onDaemon.filter((e) => e.seq > from)
            if (history.length > 0)
              sock.push({ jsonrpc: '2.0', method: 'session.events', params: { sessionId: 's1', events: history } })
            return { result: { head: onDaemon.length } }
          }
          return undefined
        })
        sockets.push(s)
        return s
      },
    })
    await client.start()
    const store = createSessionStore()
    const first = sockets[0]!
    await client.watch('s1', store)
    await tick()
    expect(client.lastSeq('s1')).toBe(3)

    // 收到 1..3 之后掉线
    first.close()
    await tick()
    expect(client.$state.get()).toBe('reconnecting')
    // 掉线期间 daemon 上的任务还在跑
    onDaemon.push(ev(4, 'd'))

    t.fire()
    await tick()
    expect(client.$state.get()).toBe('open')
    const resub = sockets[1]!.sent.find((r) => r.method === 'session.subscribe')
    expect(resub?.params).toEqual({ sessionId: 's1', fromSeq: 3 })
    // 投影里 a b c d 各一次，拼成一条 assistant 文本
    expect(store.$items.get().map((i) => i.text)).toEqual(['abcd'])
    expect(client.lastSeq('s1')).toBe(4)
  })
})

describe('去重', () => {
  test('同一个 seq 推两次只进 store 一次；乱序到达按 seq 排好', async () => {
    let sock: FakeSocket | null = null
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => {
        sock = new FakeSocket((req) =>
          req.method === 'handshake'
            ? okHandshake
            : req.method === 'session.subscribe'
              ? { result: { head: 0 } }
              : undefined,
        )
        return sock
      },
    })
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    const s = sock as unknown as FakeSocket
    s.push({ jsonrpc: '2.0', method: 'session.events', params: { sessionId: 's1', events: [ev(2, 'b'), ev(1, 'a')] } })
    s.push({ jsonrpc: '2.0', method: 'session.events', params: { sessionId: 's1', events: [ev(2, 'b'), ev(3, 'c')] } })
    expect(store.$items.get().map((i) => i.text)).toEqual(['abc'])
    expect(client.lastSeq('s1')).toBe(3)
  })

  test('没订阅的会话推过来的事件不进任何 store', async () => {
    let sock: FakeSocket | null = null
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => {
        sock = new FakeSocket((req) => (req.method === 'handshake' ? okHandshake : undefined))
        return sock
      },
    })
    await client.start()
    ;(sock as unknown as FakeSocket).push({
      jsonrpc: '2.0',
      method: 'session.events',
      params: { sessionId: 'other', events: [ev(1, 'x')] },
    })
    expect(client.lastSeq('other')).toBe(0)
  })
})

describe('询问与指标投影进 store', () => {
  async function connected() {
    let sock: FakeSocket | null = null
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => {
        sock = new FakeSocket((req) =>
          req.method === 'handshake'
            ? okHandshake
            : req.method === 'session.subscribe'
              ? { result: { head: 0 } }
              : req.method === 'session.answer'
                ? { result: { ok: true } }
                : undefined,
        )
        return sock
      },
    })
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    return { client, store, sock: sock as unknown as FakeSocket }
  }

  test('session.ask → $ask 带上 askId；只有同一个 askId 的 askDone 才清掉它', async () => {
    const { client, store, sock } = await connected()
    const note = (method: string, params: unknown) => sock.push({ jsonrpc: '2.0', method, params })
    note('session.ask', { askId: 'k2', sessionId: 's1', capabilityId: 'fs.write', detail: '{}' })
    expect(store.$ask.get()).toEqual({ askId: 'k2', capabilityId: 'fs.write', detail: '{}' })

    note('session.askDone', { sessionId: 's1', askId: 'k1', allowed: true }) // 旧的那个
    expect(store.$ask.get()?.askId).toBe('k2')

    expect(await client.answer('k2', false)).toBe(true)
    expect(sock.sent.at(-1)).toMatchObject({ method: 'session.answer', params: { askId: 'k2', allowed: false } })
    // 回答本身不清框，等 daemon 的 askDone
    expect(store.$ask.get()?.askId).toBe('k2')
    note('session.askDone', { sessionId: 's1', askId: 'k2', allowed: false })
    expect(store.$ask.get()).toBeNull()
  })

  test('表单型询问：form 进 store；回答时带上内容', async () => {
    const { client, store, sock } = await connected()
    sock.push({
      jsonrpc: '2.0',
      method: 'session.ask',
      params: {
        askId: 'f1',
        sessionId: 's1',
        capabilityId: 'mcp.x.input',
        detail: '填一下',
        form: { message: '填一下', schema: { type: 'object' } },
      },
    })
    expect(store.$ask.get()?.form).toEqual({ message: '填一下', schema: { type: 'object' } })
    await client.answer('f1', true, { env: 'prod' })
    expect(sock.sent.at(-1)).toMatchObject({ params: { askId: 'f1', allowed: true, content: { env: 'prod' } } })
  })

  test('session.metrics → 状态栏的模型与指标', async () => {
    const { store, sock } = await connected()
    sock.push({
      jsonrpc: '2.0',
      method: 'session.metrics',
      params: {
        sessionId: 's1',
        metrics: {
          provider: 'anthropic',
          model: 'glm',
          tokens: { input: 1200, output: 30, cacheRead: 0 },
          cost: '—',
          contextPercent: 72,
          contextLevel: 'warn',
          unpricedModels: ['glm'],
        },
      },
    })
    const st = store.$status.get()
    expect(st.provider).toBe('anthropic')
    expect(st.model).toBe('glm')
    expect(st.metrics?.contextLevel).toBe('warn')
    expect(st.metrics).not.toHaveProperty('model')
  })
})
