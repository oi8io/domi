/**
 * daemon 核心 —— PRD-M3-002 / PRD-M3-004 · 守 INV-01 / INV-04
 *
 * **这里没有任何传输细节。** 进来的是一个 JSON-RPC 请求对象，出去的是一个响应对象；
 * 谁把它从 WebSocket 还是 stdio 上搬过来，是 `transport.ts` 的事。
 * 这样拆是因为**并发与顺序的正确性只能在一个地方证明**——
 * 如果 WS 和 stdio 各有一套调度，两套都得各证一遍，而通常只有一套被证过。
 *
 * 两条硬规则：
 *
 * 1. **daemon 是事件流的唯一写入者**（M3-004 AC-1）。客户端只提交意图。
 * 2. **同一会话串行**（AC-2）。第二个请求进来时不排队也不静默丢弃，
 *    直接回 `SESSION_BUSY` —— 排队会让用户以为没发出去，丢弃会让他以为发出去了。
 */
import {
  type EventEnvelope,
  fail,
  METHOD_NAMES,
  METHODS,
  type MethodName,
  notify,
  ok,
  PROTOCOL_VERSION,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
  versionMismatch,
} from '@domi/protocol'

export const DAEMON_VERSION = '0.1.0'

/**
 * 宿主用它表达「没有这个会话」。**只有它**会被翻译成 SESSION_NOT_FOUND；
 * 其它异常（配置坏了、库打不开）原样作为 INTERNAL 带回去——
 * 把一切打不开都说成「没有这个会话」，用户会去找一个本来就存在的东西。
 */
