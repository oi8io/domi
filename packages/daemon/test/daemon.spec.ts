/**
 * PRD-M3-002 / PRD-M3-004 · daemon 与并发写仲裁
 *
 * 断言集中在**断线、并发、版本不匹配**三件事上——
 * 这三件是「多端」真正带来的新失败模式，其余的和单端没区别。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope, RpcNotification, RpcRequest, RpcResponse } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { type ClientConn, Daemon, type DaemonHost, type SessionHandle, type SessionSummary } from '../src/index.ts'

/** 假客户端：记下收到的每一条通知，好断言「推了什么、推了几次」 */
class FakeConn implements ClientConn {
  readonly received: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(msg: RpcNotification | RpcResponse): void {
    this.received.push(msg)
  }
  events(): EventEnvelope[] {
    return this.received
      .filter((m) => 'method' in m && m.method === 'session.events')
      .flatMap((m) => ((m as RpcNotification).params as { events: EventEnvelope[] }).events)
  }
}

/** 假宿主：一个内存事件流 + 可控的 submit 时长 */
function makeHost(opts: { submitMs?: number } = {}) {
  let seq = 0
  const events: EventEnvelope[] = []
  let emit: ((s: string, e: EventEnvelope[]) => void) | null = null
  let busyCb: ((s: string, b: boolean) => void) | null = null
  const readHooks: { beforeSnapshot?: (() => void) | undefined; afterSnapshot?: (() => void) | undefined } = {}

  const append = (texts: string[]): EventEnvelope[] => {
    const batch = texts.map((text) => {
      seq++
      return {
        seq,
        sessionId: 's1',
        parentSeq: seq > 1 ? seq - 1 : null,
        ts: 1_700_000_000_000 + seq,
        schemaVersion: 5,
        ev: { t: 'model.delta' as const, text },
      }
    })
    events.push(...batch)
    emit?.('s1', batch)
    return batch
  }

  const handle: SessionHandle = {
    id: 's1',
    async submit(text: string) {
      busyCb?.('s1', true)
      if (opts.submitMs) await new Promise((r) => setTimeout(r, opts.submitMs))
      append([`回答：${text}`])
      busyCb?.('s1', false)
      return undefined
    },
    async compactNow() {
      return { ok: true, detail: 'compacted' }
    },
    async readEvents(fromSeq: number) {
      // 真实的读库是异步的：快照前后都可能有新事件写进来。钩子让测试把事件塞进这两个缝里
      await Promise.resolve()
      readHooks.beforeSnapshot?.()
      const snapshot = events.filter((e) => e.seq > fromSeq)
      await Promise.resolve()
      readHooks.afterSnapshot?.()
      return snapshot
    },
    async head() {
      return seq
    },
    async close() {},
  }

  const host: DaemonHost = {
    async open(id) {
      if (id !== 's1') throw new Error('no such session')
      return handle
    },
    async create() {
      return 's1'
    },
    async list(): Promise<SessionSummary[]> {
      return [{ id: 's1', title: '测试会话', model: 'stub', updatedAt: 1, eventCount: events.length }]
    },
    onEvents(cb) {
      emit = cb
    },
    onBusy(cb) {
      busyCb = cb
    },
  }
  return { host, append, events, readHooks }
}

let reqId = 0
function req(method: string, params?: unknown): RpcRequest {
  reqId++
  return { jsonrpc: '2.0', id: reqId, method, ...(params === undefined ? {} : { params }) }
}

async function handshaked(d: Daemon, conn: ClientConn): Promise<void> {
  const r = await d.handle(conn, req('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' }))
  if (r.error) throw new Error(`握手失败：${r.error.code}`)
}

