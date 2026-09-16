/**
 * Domi Protocol 客户端 —— PRD-M3-001 / M3-002 AC-2 / M3-003 的共享层
 *
 * 三端（TUI / Web / 桥接）连 daemon 都走这一个类。它必须能在浏览器里跑，
 * 所以**不 import 任何 node 模块，也不依赖 DOM 类型**：连接用一个最小的 `WireSocket`
 * 描述，浏览器的 WebSocket 和 Bun 的 WebSocket 都天然满足它。
 *
 * 它负责三件事，渲染层一件都不用管：
 *
 * 1. **握手**。版本不匹配就停在 `incompatible`，**不重连、不降级**——
 *    重连只会一遍遍撞同一堵墙，而用户看到的是「一直在连接中」。
 * 2. **断线重连 + 断点续订**。每个会话记着最后收到的 seq，重连后用它续订，
 *    于是断开期间 daemon 上发生的事一条不漏地补回来。
 * 3. **去重**。同一个 seq 只进一次 store——投影是追加式的，重复一次就是重复一条消息。
 */
import {
  type EventEnvelope,
  type MethodName,
  type NotifyParamsOf,
  type ParamsOf,
  PROTOCOL_VERSION,
  type RefLink,
  type ResultOf,
  type RpcError,
} from '@domi/protocol'
import { atom } from 'nanostores'
import type { SessionStore } from './store.ts'

/** 浏览器 WebSocket 与 Bun WebSocket 的公共子集 */
export interface WireSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'close' | 'error', fn: () => void): void
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void
}

const OPEN = 1

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'incompatible' | 'closed'

export class DomiRpcError extends Error {
  readonly code: RpcError['code']
  readonly data: Record<string, unknown> | undefined
  constructor(err: RpcError) {
    super(err.message)
    this.name = 'DomiRpcError'
    this.code = err.code
    this.data = err.data
  }
}

export interface DomiClientOptions {
  /** 建一条新连接。重连时会再调一次 */
  connect: () => WireSocket
  /** 自报家门，只进 daemon 的日志与轨迹 */
  clientName: string
  /** 断线后多久重连；0 = 不重连 */
  reconnectMs?: number
  /** 测试用：替换协议版本，模拟老客户端 */
  protocolVersion?: number
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
}

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
}

interface Watch {
  store: SessionStore
  lastSeq: number
}

export class DomiClient {
  readonly $state = atom<ConnectionState>('idle')
  /** 最近一次连接失败或握手被拒的原因，给 UI 直接显示 */
  readonly $lastError = atom<string | null>(null)

  private socket: WireSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly watches = new Map<string, Watch>()
  private stopped = false
  private retry: unknown = null
  private readonly timers: NonNullable<DomiClientOptions['timers']>

