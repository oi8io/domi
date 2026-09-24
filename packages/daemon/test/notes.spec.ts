/**
 * PRD-M13-001 / PRD-M13-002 · daemon 侧的补充队列与中断（SPEC-M13-001 取舍-1 / 取舍-4 / 取舍-5 · SPEC-M13-002 取舍-1 / 取舍-3）
 *
 * 宿主是假的：submit 拿到 run（notes / signal）后按剧本走——测试能精确控制
 * 「哪一刻取队列」「这一轮怎么收场」，从而把竞态窗口一个个钉住。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope, RpcNotification, RpcRequest, RpcResponse } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import {
  type ClientConn,
  Daemon,
  type DaemonHost,
  type HostAsk,
  type SessionHandle,
  SessionNotFoundError,
  type TurnRun,
} from '../src/index.ts'

class FakeConn implements ClientConn {
  readonly received: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(msg: RpcNotification | RpcResponse): void {
    this.received.push(msg)
  }
  notices(method: string): Array<Record<string, unknown>> {
    return this.received
      .filter((m): m is RpcNotification => 'method' in m && m.method === method)
      .map((m) => m.params as Record<string, unknown>)
  }
}

/** 这一轮做什么。默认：取一次队列、completed */
type Script = (ctx: {
  text: string
  run: TurnRun | undefined
  take(): void
  hold: Promise<void>
}) => Promise<{ stopReason?: string }>

/** 可控宿主：submit 按剧本走；每次提交记下文字与 noteIds */
function makeHost() {
  let seq = 0
  const events: EventEnvelope[] = []
  let emit: ((s: string, e: EventEnvelope[]) => void) | null = null
  let askCb: ((s: string, a: HostAsk) => void) | null = null
  const submits: Array<{ text: string; noteIds?: readonly string[] }> = []
  let release: () => void = () => undefined
  let hold = new Promise<void>((r) => {
    release = r
  })
  const scripts: Script[] = []

  const append = (ev: EventEnvelope['ev']): void => {
    seq++
    const env: EventEnvelope = {
      seq,
      sessionId: 's1',
      parentSeq: seq > 1 ? seq - 1 : null,
      ts: seq,
      schemaVersion: 15,
      ev,
    }
    events.push(env)
    emit?.('s1', [env])
  }

  const handle: SessionHandle = {
    id: 's1',
    async submit(text, _refs, _inputs, run) {
      submits.push({ text, ...(run?.noteIds ? { noteIds: run.noteIds } : {}) })
      append({ t: 'user.input', text })
      const take = (): void => {
        for (const n of run?.notes.take() ?? []) append({ t: 'user.note', id: n.id, text: n.text })
      }
      const script = scripts.shift()
      if (script) return script({ text, run, take, hold })
      await hold
      take()
      return { stopReason: 'completed' }
    },
    async compactNow() {
      return { ok: true, detail: '' }
    },
    async switchModel() {
      return { lost: [] }
    },
    async readEvents(fromSeq) {
      return events.filter((e) => e.seq > fromSeq)
    },
    async head() {
      return seq
    },
    async close() {},
  }
  const host: DaemonHost = {
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
    onAsk(cb) {
      askCb = cb
    },
  }
  return {
    host,
    events,
    submits,
    scripts,
    ask: (a: HostAsk) => askCb?.('s1', a),
    /** 放行当前这一轮 */
    release() {
      release()
      hold = new Promise<void>((r) => {
        release = r
      })
    },
  }
}

let reqId = 0
const req = (method: string, params?: unknown): RpcRequest => ({
  jsonrpc: '2.0',
  id: ++reqId,
  method,
  ...(params === undefined ? {} : { params }),
})
const tick = () => new Promise((r) => setTimeout(r, 5))