describe('PRD-M3-001 AC-2 · 版本协商不降级', () => {
  test('版本不匹配 → PROTOCOL_VERSION_MISMATCH，带双方版本号', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    const r = await d.handle(c, req('handshake', { protocolVersion: 999, client: 'old' }))
    expect(r.error?.code).toBe('PROTOCOL_VERSION_MISMATCH')
    expect(r.error?.data).toEqual({ clientVersion: 999, serverVersion: PROTOCOL_VERSION })
  })

  test('不匹配之后，任何业务请求都被挡住 —— 这就是「不进入降级路径」', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await d.handle(c, req('handshake', { protocolVersion: 999, client: 'old' }))
    for (const m of ['session.list', 'session.submit', 'session.subscribe']) {
      const r = await d.handle(c, req(m, { sessionId: 's1', text: 'x', fromSeq: 0 }))
      expect(r.error?.code).toBe('NOT_HANDSHAKED')
    }
  })

  test('没握手就直接发请求也一样被挡', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const r = await d.handle(new FakeConn('c1'), req('session.list'))
    expect(r.error?.code).toBe('NOT_HANDSHAKED')
  })

  test('未知方法给出可用方法列表，不是一句 -32601', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    const r = await d.handle(c, req('session.nope'))
    expect(r.error?.code).toBe('UNKNOWN_METHOD')
    expect(r.error?.message).toContain('session.list')
  })

  test('参数不合法时说清楚是哪个字段', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    const r = await d.handle(c, req('session.submit', { sessionId: 's1' }))
    expect(r.error?.code).toBe('INVALID_PARAMS')
    expect(r.error?.message).toContain('text')
  })
})