  constructor(private readonly opts: DomiClientOptions) {
    this.timers = opts.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    }
  }

  /** 连上并握手。版本不匹配时 reject，且之后不会自动重连 */
  async start(): Promise<ResultOf<'handshake'>> {
    this.stopped = false
    return this.open('connecting')
  }

  async request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const socket = this.socket
    if (!socket || socket.readyState !== OPEN) throw new Error(`未连接到 daemon，无法调用 ${method}`)
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return (await result) as ResultOf<M>
  }

  listSessions(opts: { includeDeleted?: boolean } = {}): Promise<ResultOf<'session.list'>> {
    return this.request('session.list', opts.includeDeleted ? { includeDeleted: true } : {})
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request('session.delete', { sessionId })
  }

  async restoreSession(sessionId: string): Promise<void> {
    await this.request('session.restore', { sessionId })
  }

  // ── 记忆与 Soul（PRD-M4）──────────────────────────────────

  listMemory(includeDeleted = false): Promise<ResultOf<'memory.list'>> {
    return this.request('memory.list', includeDeleted ? { includeDeleted: true } : {})
  }

  searchMemory(query: string, limit?: number): Promise<ResultOf<'memory.search'>> {
    return this.request('memory.search', limit === undefined ? { query } : { query, limit })
  }

  async deleteMemory(id: string): Promise<boolean> {
    return (await this.request('memory.delete', { id })).ok
  }

  extractMemory(sessionId: string): Promise<ResultOf<'memory.extract'>> {
    return this.request('memory.extract', { sessionId })
  }

  getSoul(): Promise<ResultOf<'soul.get'>> {
    return this.request('soul.get', {})
  }

  async soulChanges(): Promise<ResultOf<'soul.changes'>['changes']> {
    return (await this.request('soul.changes', {})).changes
  }

  reviewSoul(changeId: string, decision: 'accept' | 'reject'): Promise<ResultOf<'soul.review'>> {
    return this.request('soul.review', { changeId, decision })
  }

  async updateSoul(): Promise<ResultOf<'soul.update'>['changes']> {
    return (await this.request('soul.update', {})).changes
  }

  /** 从第 atSeq 条分出新会话，返回新会话 id（TASK-M3-014） */
  async branchSession(sessionId: string, atSeq: number): Promise<string> {
    const r = await this.request('session.branch', { sessionId, atSeq })
    return r.sessionId
  }

  /** 返回会失去的能力。切换本身会以 model.switch 事件出现在对话里 */
  async switchModel(sessionId: string, model: string, provider?: string): Promise<string[]> {
    const r = await this.request(
      'session.switchModel',
      provider === undefined ? { sessionId, model } : { sessionId, model, provider },
    )
    return r.lost
  }

  /** 会话的用量上限（M7-009） */
  async setBudget(sessionId: string, budget: { tokens?: number; costUsd?: number; toolCalls?: number }): Promise<void> {
    await this.request('session.budget', { sessionId, budget })
  }

  /** 计划模式 / 执行模式（M7-005）。切换本身以 mode.switch 事件出现在对话里 */
  async setMode(sessionId: string, mode: 'plan' | 'act'): Promise<boolean> {
    const r = await this.request('session.mode', { sessionId, mode })
    return r.changed
  }

  /** 隔离会话（M7-006）：在 cwd 所在仓库建 git worktree，会话在里面干活 */
  async createIsolatedSession(
    cwd?: string,
  ): Promise<{ sessionId: string; worktree?: { path: string; branch: string } | undefined }> {
    return this.request('session.create', cwd === undefined ? { isolate: true } : { cwd, isolate: true })
  }

  worktreeDiff(sessionId: string) {
    return this.request('worktree.diff', { sessionId })
  }

  async discardChange(sessionId: string, path: string): Promise<string> {
    return (await this.request('worktree.discard', { sessionId, path })).trash
  }

  async restoreChange(sessionId: string, trash: string): Promise<string> {
    return (await this.request('worktree.restore', { sessionId, trash })).path
  }

  /** 带回原仓库。会先弹一次确认（worktree.apply 询问） */
  applyChanges(sessionId: string, mode: 'squash' | 'merge' | 'branch' = 'squash', message?: string) {
    return this.request('worktree.apply', message === undefined ? { sessionId, mode } : { sessionId, mode, message })
  }

  async createSession(cwd?: string): Promise<string> {
    const r = await this.request('session.create', cwd === undefined ? {} : { cwd })
    return r.sessionId
  }

  /** refs：引用其他会话的片段（PRD-M3-005），终点可以给得大，daemon 会截到末尾 */
  submit(sessionId: string, text: string, refs?: readonly RefLink[]): Promise<ResultOf<'session.submit'>> {
    return this.request(
      'session.submit',
      refs && refs.length > 0 ? { sessionId, text, refs: [...refs] } : { sessionId, text },
    )
  }

  /**
   * 回答一次权限询问。返回 false = 没生效（已经被别的客户端答过）。
   * 不在这里清确认框：等 daemon 推 session.askDone 再清，所有客户端走同一条路
   */
  /** channel：在哪个端上答的（M5-007）。不给就由 daemon 用握手时的客户端名 */
  async answer(askId: string, allowed: boolean, content?: Record<string, unknown>, channel?: string): Promise<boolean> {
    const r = await this.request('session.answer', {
      askId,
      allowed,
      ...(content === undefined ? {} : { content }),
      ...(channel === undefined ? {} : { channel }),
    })
    return r.ok
  }

  // ── 编排（PRD-M5-002）─────────────────────────────────────

  startTask(spec: string, cwd?: string): Promise<ResultOf<'task.start'>> {
    return this.request('task.start', cwd === undefined ? { spec } : { spec, cwd })
  }

  async listTasks(): Promise<ResultOf<'task.list'>['runs']> {
    return (await this.request('task.list', {})).runs
  }

  getTask(runId: string): Promise<ResultOf<'task.get'>> {
    return this.request('task.get', { runId })
  }

  async retryTask(runId: string, nodeId: string): Promise<void> {
    await this.request('task.retry', { runId, nodeId })
  }

  async cancelTask(runId: string): Promise<boolean> {
    return (await this.request('task.cancel', { runId })).ok
  }

  listPlugins(): Promise<ResultOf<'plugin.list'>> {
    return this.request('plugin.list', {})
  }

  async pluginUi(plugin: string, id: string): Promise<string> {
    return (await this.request('plugin.ui', { plugin, id })).html
  }

  async recordAudit(kind: string, detail: string): Promise<void> {
    await this.request('audit.record', { kind, detail })
  }

  /**
   * 订阅一个会话，把事件投影进 store。
   * 已经订阅过的会话再调一次只会换 store，续订锚点保持不变。
   */
  async watch(sessionId: string, store: SessionStore): Promise<ResultOf<'session.subscribe'>> {
    const w = this.watches.get(sessionId) ?? { store, lastSeq: 0 }
    w.store = store
    this.watches.set(sessionId, w)
    return this.request('session.subscribe', { sessionId, fromSeq: w.lastSeq })
  }

  unwatch(sessionId: string): void {
    this.watches.delete(sessionId)
  }

  /** 某个会话最后收到的 seq。重连续订就从这里接着要 */
  lastSeq(sessionId: string): number {
    return this.watches.get(sessionId)?.lastSeq ?? 0
  }

  close(): void {
    this.stopped = true
    if (this.retry !== null) this.timers.clear(this.retry)
    this.retry = null
    this.socket?.close()
    this.socket = null
    this.$state.set('closed')
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private open(state: 'connecting' | 'reconnecting'): Promise<ResultOf<'handshake'>> {
    this.$state.set(state)
    const socket = this.opts.connect()
    this.socket = socket

    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }

      socket.addEventListener('message', (ev) => this.onMessage(ev.data))
      socket.addEventListener('open', () => {
        void this.handshake().then(
          (r) => settle(() => resolve(r)),
          (e: Error) => {
            settle(() => reject(e))
            // 先把真正的原因交出去，再断开——反过来的话调用方拿到的是「连接已关闭」
            if (this.$state.get() === 'incompatible') socket.close()
          },
        )
      })
      socket.addEventListener('close', () => {
        this.onClose(socket)
        settle(() => reject(new Error('连接已关闭')))
      })
      socket.addEventListener('error', () => {
        this.$lastError.set('连不上 daemon')
      })
    })
  }

  private async handshake(): Promise<ResultOf<'handshake'>> {
    const version = this.opts.protocolVersion ?? PROTOCOL_VERSION
    try {
      const r = await this.request('handshake', { protocolVersion: version, client: this.opts.clientName })
      this.$state.set('open')
      this.$lastError.set(null)
      // 重连后按各自的锚点续订。顺序无所谓：每个会话的 seq 独立
      for (const [sessionId, w] of this.watches) {
        await this.request('session.subscribe', { sessionId, fromSeq: w.lastSeq })
      }
      return r
    } catch (e) {
      if (e instanceof DomiRpcError && e.code === 'PROTOCOL_VERSION_MISMATCH') {
        // 不降级：停在这里，别再重连
        this.stopped = true
        this.$state.set('incompatible')
        this.$lastError.set(e.message)
      }
      throw e
    }
  }

  private onMessage(raw: unknown): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: RpcError }
    try {
      msg = JSON.parse(String(raw)) as typeof msg
    } catch {
      return
    }
    if (typeof msg.id === 'number' && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new DomiRpcError(msg.error))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'session.events') {
      const params = msg.params as NotifyParamsOf<'session.events'>
      this.deliver(params.sessionId, params.events)
    } else if (msg.method === 'session.busy') {
      const params = msg.params as NotifyParamsOf<'session.busy'>
      this.watches.get(params.sessionId)?.store.setBusy(params.busy)
    } else if (msg.method === 'session.ask') {
      const p = msg.params as NotifyParamsOf<'session.ask'>
      this.watches.get(p.sessionId)?.store.setAsk({
        askId: p.askId,
        capabilityId: p.capabilityId,
        detail: p.detail,
        ...(p.form === undefined ? {} : { form: p.form }),
      })
    } else if (msg.method === 'session.askDone') {
      const p = msg.params as NotifyParamsOf<'session.askDone'>
      const store = this.watches.get(p.sessionId)?.store
      // 只清同一个询问：答完之后紧接着来了下一个的话，不能把新的也清掉
      if (store && store.$ask.get()?.askId === p.askId) store.setAsk(null)
    } else if (msg.method === 'session.metrics') {
      const p = msg.params as NotifyParamsOf<'session.metrics'>
      const store = this.watches.get(p.sessionId)?.store
      if (store) {
        const { provider, model, ...metrics } = p.metrics
        store.setModel(provider, model)
        store.setMetrics(metrics)
      }
    }
  }

  private deliver(sessionId: string, events: EventEnvelope[]): void {
    const w = this.watches.get(sessionId)
    if (!w) return
    const fresh: EventEnvelope[] = []
    let cursor = w.lastSeq
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
      if (e.seq <= cursor) continue
      fresh.push(e)
      cursor = e.seq
    }
    if (fresh.length === 0) return
    w.lastSeq = cursor
    w.store.applyEvents(fresh)
  }

  private onClose(socket: WireSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    for (const p of this.pending.values()) p.reject(new Error('连接已断开'))
    this.pending.clear()
    if (this.stopped) {
      if (this.$state.get() !== 'incompatible') this.$state.set('closed')
      return
    }
    const ms = this.opts.reconnectMs ?? 1000
    if (ms <= 0) {
      this.$state.set('closed')
      return
    }
    this.$state.set('reconnecting')
    this.retry = this.timers.set(() => {
      this.retry = null
      if (this.stopped) return
      this.open('reconnecting').catch(() => undefined)
    }, ms)
  }
}