async function ready(name = 'domi-web') {
  const h = makeHost()
  const d = new Daemon(h.host)
  const c = new FakeConn(name)
  await d.handle(c, req('handshake', { protocolVersion: PROTOCOL_VERSION, client: name }))
  await d.handle(c, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
  return { ...h, d, c }
}

const types = (evs: EventEnvelope[]) => evs.map((e) => e.ev.t)

describe('PRD-M13-001 AC-5 · 跑着的时候补充进队列，下一步送达', () => {
  test('忙时 session.note → queued + noteId；订阅端收到队列；送达后队列清空、事件流里是 user.note', async () => {
    const { d, c, events, release } = await ready()
    expect((await d.handle(c, req('session.submit', { sessionId: 's1', text: '改一下' }))).result).toEqual({
      accepted: true,
    })
    const r = await d.handle(c, req('session.note', { sessionId: 's1', text: '顺便跑测试' }))
    expect(r.result).toMatchObject({ state: 'queued' })
    const noteId = (r.result as { noteId: string }).noteId
    expect(c.notices('session.notes').at(-1)).toEqual({
      sessionId: 's1',
      pending: [{ id: noteId, text: '顺便跑测试', from: 'domi-web' }],
    })
    release()
    await tick()
    expect(types(events)).toEqual(['user.input', 'user.note'])
    expect((events[1]!.ev as { id: string }).id).toBe(noteId)
    expect(c.notices('session.notes').at(-1)).toEqual({ sessionId: 's1', pending: [] })
  })

  test('完全空闲时 session.note → submitted，就是一次普通提交（user.input）', async () => {
    const { d, c, submits, release } = await ready()
    const r = await d.handle(c, req('session.note', { sessionId: 's1', text: '你好' }))
    expect(r.result).toEqual({ state: 'submitted' })
    expect(submits).toEqual([{ text: '你好' }])
    release()
  })

  test('提交已被接受、宿主还没开跑（还在校验）时来的补充也进队列，不回 SESSION_BUSY', async () => {
    const { d, c, events, release } = await ready()
    // 不 await：让 note 插进 submit 的校验窗口
    const p = d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    const n = await d.handle(c, req('session.note', { sessionId: 's1', text: '插队的补充' }))
    await p
    expect(n.result).toMatchObject({ state: 'queued' })
    release()
    await tick()
    expect(types(events)).toEqual(['user.input', 'user.note'])
  })

  test('会话被 host 自己占着（不是 daemon 发起的一轮）→ SESSION_BUSY', async () => {
    const h = makeHost()
    let busyCb: ((s: string, b: boolean) => void) | null = null
    h.host.onBusy = (cb) => {
      busyCb = cb
    }
    const d = new Daemon(h.host)
    const c = new FakeConn('x')
    await d.handle(c, req('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'x' }))
    busyCb!('s1', true)
    const r = await d.handle(c, req('session.note', { sessionId: 's1', text: 'x' }))
    expect(r.error?.code).toBe('SESSION_BUSY')
  })

  test('订阅时补发当前队列', async () => {
    const { d, c, release } = await ready()
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    await d.handle(c, req('session.note', { sessionId: 's1', text: '排着' }))
    const late = new FakeConn('late')
    await d.handle(late, req('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'domi-tui' }))
    await d.handle(late, req('session.subscribe', { sessionId: 's1', fromSeq: 0 }))
    expect(late.notices('session.notes').at(-1)?.pending as unknown[]).toHaveLength(1)
    release()
  })

  test('十个客户端并发补充：送达顺序 = 入队顺序，seq 无重复无空洞', async () => {
    const { d, c, events, release } = await ready()
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'go' }))
    const conns = Array.from({ length: 10 }, (_, i) => new FakeConn(`c${i}`))
    for (const x of conns) await d.handle(x, req('handshake', { protocolVersion: PROTOCOL_VERSION, client: x.id }))
    const rs = await Promise.all(
      conns.map((x, k) => d.handle(x, req('session.note', { sessionId: 's1', text: `第${k}条` }))),
    )
    expect(rs.every((r) => (r.result as { state: string }).state === 'queued')).toBe(true)
    release()
    await tick()
    const notes = events.filter((e) => e.ev.t === 'user.note').map((e) => (e.ev as { text: string }).text)
    expect(notes).toEqual(Array.from({ length: 10 }, (_, k) => `第${k}条`))
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: events.length }, (_, k) => k + 1))
  })
})

describe('PRD-M13-001 AC-6 · 撤回', () => {
  test('排队中撤回 → true 并广播；再撤 / 已送达 → false，不产生事件', async () => {
    const { d, c, events, release } = await ready()
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    const n1 = (await d.handle(c, req('session.note', { sessionId: 's1', text: '撤掉我' }))).result as {
      noteId: string
    }
    const n2 = (await d.handle(c, req('session.note', { sessionId: 's1', text: '留下' }))).result as { noteId: string }
    const w = await d.handle(c, req('session.note.withdraw', { sessionId: 's1', noteId: n1.noteId }))
    expect(w.result).toEqual({ withdrawn: true })
    const pending = (c.notices('session.notes').at(-1)?.pending ?? []) as Array<{ id: string }>
    expect(pending.map((n) => n.id)).toEqual([n2.noteId])
    expect((await d.handle(c, req('session.note.withdraw', { sessionId: 's1', noteId: n1.noteId }))).result).toEqual({
      withdrawn: false,
    })
    release()
    await tick()
    expect((await d.handle(c, req('session.note.withdraw', { sessionId: 's1', noteId: n2.noteId }))).result).toEqual({
      withdrawn: false,
    })
    expect(types(events)).toEqual(['user.input', 'user.note'])
  })
})

