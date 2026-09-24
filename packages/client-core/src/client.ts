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
import { localizeError, tr } from '@domi/i18n'
import {
  type EventEnvelope,
  type MethodName,
  type NotifyParamsOf,
  type ParamsOf,
  PROTOCOL_VERSION,
  type RefLink,
  type ResultOf,
  type RpcError,
  type Schedule,
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
  /** daemon 给的原文（它自己那个语言） */
  readonly rawMessage: string
  constructor(err: RpcError) {
    // daemon 给了文案 key 就按这一端的语言渲染（PRD-M9-004 AC-4）；原文留在 data 之外的 rawMessage 里
    super(localizeError(err.message, err.data))
    this.rawMessage = err.message
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
  /**
   * 本端发出、还没见到结局的补充（SPEC-M13-001 取舍-6）：noteId → 文字。
   * 见到送达、被退回、撤回成功就删；重连后 daemon 没有、也没见送达的，当作退回
   */
  sent: Map<string, string>
  /** 最近一次 subscribe 期间 daemon 推来的队列快照（没推 = 那边没有一轮在跑） */
  snapshot: Set<string> | null
  /** 已见到送达的 noteId：note() 的回应比送达事件晚到时，不再把它记成「还在路上」 */
  delivered: Set<string>
  /** 退回通知比 note() 的回应先到：先存着，回应到了再认领 */
  unclaimed: Map<string, string>
}

export class DomiClient {
  readonly $state = atom<ConnectionState>('idle')
  /**
   * 会话列表的版本号（PRD-M8-009）：daemon 推 sessions.changed 时加一，界面据此重新 session.list。
   * changedIds 是最近一次变化涉及的会话
   */
  readonly $sessionsVersion = atom(0)
  changedIds: readonly string[] = []
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
    if (!socket || socket.readyState !== OPEN) throw new Error(tr('core.client.notConnected', { method }))
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return (await result) as ResultOf<M>
  }

  listSessions(
    opts: { includeDeleted?: boolean; kind?: 'chat' | 'task'; projectId?: string } = {},
  ): Promise<ResultOf<'session.list'>> {
    return this.request('session.list', {
      ...(opts.includeDeleted ? { includeDeleted: true } : {}),
      ...(opts.kind === undefined ? {} : { kind: opts.kind }),
      ...(opts.projectId === undefined ? {} : { projectId: opts.projectId }),
    })
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

  /** 保存 Soul 全文（M8-012）。mtime 是 getSoul 时拿到的；中间被改过会被拒（data.reason = CONFLICT） */
  writeSoul(text: string, mtime?: number): Promise<ResultOf<'soul.write'>> {
    return this.request('soul.write', mtime === undefined ? { text } : { text, mtime })
  }

  exportSoul(): Promise<ResultOf<'soul.export'>> {
    return this.request('soul.export', {})
  }

  /** 不给 sections = 只预览每区要加的行 */
  importSoul(text: string, name: string, sections?: readonly string[]): Promise<ResultOf<'soul.import'>> {
    return this.request(
      'soul.import',
      sections === undefined ? { text, name } : { text, name, sections: [...sections] },
    )
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

  /** 派一个只读的审阅会话（M7-010）。返回审阅会话 id；发现以 review.findings 事件出现在它里面 */
  async startReview(p: { cwd?: string; base?: string; specs?: string[]; fromSessionId?: string }): Promise<string> {
    return (await this.request('review.start', p)).sessionId
  }

  /** 会话的用量上限（M7-009） */
  async setBudget(sessionId: string, budget: { tokens?: number; costUsd?: number; toolCalls?: number }): Promise<void> {
    await this.request('session.budget', { sessionId, budget })
  }

  /** 计划模式 / 执行模式（M7-005）。切换本身以 mode.switch 事件出现在对话里 */
  /** PRD-M12-002：切会话确认模式（always-ask/on-demand/allow-all） */
  async setPermissionsMode(sessionId: string, mode: 'always-ask' | 'on-demand' | 'allow-all'): Promise<boolean> {
    const r = await this.request('session.permissionsMode', { sessionId, mode })
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

  /**
   * 新建会话。不给参数 = 自由会话（M8-004）；给 cwd 时由 daemon 按目录判断；
   * opts.kind / projectId 明确指定是会话还是某个项目下的任务
   */
  async createSession(cwd?: string, opts: { kind?: 'chat' | 'task'; projectId?: string } = {}): Promise<string> {
    const r = await this.request('session.create', {
      ...(cwd === undefined ? {} : { cwd }),
      ...(opts.kind === undefined ? {} : { kind: opts.kind }),
      ...(opts.projectId === undefined ? {} : { projectId: opts.projectId }),
    })
    return r.sessionId
  }

  /** 按目标新建任务（M8-005）。目标作为第一句话已经提交了 */
  createTask(projectId: string, goal: string): Promise<ResultOf<'task.create'>> {
    return this.request('task.create', { projectId, goal })
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.request('session.rename', { sessionId, title })
  }

  /** 自由会话转任务（M8-004）。返回新任务的会话 id */
  async sessionToTask(sessionId: string, projectId: string, goal: string): Promise<string> {
    return (await this.request('session.toTask', { sessionId, projectId, goal })).sessionId
  }

  // ── 设置（PRD-M8-011）────────────────────────────────────

  getSettings(): Promise<ResultOf<'config.get'>> {
    return this.request('config.get', {})
  }

  /** 厂商模板（PRD-M9-002）：新增 provider 的表单从这里拿默认值 */
  listVendors(): Promise<ResultOf<'provider.vendors'>> {
    return this.request('provider.vendors', {})
  }

  /** 键是 config.get 的 writable 里的点分路径；null = 删掉 */
  setSettings(patch: Record<string, unknown>): Promise<ResultOf<'config.set'>> {
    return this.request('config.set', { patch })
  }

  // ── 项目（PRD-M8-003）────────────────────────────────────

  // ── 定时任务（PRD-M8-007） ──

  async listSchedules(): Promise<Schedule[]> {
    return (await this.request('schedule.list', {})).schedules
  }

  async createSchedule(p: ParamsOf<'schedule.create'>): Promise<Schedule> {
    return (await this.request('schedule.create', p)).schedule
  }

  async updateSchedule(p: ParamsOf<'schedule.update'>): Promise<Schedule> {
    return (await this.request('schedule.update', p)).schedule
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.request('schedule.delete', { id })
  }

  async runScheduleNow(id: string): Promise<string> {
    return (await this.request('schedule.runNow', { id })).sessionId
  }

  async scheduleRuns(id: string, limit?: number): Promise<ResultOf<'schedule.runs'>['runs']> {
    return (await this.request('schedule.runs', limit === undefined ? { id } : { id, limit })).runs
  }

  /** 校验 cron 并给出接下来几次运行；不合法抛 DomiRpcError（data.field 指出哪一段） */
  previewSchedule(cron: string, tz?: string): Promise<ResultOf<'schedule.preview'>> {
    return this.request('schedule.preview', tz === undefined ? { cron } : { cron, tz })
  }

  async listProjects(
    opts: { includeArchived?: boolean; recent?: number } = {},
  ): Promise<ResultOf<'project.list'>['projects']> {
    return (await this.request('project.list', opts)).projects
  }

  async createProject(path: string, name?: string): Promise<ResultOf<'project.create'>['project']> {
    return (await this.request('project.create', name === undefined ? { path } : { path, name })).project
  }

  async updateProject(
    id: string,
    patch: Omit<ParamsOf<'project.update'>, 'id'>,
  ): Promise<ResultOf<'project.update'>['project']> {
    return (await this.request('project.update', { id, ...patch })).project
  }

  async archiveProject(id: string, archived = true): Promise<void> {
    await this.request('project.archive', { id, archived })
  }

  resolveProject(cwd: string): Promise<ResultOf<'project.resolve'>> {
    return this.request('project.resolve', { cwd })
  }

  /** refs：引用其他会话的片段（PRD-M3-005），终点可以给得大，daemon 会截到末尾 */
  /** extras：附件 id、引用的文件、指定的技能（PRD-M8-010） */
  submit(
    sessionId: string,
    text: string,
    refs?: readonly RefLink[],
    extras: { uploads?: readonly string[]; files?: readonly string[]; skills?: readonly string[] } = {},
  ): Promise<ResultOf<'session.submit'>> {
    const nonEmpty = (k: 'uploads' | 'files' | 'skills') => {
      const v = extras[k]
      return v && v.length > 0 ? { [k]: [...v] } : {}
    }
    return this.request('session.submit', {
      sessionId,
      text,
      ...(refs && refs.length > 0 ? { refs: [...refs] } : {}),
      ...nonEmpty('uploads'),
      ...nonEmpty('files'),
      ...nonEmpty('skills'),
    })
  }

  /**
   * 运行中补充（PRD-M13-001）：会话在跑 → 排队（queued），下一步送达；空闲 → 就是一次提交（submitted）。
   * 排队的记进本地副本，结局（送达 / 退回 / 撤回）没见到之前一直记着
   */
  async note(sessionId: string, text: string): Promise<ResultOf<'session.note'>> {
    const r = await this.request('session.note', { sessionId, text })
    const w = this.watches.get(sessionId)
    if (w && r.state === 'queued') {
      const early = w.unclaimed.get(r.noteId)
      if (early !== undefined) {
        w.unclaimed.delete(r.noteId)
        w.store.addReturned([early])
      } else if (!w.delivered.has(r.noteId)) {
        w.sent.set(r.noteId, text)
      }
    }
    return r
  }

  /** 撤回一条还在排队的补充（PRD-M13-001 AC-6）。已送达 / 已退回 → false */
  async withdrawNote(sessionId: string, noteId: string): Promise<boolean> {
    const { withdrawn } = await this.request('session.note.withdraw', { sessionId, noteId })
    if (withdrawn) this.watches.get(sessionId)?.sent.delete(noteId)
    return withdrawn
  }

  /** 中断当前轮（PRD-M13-002）。会话闲着 → false */
  async interrupt(sessionId: string): Promise<boolean> {
    return (await this.request('session.interrupt', { sessionId })).interrupted
  }

  /** 本地副本对账：daemon 队列里没有、也没见送达的补充 → 退回输入框 */
  private reconcileNotes(w: Watch): void {
    const back: string[] = []
    for (const [id, text] of w.sent) {
      if (w.snapshot?.has(id)) continue
      back.push(text)
      w.sent.delete(id)
    }
    if (back.length > 0) w.store.addReturned(back)
  }

  /** 报告已读到视图第几条（PRD-M8-009）。老 daemon 没有这个方法时静默忽略 */
  async markRead(sessionId: string, seq: number): Promise<boolean> {
    try {
      return (await this.request('session.read', { sessionId, seq })).changed
    } catch (e) {
      if (e instanceof DomiRpcError && e.code === 'UNKNOWN_METHOD') return false
      throw e
    }
  }

  /** 这个会话订阅到了第几条（已读位置用） */
  watchedSeq(sessionId: string): number {
    return this.watches.get(sessionId)?.lastSeq ?? 0
  }

  /** 用量汇总（PRD-M8-013）。from / to 是毫秒时间戳，左闭右开 */
  usage(from: number, to: number): Promise<ResultOf<'usage.summary'>> {
    return this.request('usage.summary', { from, to })
  }

  // ── Composer（PRD-M8-010） ──

  async listFiles(sessionId: string, query = '', limit = 50): Promise<ResultOf<'fs.list'>> {
    return this.request('fs.list', { sessionId, query, limit })
  }

  /** 上传附件。dataBase64 不带 data: 前缀；超过上限抛 DomiRpcError（data.reason = TOO_LARGE） */
  putAttachment(sessionId: string, file: { name: string; mime: string; dataBase64: string }) {
    return this.request('attachment.put', { sessionId, ...file })
  }

  async listSkills(sessionId?: string): Promise<ResultOf<'skill.list'>['skills']> {
    return (await this.request('skill.list', sessionId === undefined ? {} : { sessionId })).skills
  }

  /** refresh：跳过 10 分钟缓存重新探测（设置页「重新探测」） */
  listModels(refresh = false): Promise<ResultOf<'model.list'>> {
    return this.request('model.list', refresh ? { refresh } : {})
  }

  /**
   * 回答一次权限询问。返回 false = 没生效（已经被别的客户端答过）。
   * 不在这里清确认框：等 daemon 推 session.askDone 再清，所有客户端走同一条路
   */
  /** channel：在哪个端上答的（M5-007）。不给就由 daemon 用握手时的客户端名 */
  /** grant：本会话内始终允许（M8-016），只在询问 grantable 时生效 */
  async answer(
    askId: string,
    allowed: boolean,
    content?: Record<string, unknown>,
    channel?: string,
    grant?: boolean,
  ): Promise<boolean> {
    const r = await this.request('session.answer', {
      askId,
      allowed,
      ...(content === undefined ? {} : { content }),
      ...(channel === undefined ? {} : { channel }),
      ...(grant === true ? { grant: true } : {}),
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
    const w = this.watches.get(sessionId) ?? {
      store,
      lastSeq: 0,
      sent: new Map<string, string>(),
      snapshot: null,
      delivered: new Set<string>(),
      unclaimed: new Map<string, string>(),
    }
    w.store = store
    this.watches.set(sessionId, w)
    // 必须在 await 之前把 fromSeq 记到局部变量：daemon 端先推 session.events 通知（带 backlog），
    // 再回 RPC response。client 收到通知时 deliver() 会把 w.lastSeq 更新成 backlog 尾部 seq，
    // 等 await resolve 时 w.lastSeq 早就不是 0 了——之前用 w.lastSeq===0 判定首连永远不成立，
    // setWindowMeta 不执行，hasOlder 永远 false，翻页入口根本不触发。
    const fromSeq = w.lastSeq
    w.snapshot = null
    const res = await this.request('session.subscribe', { sessionId, fromSeq })
    this.reconcileNotes(w)
    // PRD-M11-009：首连（fromSeq=0）服务端回尾部窗口，把窗口边界写进 store
    if (fromSeq === 0 && res.oldestSeq !== undefined && res.hasOlder !== undefined) {
      store.setWindowMeta({ oldestSeq: res.oldestSeq, hasOlder: res.hasOlder })
    }
    return res
  }

  /**
   * PRD-M11-009：向上翻一页——取 view seq < beforeSeq 的更早窗口，prepend 进 store。
   * 返回 hasOlder（true 表示还能继续往上翻）。
   */
  async loadOlder(sessionId: string): Promise<boolean> {
    const w = this.watches.get(sessionId)
    if (!w) return false
    const oldestSeq = w.store.$oldestSeq.get()
    const hasOlder = w.store.$hasOlder.get()
    if (oldestSeq === null || !hasOlder) return false
    w.store.setLoadingOlder(true)
    try {
      const page = await this.request('session.history', { sessionId, beforeSeq: oldestSeq })
      w.store.prependEvents(page.events)
      w.store.setWindowMeta({ oldestSeq: page.fromSeq, hasOlder: page.hasOlder })
      return page.hasOlder
    } finally {
      w.store.setLoadingOlder(false)
    }
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
        settle(() => reject(new Error(tr('core.client.closed'))))
      })
      socket.addEventListener('error', () => {
        this.$lastError.set(tr('core.client.unreachable'))
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
        w.snapshot = null
        await this.request('session.subscribe', { sessionId, fromSeq: w.lastSeq })
        // 断开期间 daemon 可能重启过、队列没了：本端还在等的补充退回输入框（PRD-M13-001 AC-7）
        this.reconcileNotes(w)
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
        ...(p.grantable === true ? { grantable: true } : {}),
      })
    } else if (msg.method === 'session.askDone') {
      const p = msg.params as NotifyParamsOf<'session.askDone'>
      const store = this.watches.get(p.sessionId)?.store
      // 只清同一个询问：答完之后紧接着来了下一个的话，不能把新的也清掉
      if (store && store.$ask.get()?.askId === p.askId) store.setAsk(null)
    } else if (msg.method === 'session.notes') {
      const p = msg.params as NotifyParamsOf<'session.notes'>
      const w = this.watches.get(p.sessionId)
      if (w) {
        w.snapshot = new Set(p.pending.map((n) => n.id))
        w.store.setNotes(p.pending)
      }
    } else if (msg.method === 'session.notes.returned') {
      // 只认领本端发的：别的端发的退回到它们自己的输入框（PRD-M13-001 AC-7）
      const p = msg.params as NotifyParamsOf<'session.notes.returned'>
      const w = this.watches.get(p.sessionId)
      if (w) {
        const mine: string[] = []
        for (const n of p.notes) {
          if (w.sent.has(n.id)) {
            mine.push(n.text)
            w.sent.delete(n.id)
          } else if (!w.delivered.has(n.id)) {
            w.unclaimed.set(n.id, n.text)
          }
        }
        if (mine.length > 0) w.store.addReturned(mine)
      }
    } else if (msg.method === 'sessions.changed') {
      this.changedIds = (msg.params as NotifyParamsOf<'sessions.changed'>).sessionIds
      this.$sessionsVersion.set(this.$sessionsVersion.get() + 1)
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
    // 补充送达了：user.note 本身，或由残留补充拼成的 user.input（SPEC-M13-001 取舍-4）
    for (const e of fresh) {
      const ev = e.ev as { t: string; id?: unknown; noteIds?: unknown }
      const ids =
        ev.t === 'user.note' && typeof ev.id === 'string'
          ? [ev.id]
          : ev.t === 'user.input' && Array.isArray(ev.noteIds)
            ? (ev.noteIds as string[])
            : []
      for (const id of ids) {
        w.sent.delete(id)
        w.delivered.add(id)
      }
    }
    w.store.applyEvents(fresh)
  }

  private onClose(socket: WireSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    for (const p of this.pending.values()) p.reject(new Error(tr('core.client.dropped')))
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