export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`没有这个会话：${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

/** 一个已连接的客户端。传输层实现它，core 只管往里写 */
export interface ClientConn {
  readonly id: string
  send(msg: RpcNotification | RpcResponse): void
}

/** daemon 需要的会话能力。runtime 的 DomiSession 满足它——但 core 不 import runtime */
export interface SessionHandle {
  readonly id: string
  submit(text: string): Promise<unknown>
  compactNow(trigger: 'manual' | 'threshold'): Promise<{ ok: boolean; detail: string }>
  readEvents(fromSeq: number): Promise<EventEnvelope[]>
  head(): Promise<number>
  close(): Promise<void>
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  updatedAt: number
  eventCount: number
}

/** 宿主提供的东西。测试注入假的，生产注入真的 —— core 两边都不知道 */
export interface DaemonHost {
  open(sessionId: string): Promise<SessionHandle>
  create(cwd?: string): Promise<string>
  list(): Promise<SessionSummary[]>
  /** 会话产生新事件时调用；daemon 据此推给订阅者 */
  onEvents(cb: (sessionId: string, events: EventEnvelope[]) => void): void
  onBusy?(cb: (sessionId: string, busy: boolean) => void): void
}

interface Subscription {
  conn: ClientConn
  sessionId: string
  /** 已经推给这个客户端的最后一个 seq。断点续订与去重都靠它 */
  lastSeq: number
  /**
   * 补发历史期间到达的实时事件先攒在这里，补完再一起按 seq 发。
   * 不攒的话，读库的那次 await 里写进来的事件要么被推两次（快照前写入），
   * 要么抢在历史前面到达（快照后写入）。null = 不在补发中。
   */
  pending: EventEnvelope[] | null
}

export class Daemon {
  private readonly handshaked = new Set<string>()
  private readonly subs = new Map<string, Subscription[]>()
  private readonly sessions = new Map<string, SessionHandle>()
  /** 正在处理中的会话。串行化与 SESSION_BUSY 都看它 */
  private readonly busy = new Set<string>()

  constructor(private readonly host: DaemonHost) {
    host.onEvents((sessionId, events) => this.push(sessionId, events))
    host.onBusy?.((sessionId, b) => {
      for (const s of this.subs.get(sessionId) ?? []) {
        s.conn.send(notify('session.busy', { sessionId, busy: b }))
      }
    })
  }

  /** 客户端断开：只清订阅，**不动会话**——任务照常跑完（M3-002 AC-2） */
  disconnect(conn: ClientConn): void {
    this.handshaked.delete(conn.id)
    for (const sessionId of [...this.subs.keys()]) this.unsubscribe(sessionId, conn.id)
  }

  async handle(conn: ClientConn, req: RpcRequest): Promise<RpcResponse> {
    const method = req.method as MethodName
    if (!(METHOD_NAMES as string[]).includes(method)) {
      return fail(req.id, 'UNKNOWN_METHOD', `没有这个方法：${req.method}\n可用：${METHOD_NAMES.join(', ')}`)
    }
    if (method !== 'handshake' && !this.handshaked.has(conn.id)) {
      return fail(req.id, 'NOT_HANDSHAKED', '第一个请求必须是 handshake（PRD-M3-001 AC-2）')
    }

    const parsed = METHODS[method].params.safeParse(req.params ?? {})
    if (!parsed.success) {
      return fail(
        req.id,
        'INVALID_PARAMS',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }

    try {
      return await this.dispatch(conn, req, method, parsed.data as never)
    } catch (e) {
      return fail(req.id, 'INTERNAL', e instanceof Error ? e.message : String(e))
    }
  }

  private async dispatch(conn: ClientConn, req: RpcRequest, method: MethodName, params: never): Promise<RpcResponse> {
    switch (method) {
      case 'handshake': {
        const p = params as { protocolVersion: number; client: string }
        const mismatch = versionMismatch(p.protocolVersion)
        if (mismatch) {
          // 不握手成功 = 后续任何业务请求都会被 NOT_HANDSHAKED 挡住。
          // AC-2 要的「不进入任何降级兼容路径」就是靠这个，不是靠自觉
          return { jsonrpc: '2.0', id: req.id, error: mismatch }
        }
        this.handshaked.add(conn.id)
        return ok(req.id, { protocolVersion: PROTOCOL_VERSION, serverVersion: DAEMON_VERSION, methods: METHOD_NAMES })
      }

      case 'session.list':
        return ok(req.id, { sessions: await this.host.list() })

      case 'session.create': {
        const p = params as { cwd?: string }
        return ok(req.id, { sessionId: await this.host.create(p.cwd) })
      }

      case 'session.subscribe': {
        const p = params as { sessionId: string; fromSeq: number }
        const session = await this.session(p.sessionId)
        if (!session) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)

        const list = this.subs.get(p.sessionId) ?? []
        const existing = list.find((s) => s.conn.id === conn.id)
        const sub: Subscription = existing ?? { conn, sessionId: p.sessionId, lastSeq: p.fromSeq, pending: null }
        sub.lastSeq = p.fromSeq
        // 先登记、再读库：顺序反了，读库那段时间里写进来的事件就漏了。
        // 登记后实时事件先进 pending，补发完再合并——于是既不漏，也不重、不乱序
        sub.pending = []
        if (!existing) list.push(sub)
        this.subs.set(p.sessionId, list)

        let backlog: EventEnvelope[]
        try {
          backlog = await session.readEvents(p.fromSeq)
        } catch (e) {
          // 读不出历史就不留这个订阅：留下来只会收到一条有空洞的事件流
          this.unsubscribe(p.sessionId, conn.id)
          throw e
        }
        const pending = sub.pending ?? []
        sub.pending = null
        this.deliver(sub, [...backlog, ...pending])
        return ok(req.id, { head: await session.head() })
      }

      case 'session.submit': {
        const p = params as { sessionId: string; text: string }
        // **检查与占位之间不许有 await。**
        // 第一版把 `this.busy.add` 放在 `await this.session(...)` 之后，
        // 于是十个并发请求全都在任何一个占住之前通过了检查——十个全被接受。
        // 这是 M3-004 存在的理由本身，而它是被那条十客户端的测试抓出来的，不是想出来的。
        if (this.busy.has(p.sessionId)) {
          // 不排队也不丢弃：排队让用户以为没发出去，丢弃让他以为发出去了（AC-3）
          return fail(req.id, 'SESSION_BUSY', '这个会话正在处理上一条输入，稍后再试')
        }
        this.busy.add(p.sessionId)

        let session: SessionHandle | null
        try {
          session = await this.session(p.sessionId)
        } catch (e) {
          this.busy.delete(p.sessionId)
          throw e
        }
        if (!session) {
          this.busy.delete(p.sessionId)
          return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        }

        // **不 await**：提交是异步的，客户端拿到 accepted 就该回去等事件推送。
        // await 的话，一次长任务会把这条连接的响应通道占住
        void session
          .submit(p.text)
          .catch(() => undefined)
          .finally(() => this.busy.delete(p.sessionId))
        return ok(req.id, { accepted: true })
      }

      case 'session.compact': {
        const p = params as { sessionId: string }
        const session = await this.session(p.sessionId)
        if (!session) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        if (this.busy.has(p.sessionId)) return fail(req.id, 'SESSION_BUSY', '这个会话正忙')
        return ok(req.id, await session.compactNow('manual'))
      }

      case 'session.answer':
        // 权限询问的回答由宿主接线（TUI 在同进程里直接答；远程客户端走这里）。
        // 骨架阶段先如实返回 false，而不是假装成功 —— 假装成功会让人以为权限流程通了
        return ok(req.id, { ok: false })

      default:
        return fail(req.id, 'UNKNOWN_METHOD', `未实现：${method}`)
    }
  }

  private async session(id: string): Promise<SessionHandle | null> {
    const cached = this.sessions.get(id)
    if (cached) return cached
    try {
      const s = await this.host.open(id)
      this.sessions.set(id, s)
      return s
    } catch (e) {
      if (e instanceof SessionNotFoundError) return null
      throw e
    }
  }

  /**
   * 推送。**按订阅者各自的 lastSeq 过滤**，而不是无脑广播：
   * 一个刚补完 backlog 的客户端和一个连了很久的客户端，进度是不同的。
   */
  private push(sessionId: string, events: readonly EventEnvelope[]): void {
    for (const sub of this.subs.get(sessionId) ?? []) {
      if (sub.pending) {
        sub.pending.push(...events)
        continue
      }
      this.deliver(sub, events)
    }
  }

  /** 按 seq 升序、只发比 lastSeq 新的、同一 seq 只发一次 */
  private deliver(sub: Subscription, events: readonly EventEnvelope[]): void {
    const fresh: EventEnvelope[] = []
    let cursor = sub.lastSeq
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
      if (e.seq <= cursor) continue
      fresh.push(e)
      cursor = e.seq
    }
    if (fresh.length === 0) return
    sub.conn.send(notify('session.events', { sessionId: sub.sessionId, events: fresh }))
    sub.lastSeq = cursor
  }

  private unsubscribe(sessionId: string, connId: string): void {
    const kept = (this.subs.get(sessionId) ?? []).filter((s) => s.conn.id !== connId)
    if (kept.length === 0) this.subs.delete(sessionId)
    else this.subs.set(sessionId, kept)
  }

  async close(): Promise<void> {
    for (const s of this.sessions.values()) await s.close()
    this.sessions.clear()
    this.subs.clear()
    this.handshaked.clear()
  }
}