describe('PRD-M13-001 AC-7 · 收场时的残留', () => {
  test('正常收场后才到的补充（错过最后一次取）→ 不释放忙，用它开下一轮，user.input 带 noteIds', async () => {
    const { d, c, submits, scripts, events, release } = await ready()
    let noteId = ''
    scripts.push(async ({ take }) => {
      take() // 最后一次取：空
      const r = await d.handle(c, req('session.note', { sessionId: 's1', text: '晚到的补充' }))
      noteId = (r.result as { noteId: string }).noteId
      return { stopReason: 'completed' }
    })
    await d.handle(c, req('session.submit', { sessionId: 's1', text: '第一轮' }))
    await tick()
    expect(submits).toEqual([{ text: '第一轮' }, { text: '晚到的补充', noteIds: [noteId] }])
    // 下一轮还在跑：另一个提交仍然被拒（忙没有断开）
    expect((await d.handle(c, req('session.submit', { sessionId: 's1', text: 'x' }))).error?.code).toBe('SESSION_BUSY')
    expect(c.notices('session.notes.returned')).toEqual([])
    release()
    await tick()
    expect(types(events)).toEqual(['user.input', 'user.input'])
  })

  test('异常收场（护栏 / 出错 / submit 抛错）→ 残留退回，不开新轮', async () => {
    for (const ending of ['max_tool_calls', 'stream_error', 'throw'] as const) {
      const { d, c, submits, scripts } = await ready()
      let noteId = ''
      scripts.push(async () => {
        const r = await d.handle(c, req('session.note', { sessionId: 's1', text: '没来得及' }))
        noteId = (r.result as { noteId: string }).noteId
        if (ending === 'throw') throw new Error('炸了')
        return { stopReason: ending }
      })
      await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
      await tick()
      expect(submits).toHaveLength(1)
      expect(c.notices('session.notes.returned')).toEqual([
        { sessionId: 's1', notes: [{ id: noteId, text: '没来得及', from: 'domi-web' }] },
      ])
      expect(c.notices('session.notes').at(-1)).toEqual({ sessionId: 's1', pending: [] })
      // 忙已释放
      expect((await d.handle(c, req('session.submit', { sessionId: 's1', text: 'b' }))).result).toEqual({
        accepted: true,
      })
    }
  })
})

describe('PRD-M13-001 AC-8 · 补充不是回答', () => {
  test('等确认时入队的补充不影响那次确认', async () => {
    const { d, c, ask, release } = await ready()
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    const answers: boolean[] = []
    ask({ askId: 'k1', capabilityId: 'fs.write', detail: '{}', answer: (x) => answers.push(x) })
    await d.handle(c, req('session.note', { sessionId: 's1', text: '好的，写吧' }))
    expect(answers).toEqual([])
    expect(c.notices('session.askDone')).toEqual([])
    release()
  })
})

describe('PRD-M13-002 · 中断', () => {
  test('有一轮在跑 → interrupted=true，信号带着是谁中断的；闲时 → false', async () => {
    const { d, c, scripts } = await ready('domi-tui')
    let reason: unknown
    scripts.push(
      ({ run }) =>
        new Promise((resolve) => {
          run!.signal.addEventListener('abort', () => {
            reason = run!.signal.reason
            resolve({ stopReason: 'interrupted' })
          })
        }),
    )
    expect((await d.handle(c, req('session.interrupt', { sessionId: 's1' }))).result).toEqual({ interrupted: false })
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    expect((await d.handle(c, req('session.interrupt', { sessionId: 's1' }))).result).toEqual({ interrupted: true })
    await tick()
    expect(reason).toEqual({ by: 'domi-tui' })
    // 收场后忙释放；不自动续跑
    expect((await d.handle(c, req('session.submit', { sessionId: 's1', text: 'b' }))).result).toEqual({
      accepted: true,
    })
  })

  test('中断时挂着的询问按 channel=interrupt 结掉，广播 askDone', async () => {
    const { d, c, ask, scripts } = await ready()
    scripts.push(
      ({ run }) =>
        new Promise((resolve) => run!.signal.addEventListener('abort', () => resolve({ stopReason: 'interrupted' }))),
    )
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    const got: Array<[boolean, string | undefined]> = []
    ask({ askId: 'k1', capabilityId: 'fs.write', detail: '{}', answer: (x, _c, ch) => got.push([x, ch]) })
    await d.handle(c, req('session.interrupt', { sessionId: 's1' }))
    expect(got).toEqual([[false, 'interrupt']])
    expect(c.notices('session.askDone')).toEqual([{ sessionId: 's1', askId: 'k1', allowed: false }])
  })

  test('中断时队列里的补充退回（PRD-M13-002 AC-7）', async () => {
    const { d, c, scripts } = await ready()
    scripts.push(
      ({ run }) =>
        new Promise((resolve) => run!.signal.addEventListener('abort', () => resolve({ stopReason: 'interrupted' }))),
    )
    await d.handle(c, req('session.submit', { sessionId: 's1', text: 'a' }))
    await d.handle(c, req('session.note', { sessionId: 's1', text: '还没送到' }))
    await d.handle(c, req('session.interrupt', { sessionId: 's1' }))
    await tick()
    const back = (c.notices('session.notes.returned')[0]?.notes ?? []) as Array<{ text: string }>
    expect(back.map((n) => n.text)).toEqual(['还没送到'])
  })
})