describe('PRD-M3-002 AC-2 · 断点续订，不重不漏', () => {
  test('订阅时补发历史，之后只推新的', async () => {
    const { host, append } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)

    append(['旧的一', '旧的二'])
    const r = await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    expect(r.result).toEqual({ head: 2 })
    expect(c.events().map((e) => e.seq)).toEqual([1, 2])

    append(['新的三'])
    expect(c.events().map((e) => e.seq)).toEqual([1, 2, 3])
  })

  test('从断点续订：给 fromSeq=2 就不会再收到 1 和 2', async () => {
    const { host, append } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    append(['一', '二', '三'])

    await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 2 }))
    expect(c.events().map((e) => e.seq)).toEqual([3])
  })

  test('断开再重连，中间产生的事件一条不漏', async () => {
    const { host, append } = makeHost()
    const d = new Daemon(host)
    const c1 = new FakeConn('c1')
    await handshaked(d, c1)
    append(['一'])
    await d.handle(c1, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    expect(c1.events().map((e) => e.seq)).toEqual([1])

    // 客户端掉线，任务继续跑
    d.disconnect(c1)
    append(['二', '三'])
    expect(c1.events().map((e) => e.seq)).toEqual([1]) // 掉线后不再收到

    // 换一条连接回来，报上次收到的 seq
    const c2 = new FakeConn('c2')
    await handshaked(d, c2)
    await d.handle(c2, req('session.subscribe', { sessionId: 's1', fromSeq: 1 }))
    expect(c2.events().map((e) => e.seq)).toEqual([2, 3])
  })

  test('客户端断开不影响执行中的任务（AC-2 的前半句）', async () => {
    const { host } = makeHost({ submitMs: 30 })
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    await d.handle(c, req('session.submit', { sessionId: 's1', text: '长任务' }))

    d.disconnect(c) // 提交后立刻掉线
    await new Promise((r) => setTimeout(r, 80))

    // 任务照样跑完了：换一条连接从头订阅，能看到结果
    const c2 = new FakeConn('c2')
    await handshaked(d, c2)
    await d.handle(c2, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    expect(JSON.stringify(c2.events())).toContain('回答：长任务')
  })

  test('补发历史的读库期间写进来的事件不重复 —— 快照前写入', async () => {
    const { host, append, readHooks } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    append(['一', '二'])
    // 订阅已登记、快照还没拍：这条既会被实时推送，也会出现在快照里
    readHooks.beforeSnapshot = () => {
      readHooks.beforeSnapshot = undefined
      append(['三'])
    }
    await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    expect(c.events().map((e) => e.seq)).toEqual([1, 2, 3])
  })

  test('补发历史的读库期间写进来的事件不乱序 —— 快照后写入', async () => {
    const { host, append, readHooks } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c1')
    await handshaked(d, c)
    append(['一', '二'])
    // 快照已拍、backlog 还没发：实时推送不能抢在历史前面
    readHooks.afterSnapshot = () => {
      readHooks.afterSnapshot = undefined
      append(['三'])
    }
    await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    append(['四'])
    expect(c.events().map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })

  test('两个客户端订阅同一会话，收到的 seq 序列相同（PRD-M3-003 AC-3）', async () => {
    const { host, append } = makeHost()
    const d = new Daemon(host)
    const a = new FakeConn('a')
    const b = new FakeConn('b')
    await handshaked(d, a)
    await handshaked(d, b)
    await d.handle(a, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    await d.handle(b, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    append(['一', '二'])
    expect(a.events().map((e) => e.seq)).toEqual(b.events().map((e) => e.seq))
  })
})

describe('PRD-M3-004 · 并发写仲裁', () => {
  test('第二个客户端在处理中提交 → SESSION_BUSY，不是静默丢弃', async () => {
    const { host } = makeHost({ submitMs: 50 })
    const d = new Daemon(host)
    const a = new FakeConn('a')
    const b = new FakeConn('b')
    await handshaked(d, a)
    await handshaked(d, b)

    const first = await d.handle(a, req('session.submit', { sessionId: 's1', text: '第一条' }))
    expect(first.result).toEqual({ accepted: true })

    const second = await d.handle(b, req('session.submit', { sessionId: 's1', text: '第二条' }))
    expect(second.error?.code).toBe('SESSION_BUSY')
    expect(second.result).toBeUndefined()
  })

  test('前一条处理完之后又能提交了 —— 忙是状态，不是拒绝', async () => {
    const { host } = makeHost({ submitMs: 20 })
    const d = new Daemon(host)
    const c = new FakeConn('c')
    await handshaked(d, c)
    await d.handle(c, req('session.submit', { sessionId: 's1', text: '一' }))
    await new Promise((r) => setTimeout(r, 60))
    const again = await d.handle(c, req('session.submit', { sessionId: 's1', text: '二' }))
    expect(again.result).toEqual({ accepted: true })
  })

  test('十个客户端同时提交，只有一个被接受，其余都拿到 SESSION_BUSY', async () => {
    const { host } = makeHost({ submitMs: 40 })
    const d = new Daemon(host)
    const conns = Array.from({ length: 10 }, (_, i) => new FakeConn(`c${i}`))
    for (const c of conns) await handshaked(d, c)

    const results = await Promise.all(
      conns.map((c) => d.handle(c, req('session.submit', { sessionId: 's1', text: 'x' }))),
    )
    const accepted = results.filter((r) => r.result !== undefined)
    const busy = results.filter((r) => r.error?.code === 'SESSION_BUSY')
    expect(accepted).toHaveLength(1)
    expect(busy).toHaveLength(9)
    // 没有一个是静默丢弃的：十个请求十个明确答复
    expect(accepted.length + busy.length).toBe(10)
  })

  test('不存在的会话给 SESSION_NOT_FOUND，不是 INTERNAL', async () => {
    const { host } = makeHost()
    const d = new Daemon(host)
    const c = new FakeConn('c')
    await handshaked(d, c)
    const r = await d.handle(c, req('session.submit', { sessionId: '不存在', text: 'x' }))
    expect(r.error?.code).toBe('SESSION_NOT_FOUND')
  })
})

describe('忙闲状态推给订阅者', () => {
  test('submit 期间推 busy:true，结束推 busy:false', async () => {
    const { host } = makeHost({ submitMs: 20 })
    const d = new Daemon(host)
    const c = new FakeConn('c')
    await handshaked(d, c)
    await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'x' }))
    await new Promise((r) => setTimeout(r, 60))
    const busyMsgs = c.received
      .filter((m) => 'method' in m && m.method === 'session.busy')
      .map((m) => ((m as RpcNotification).params as { busy: boolean }).busy)
    expect(busyMsgs).toEqual([true, false])
  })
})
