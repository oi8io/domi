/**
 * PRD-M13-001 / PRD-M13-002 · 端上的补充与中断（SPEC-M13-001 取舍-6 · SPEC-M13-002 取舍-5）
 *
 * 本地副本：发出去的补充记着，直到看到它送达（user.note 或 user.input.noteIds）、被退回、或撤回成功。
 * 重连后 daemon 那边没有它、也没见它送达 → 当作退回，文字回到输入框（daemon 重启丢了队列）。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { createSessionStore, DomiClient, type WireSocket } from '../src/index.ts'

type Listener = (ev: { data: unknown }) => void
type Req = { id: number; method: string; params: Record<string, unknown> }

class FakeSocket implements WireSocket {
  readyState = 0
  readonly sent: Req[] = []
  private readonly on: Record<string, Listener[]> = {}
  constructor(private readonly reply: (req: Req, sock: FakeSocket) => unknown) {
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
    const req = JSON.parse(data) as Req
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
  notify(method: string, params: unknown): void {
    this.push({ jsonrpc: '2.0', method, params })
  }
  private emit(type: string, ev: { data: unknown } = { data: null }): void {
    for (const fn of this.on[type] ?? []) fn(ev)
  }
}

const okHandshake = { result: { protocolVersion: PROTOCOL_VERSION, serverVersion: 't', methods: [] } }
const tick = () => new Promise((r) => setTimeout(r, 5))
const env = (seq: number, ev: EventEnvelope['ev']): EventEnvelope => ({
  seq,
  sessionId: 's1',
  parentSeq: null,
  ts: seq,
  schemaVersion: 15,
  ev,
})

/** 一个 daemon 替身：note 回 queued（依次 n-1、n-2…），subscribe 可选推一份队列快照 */
function setup(opts: { snapshotOnSubscribe?: () => unknown[] | undefined } = {}) {
  const sockets: FakeSocket[] = []
  const queue: Array<() => void> = []
  let n = 0
  const client = new DomiClient({
    clientName: 'domi-web',
    reconnectMs: 10,
    timers: { set: (fn: () => void) => queue.push(fn), clear: () => undefined },
    connect: () => {
      const s = new FakeSocket((req, sock) => {
        if (req.method === 'handshake') return okHandshake
        if (req.method === 'session.subscribe') {
          const snap = opts.snapshotOnSubscribe?.()
          if (snap) sock.notify('session.notes', { sessionId: 's1', pending: snap })
          return { result: { head: 0 } }
        }
        if (req.method === 'session.note') return { result: { state: 'queued', noteId: `n-${++n}` } }
        if (req.method === 'session.note.withdraw') return { result: { withdrawn: true } }
        if (req.method === 'session.interrupt') return { result: { interrupted: true } }
        return undefined
      })
      sockets.push(s)
      return s
    },
  })
  const reconnect = async () => {
    sockets.at(-1)!.close()
    await tick()
    for (const fn of queue.splice(0)) fn()
    await tick()
  }
  return { client, sockets, reconnect, sock: () => sockets.at(-1)! }
}

describe('PRD-M13-001 AC-5 · 发补充、看队列', () => {
  test('note() 发 session.note；daemon 推的队列进 $notes', async () => {
    const { client, sock } = setup()
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    const r = await client.note('s1', '顺便跑测试')
    expect(r).toEqual({ state: 'queued', noteId: 'n-1' })
    expect(sock().sent.find((x) => x.method === 'session.note')?.params).toEqual({
      sessionId: 's1',
      text: '顺便跑测试',
    })
    sock().notify('session.notes', { sessionId: 's1', pending: [{ id: 'n-1', text: '顺便跑测试', from: 'domi-web' }] })
    await tick()
    expect(store.$notes.get()).toEqual([{ id: 'n-1', text: '顺便跑测试', from: 'domi-web' }])
  })

  test('user.note 投影成带 note 标记的用户项', () => {
    const store = createSessionStore()
    store.applyEvents([env(1, { t: 'user.note', id: 'n-1', text: '补一句' })])
    expect(store.$items.get()).toEqual([expect.objectContaining({ kind: 'user', note: true, text: '补一句', seq: 1 })])
  })
})

describe('PRD-M13-001 AC-7 · 退回进草稿，只进发送它的那个端', () => {
  test('returned 里有自己发的 → $returned；别人发的 → 不管', async () => {
    const { client, sock } = setup()
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    await client.note('s1', '我的补充')
    sock().notify('session.notes.returned', {
      sessionId: 's1',
      notes: [
        { id: 'n-1', text: '我的补充', from: 'domi-web' },
        { id: 'x-9', text: '别人的补充', from: 'domi-tui' },
      ],
    })
    await tick()
    expect(store.takeReturned()).toEqual(['我的补充'])
    expect(store.takeReturned()).toEqual([])
  })

  test('重连后 daemon 没有它、也没见它送达 → 退回（daemon 重启丢了队列）', async () => {
    const { client, reconnect } = setup()
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    await client.note('s1', '丢在半路')
    await reconnect()
    expect(store.takeReturned()).toEqual(['丢在半路'])
  })

  test('重连后 daemon 的队列里还有它 → 不退回', async () => {
    let snap: unknown[] | undefined
    const { client, reconnect } = setup({ snapshotOnSubscribe: () => snap })
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    await client.note('s1', '还排着')
    snap = [{ id: 'n-1', text: '还排着' }]
    await reconnect()
    expect(store.takeReturned()).toEqual([])
  })

  test('见到送达（user.note 或 user.input.noteIds）之后，重连不再退回', async () => {
    const { client, reconnect, sock } = setup()
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    await client.note('s1', '甲')
    await client.note('s1', '乙')
    sock().notify('session.events', {
      sessionId: 's1',
      events: [
        env(1, { t: 'user.note', id: 'n-1', text: '甲' }),
        env(2, { t: 'user.input', text: '乙', noteIds: ['n-2'] }),
      ],
    })
    await tick()
    await reconnect()
    expect(store.takeReturned()).toEqual([])
  })

  test('撤回成功的不再退回', async () => {
    const { client, reconnect } = setup()
    await client.start()
    const store = createSessionStore()
    await client.watch('s1', store)
    await client.note('s1', '撤掉')
    expect(await client.withdrawNote('s1', 'n-1')).toBe(true)
    await reconnect()
    expect(store.takeReturned()).toEqual([])
  })
})

describe('PRD-M13-002 AC-1 · 中断', () => {
  test('interrupt() 发 session.interrupt，回 interrupted', async () => {
    const { client, sock } = setup()
    await client.start()
    expect(await client.interrupt('s1')).toBe(true)
    expect(sock().sent.find((x) => x.method === 'session.interrupt')?.params).toEqual({ sessionId: 's1' })
  })
})

describe('PRD-M13-001 AC-4 · 轨迹时间线不按补充分轮', () => {
  test('补充留在所在的那一轮里', async () => {
    const { trajectoryTurns } = await import('../src/index.ts')
    const turns = trajectoryTurns([
      { seq: 1, kind: 'user', text: '改一下' },
      { seq: 2, kind: 'assistant', text: '好' },
      { seq: 3, kind: 'user', text: '顺便跑测试', note: true },
      { seq: 4, kind: 'user', text: '下一轮' },
    ])
    expect(turns.map((t) => t.rows.map((r) => r.seq))).toEqual([[1, 2, 3], [4]])
  })
})
