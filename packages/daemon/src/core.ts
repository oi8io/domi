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
  type NotifyParamsOf,
  notify,
  ok,
  type ParamsOf,
  PROTOCOL_VERSION,
  type RefLink,
  type ResultOf,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
  type Schedule,
  versionMismatch,
} from '@domi/protocol'
import type { ScheduleRunRow } from '@domi/store'
import {
  ScheduleBusyError,
  ScheduleNotFoundError,
  Scheduler,
  type SchedulerDeps,
  type ScheduleStore,
} from './scheduler.ts'

export const DAEMON_VERSION = '0.1.0'

/** 成功之后会话列表就变了的方法（新建、删除、恢复、改名、分支、转任务） */
const LIST_CHANGING = new Set<string>([
  'session.create',
  'session.delete',
  'session.restore',
  'session.rename',
  'session.branch',
  'session.toTask',
  'task.create',
  'review.start',
  'schedule.runNow',
])

const hasExtras = (p: SubmitExtras): boolean =>
  (p.uploads?.length ?? 0) + (p.files?.length ?? 0) + (p.skills?.length ?? 0) > 0

const extrasOf = (p: SubmitExtras): SubmitExtras => ({
  ...(p.uploads && p.uploads.length > 0 ? { uploads: p.uploads } : {}),
  ...(p.files && p.files.length > 0 ? { files: p.files } : {}),
  ...(p.skills && p.skills.length > 0 ? { skills: p.skills } : {}),
})

/** 调度器触发任务时用的内部连接：不订阅、不收推送 */
const SYSTEM_CONN: ClientConn = { id: '_scheduler', send() {} }

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

/** 分叉点不在会话里（比 head 大）。翻译成 INVALID_PARAMS：是请求错了，不是会话没了 */
export class BranchPointError extends Error {
  constructor(
    readonly sessionId: string,
    readonly atSeq: number,
    readonly head: number,
  ) {
    super(`分叉点越界：会话 ${sessionId} 只有 ${head} 条，没有第 ${atSeq} 条`)
    this.name = 'BranchPointError'
  }
}

/** 跨会话引用不成立。翻译成 INVALID_PARAMS */
export class InvalidRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRefError'
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
  submit(text: string, refs?: readonly RefLink[], inputs?: SubmitExtras): Promise<unknown>
  /** 校验并规整引用；不成立时抛 InvalidRefError。在接受提交之前调 */
  checkRefs?(refs: readonly RefLink[]): Promise<RefLink[]>
  /** 校验附件 / 文件 / 技能（PRD-M8-010）；不成立时抛 InvalidInputError */
  checkInputs?(inputs: SubmitExtras): Promise<void>
  switchModel(model: string, provider?: string): Promise<{ lost: string[] }>
  /** 计划 / 执行模式（M7-005）。老宿主没有 */
  setMode?(mode: 'plan' | 'act'): Promise<{ mode: 'plan' | 'act'; changed: boolean }>
  /** 用量上限（M7-009） */
  setBudget?(b: { tokens?: number; costUsd?: number; toolCalls?: number }): Promise<void>
  compactNow(trigger: 'manual' | 'threshold'): Promise<{ ok: boolean; detail: string }>
  readEvents(fromSeq: number): Promise<EventEnvelope[]>
  head(): Promise<number>
  close(): Promise<void>
}

/** 一轮输入里除文字之外的东西（PRD-M8-010） */
export interface SubmitExtras {
  uploads?: readonly string[]
  files?: readonly string[]
  skills?: readonly string[]
}

/** 附件 / 文件引用 / 技能不成立（PRD-M8-010）。→ INVALID_PARAMS，data.reason 带原因 */
export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

/** Composer 要的几样（PRD-M8-010）。老宿主没有 */
export interface HostComposer {
  files(sessionId: string, query: string, limit: number): Promise<ResultOf<'fs.list'>>
  attach(sessionId: string, file: { name: string; mime: string; data: Uint8Array }): Promise<ResultOf<'attachment.put'>>
  skills(sessionId: string | undefined): Promise<ResultOf<'skill.list'>['skills']>
  models(): Promise<ResultOf<'model.list'>>
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  updatedAt: number
  eventCount: number
  deleted: boolean
  parentId?: string
  kind?: 'chat' | 'task'
  projectId?: string
  cwd?: string
  busy?: boolean
  unread?: boolean
}

export type ProjectSummary = ResultOf<'project.list'>['projects'][number]

/** 项目（PRD-M8-003）。路径不存在等参数问题抛 HostRequestError */
export interface HostProjects {
  list(opts: { includeArchived: boolean; recent: number }): Promise<ProjectSummary[]>
  create(path: string, name?: string): Promise<ProjectSummary>
  update(id: string, patch: ParamsOf<'project.update'>): Promise<ProjectSummary>
  archive(id: string, archived: boolean): Promise<void>
  resolve(cwd: string): Promise<ResultOf<'project.resolve'>>
}

/** 定时任务（PRD-M8-007）。cron / 时区不合法抛 HostRequestError（data.reason = INVALID_CRON） */
export interface HostSchedules {
  /** 调度器读写的那几张表 */
  store: ScheduleStore
  list(): Promise<Schedule[]>
  create(p: ParamsOf<'schedule.create'>): Promise<Schedule>
  update(p: ParamsOf<'schedule.update'>): Promise<Schedule>
  remove(id: string): Promise<void>
  runs(id: string, limit: number): Promise<ScheduleRunRow[]>
  preview(cron: string, tz: string | undefined, count: number): Promise<ResultOf<'schedule.preview'>>
}

export interface CreateOptions {
  kind?: 'chat' | 'task'
  projectId?: string
}

/** 一次权限询问。answer 由宿主提供，core 只负责把它交到某个客户端手里 */
export interface HostAsk {
  askId: string
  capabilityId: string
  /** 完整的待执行内容，确认框必须显示它（PRD-M0-003 AC-1） */
  detail: string
  /** 表单型询问（工具要输入） */
  form?: { message: string; schema: unknown }
  /** 可以答「本会话始终允许」（PRD-M8-016） */
  grantable?: boolean
  answer(allowed: boolean, content?: Record<string, unknown>, channel?: string, grant?: boolean): void
}

export type HostMetrics = NotifyParamsOf<'session.metrics'>['metrics']

export type MemoryItemSummary = ResultOf<'memory.list'>['items'][number]

/** 记忆与 Soul（PRD-M4）。宿主没有它时，这几个方法回 INTERNAL「不支持」 */
export interface HostMemory {
  list(includeDeleted: boolean): Promise<MemoryItemSummary[]>
  search(query: string, limit: number): Promise<ResultOf<'memory.search'>>
  remove(id: string): Promise<boolean>
  extract(sessionId: string): Promise<ResultOf<'memory.extract'>>
  soul(): Promise<ResultOf<'soul.get'>>
  changes(): Promise<ResultOf<'soul.changes'>['changes']>
  review(changeId: string, decision: 'accept' | 'reject'): Promise<ResultOf<'soul.review'>>
  update(): Promise<ResultOf<'soul.update'>['changes']>
  /** M8-012：编辑、导出、导入。老宿主没有 */
  writeSoul?(text: string, mtime: number | undefined): Promise<ResultOf<'soul.write'>>
  exportSoul?(): Promise<ResultOf<'soul.export'>>
  importSoul?(p: ParamsOf<'soul.import'>): Promise<ResultOf<'soul.import'>>
}

/** DAG 编排（PRD-M5-002）。不合法的定义 / 不能重试的状态抛 InvalidTaskError */
export interface HostTasks {
  start(spec: string, cwd?: string): Promise<ResultOf<'task.start'>>
  list(): Promise<ResultOf<'task.list'>['runs']>
  get(runId: string): Promise<ResultOf<'task.get'>>
  retry(runId: string, nodeId: string): Promise<void>
  cancel(runId: string): Promise<boolean>
}

/** 宿主拒绝了一个请求（参数本身合法，但当前状态不允许，比如不是隔离会话）。→ INVALID_PARAMS */
export class HostRequestError extends Error {
  constructor(
    message: string,
    /** 结构化细节，原样放进错误响应的 data */
    readonly data?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HostRequestError'
  }
}

/** 隔离工作区（PRD-M7-006） */
export interface HostWorktrees {
  create(cwd: string | undefined): Promise<ResultOf<'session.create'>>
  diff(sessionId: string): Promise<ResultOf<'worktree.diff'>>
  discard(sessionId: string, path: string): Promise<string>
  restore(sessionId: string, trash: string): Promise<string>
  apply(sessionId: string, mode: 'squash' | 'merge' | 'branch', message?: string): Promise<ResultOf<'worktree.apply'>>
}

export class InvalidTaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTaskError'
  }
}

/** 宿主提供的东西。测试注入假的，生产注入真的 —— core 两边都不知道 */
export interface DaemonHost {
  open(sessionId: string): Promise<SessionHandle>
  create(cwd?: string, opts?: CreateOptions): Promise<string>
  list(opts: { includeDeleted: boolean; kind?: 'chat' | 'task'; projectId?: string }): Promise<SessionSummary[]>
  /** 按目标新建任务（PRD-M8-005）。返回会话 id；提交目标由 core 走普通提交那条路 */
  createTask?(p: {
    projectId: string
    goal: string
    trigger?: 'user' | 'schedule'
    /** 定时触发时：落在新任务里的 schedule.fire */
    schedule?: { scheduleId: string; due: number; late: boolean }
  }): Promise<Omit<ResultOf<'task.create'>, 'sessionId'> & { sessionId: string }>
  /** 改标题（PRD-M8-008）。会话不存在抛 SessionNotFoundError */
  rename?(sessionId: string, title: string): Promise<void>
  projects?: HostProjects
  schedules?: HostSchedules
  composer?: HostComposer
  /** 设置页（PRD-M8-011）。补丁不合法抛 HostRequestError */
  config?: {
    get(): Promise<ResultOf<'config.get'>>
    set(patch: Record<string, unknown>): Promise<ResultOf<'config.set'>>
  }
  /** 用量汇总（PRD-M8-013）。老宿主没有 */
  usage?(from: number, to: number): Promise<ResultOf<'usage.summary'>>
  /** 已读位置（PRD-M8-009）。seq 是视图编号；返回是否推进了 */
  markRead?(sessionId: string, seq: number): Promise<boolean>
  /** 软删除 / 恢复。会话不存在时抛 SessionNotFoundError */
  remove(sessionId: string): Promise<void>
  restore(sessionId: string): Promise<void>
  /**
   * 从会话视图的第 atSeq 条分出新会话，返回新 id。
   * 会话不存在抛 SessionNotFoundError；越界抛 BranchPointError
   */
  branch(sessionId: string, atSeq: number): Promise<string>
  memory?: HostMemory
  tasks?: HostTasks
  worktrees?: HostWorktrees
  /** 审阅子 agent（M7-010） */
  review?(p: { cwd?: string; base?: string; specs?: string[]; fromSessionId?: string }): Promise<string>
  plugins?: {
    list(): Promise<ResultOf<'plugin.list'>>
    /** 没有这个面板时返回 null */
    ui(plugin: string, id: string): Promise<string | null>
  }
  /** 端上报来的审计事件 */
  auditRecord?(kind: string, detail: string, client: string): Promise<void>
  /** 会话产生新事件时调用；daemon 据此推给订阅者 */
  onEvents(cb: (sessionId: string, events: EventEnvelope[]) => void): void
  onBusy?(cb: (sessionId: string, busy: boolean) => void): void
  onAsk?(cb: (sessionId: string, ask: HostAsk) => void): void
  onMetrics?(cb: (sessionId: string, metrics: HostMetrics) => void): void
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
  /** 握手时报的客户端名。审批的 channel 缺省用它 */
  private readonly clientNames = new Map<string, string>()
  private readonly subs = new Map<string, Subscription[]>()
  private readonly sessions = new Map<string, SessionHandle>()
  /** 正在处理中的会话。串行化与 SESSION_BUSY 都看它 */
  private readonly busy = new Set<string>()
  /** 宿主报告的忙闲（真正在跑模型/工具）。订阅时补发，重连的客户端才知道「还在跑」 */
  private readonly hostBusy = new Set<string>()
  /** 等人回答的询问。任务停在那里等，所以订阅时必须补发——否则后连上来的客户端永远看不见它 */
  private readonly asks = new Map<string, HostAsk & { sessionId: string }>()
  private readonly metrics = new Map<string, HostMetrics>()
  private scheduler: Scheduler | null = null
  /** 已握手的连接（sessions.changed 推给所有人） */
  private readonly conns = new Map<string, ClientConn>()
  private changed = new Set<string>()
  private changedTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly host: DaemonHost) {
    host.onEvents((sessionId, events) => {
      this.push(sessionId, events)
      this.touch(sessionId)
    })
    host.onBusy?.((sessionId, b) => {
      if (b) this.hostBusy.add(sessionId)
      else this.hostBusy.delete(sessionId)
      this.touch(sessionId)
      this.broadcast(sessionId, notify('session.busy', { sessionId, busy: b }))
    })
    host.onAsk?.((sessionId, ask) => {
      this.asks.set(ask.askId, { ...ask, sessionId })
      this.broadcast(sessionId, this.askNotice(sessionId, ask))
    })
    host.onMetrics?.((sessionId, m) => {
      this.metrics.set(sessionId, m)
      this.broadcast(sessionId, notify('session.metrics', { sessionId, metrics: m }))
    })
  }

  private askNotice(sessionId: string, ask: HostAsk): RpcNotification {
    return notify('session.ask', {
      askId: ask.askId,
      sessionId,
      capabilityId: ask.capabilityId,
      detail: ask.detail,
      ...(ask.form === undefined ? {} : { form: ask.form }),
      ...(ask.grantable === true ? { grantable: true } : {}),
    })
  }

  /** 发给某个会话的全部订阅者。补发历史中的订阅者也照发：这些是状态，不是事件，不存在顺序问题 */
  private broadcast(sessionId: string, msg: RpcNotification): void {
    for (const s of this.subs.get(sessionId) ?? []) s.conn.send(msg)
  }

  /** 会话列表有变化：攒 500ms 一起推（PRD-M8-009 AC-1） */
  private touch(sessionId: string): void {
    if (sessionId.startsWith('_')) return
    this.changed.add(sessionId)
    if (this.changedTimer !== null) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      const ids = [...this.changed]
      this.changed = new Set()
      const msg = notify('sessions.changed', { sessionIds: ids })
      for (const c of this.conns.values()) c.send(msg)
    }, 500)
    ;(this.changedTimer as { unref?: () => void }).unref?.()
  }

  /** 客户端断开：只清订阅，**不动会话**——任务照常跑完（M3-002 AC-2） */
  disconnect(conn: ClientConn): void {
    this.conns.delete(conn.id)
    this.handshaked.delete(conn.id)
    this.clientNames.delete(conn.id)
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
      const res = await this.dispatch(conn, req, method, parsed.data as never)
      if (LIST_CHANGING.has(method) && res.error === undefined) {
        const p = parsed.data as { sessionId?: unknown }
        const r = res.result as { sessionId?: unknown } | undefined
        for (const id of [p.sessionId, r?.sessionId]) if (typeof id === 'string') this.touch(id)
      }
      return res
    } catch (e) {
      if (e instanceof SessionNotFoundError) return fail(req.id, 'SESSION_NOT_FOUND', e.message)
      if (
        e instanceof BranchPointError ||
        e instanceof InvalidRefError ||
        e instanceof InvalidTaskError ||
        e instanceof HostRequestError ||
        e instanceof ScheduleNotFoundError
      ) {
        return fail(req.id, 'INVALID_PARAMS', e.message, e instanceof HostRequestError ? e.data : undefined)
      }
      if (e instanceof InvalidInputError) return fail(req.id, 'INVALID_PARAMS', e.message, { reason: e.reason })
      if (e instanceof ScheduleBusyError) return fail(req.id, 'SESSION_BUSY', e.message)
      return fail(req.id, 'INTERNAL', e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * 启动调度器（PRD-M8-007）。domid 开门之后调；测试注入时钟与定时器。
   * 触发 = 按目标建任务（trigger: schedule）+ 走普通的提交路径，所以忙闲、推送与手动建的任务完全一样
   */
  startScheduler(
    o: { now?: () => number; setTimer?: SchedulerDeps['setTimer']; log?: (l: string) => void } = {},
  ): Promise<void> {
    const h = this.host.schedules
    const create = this.host.createTask?.bind(this.host)
    if (!h || !create) return Promise.resolve()
    this.scheduler?.stop()
    this.scheduler = new Scheduler({
      store: h.store,
      now: o.now ?? Date.now,
      setTimer:
        o.setTimer ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms)
          t.unref?.()
          return () => clearTimeout(t)
        }),
      isBusy: (id) => this.isBusy(id),
      ...(o.log === undefined ? {} : { log: o.log }),
      fire: async (s, due, late) => {
        const r = await create({
          projectId: s.projectId,
          goal: s.goal,
          trigger: 'schedule',
          schedule: { scheduleId: s.id, due, late },
        })
        const sub = await this.dispatch(
          SYSTEM_CONN,
          { jsonrpc: '2.0', id: 0, method: 'session.submit' },
          'session.submit',
          {
            sessionId: r.sessionId,
            text: s.goal,
          } as never,
        )
        if (sub.error) throw new Error(sub.error.message)
        return r.sessionId
      },
    })
    return this.scheduler.start()
  }

  stopScheduler(): void {
    this.scheduler?.stop()
    this.scheduler = null
  }

  private async scheduleCall(method: MethodName, params: unknown): Promise<unknown> {
    const h = this.host.schedules
    if (!h) throw new HostRequestError('这个 domid 不支持定时任务')
    const p = params as Record<string, unknown>
    const changed = <T>(v: T): T => {
      this.scheduler?.reschedule()
      return v
    }
    switch (method) {
      case 'schedule.list':
        return { schedules: await h.list() }
      case 'schedule.create':
        return changed({ schedule: await h.create(p as ParamsOf<'schedule.create'>) })
      case 'schedule.update':
        return changed({ schedule: await h.update(p as ParamsOf<'schedule.update'>) })
      case 'schedule.delete':
        await h.remove(p.id as string)
        return changed({ ok: true })
      case 'schedule.runNow': {
        if (!this.scheduler) throw new HostRequestError('调度器没有启动')
        return { sessionId: await this.scheduler.runNow(p.id as string) }
      }
      case 'schedule.runs': {
        const runs = await h.runs(p.id as string, (p.limit as number | undefined) ?? 20)
        return {
          runs: runs.map((r) => ({
            ...(r.sessionId === null ? {} : { sessionId: r.sessionId }),
            due: r.due,
            firedAt: r.firedAt,
            late: r.late,
            skipped: r.skipped,
            status: r.skipped
              ? 'skipped'
              : r.sessionId === null
                ? 'failed'
                : this.isBusy(r.sessionId)
                  ? 'running'
                  : 'done',
          })),
        }
      }
      case 'schedule.preview':
        return h.preview(p.cron as string, p.tz as string | undefined, (p.count as number | undefined) ?? 3)
      default:
        throw new Error(`不是定时任务方法：${method}`)
    }
  }

  private async memoryCall(method: MethodName, params: unknown): Promise<unknown> {
    const m = this.host.memory
    if (!m) throw new Error('这个 daemon 没有开启记忆（PRD-M4）')
    const p = params as Record<string, unknown>
    switch (method) {
      case 'memory.list':
        return { items: await m.list(p.includeDeleted === true) }
      case 'memory.search':
        return m.search(p.query as string, (p.limit as number | undefined) ?? 10)
      case 'memory.delete':
        return { ok: await m.remove(p.id as string) }
      case 'memory.extract':
        if (this.isBusy(p.sessionId as string)) {
          // 不在这里 fail：dispatch 外层只认异常。忙的时候抽取读到的是半轮，结果不可信
          throw new Error('这个会话正在处理，等这一轮结束再抽取')
        }
        return m.extract(p.sessionId as string)
      case 'soul.get':
        return m.soul()
      case 'soul.changes':
        return { changes: await m.changes() }
      case 'soul.review':
        return m.review(p.changeId as string, p.decision as 'accept' | 'reject')
      case 'soul.write':
        if (!m.writeSoul) throw new Error('这个 domid 不支持在界面里编辑 Soul')
        return m.writeSoul(p.text as string, p.mtime as number | undefined)
      case 'soul.export':
        if (!m.exportSoul) throw new Error('这个 domid 不支持导出 Soul')
        return m.exportSoul()
      case 'soul.import':
        if (!m.importSoul) throw new Error('这个 domid 不支持导入 Soul')
        return m.importSoul(p as ParamsOf<'soul.import'>)
      default:
        return { changes: await m.update() }
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
        this.clientNames.set(conn.id, p.client)
        if (conn.id !== SYSTEM_CONN.id) this.conns.set(conn.id, conn)
        return ok(req.id, { protocolVersion: PROTOCOL_VERSION, serverVersion: DAEMON_VERSION, methods: METHOD_NAMES })
      }

      case 'session.list': {
        const p = params as { includeDeleted?: boolean; kind?: 'chat' | 'task'; projectId?: string }
        const list = await this.host.list({
          includeDeleted: p.includeDeleted ?? false,
          ...(p.kind === undefined ? {} : { kind: p.kind }),
          ...(p.projectId === undefined ? {} : { projectId: p.projectId }),
        })
        return ok(req.id, { sessions: list.map((x) => ({ ...x, busy: this.isBusy(x.id) })) })
      }

      case 'session.rename': {
        const p = params as { sessionId: string; title: string }
        if (!this.host.rename) return fail(req.id, 'INTERNAL', '这个 domid 不支持改标题')
        await this.host.rename(p.sessionId, p.title.trim())
        return ok(req.id, { ok: true })
      }

      case 'task.create': {
        const p = params as { projectId: string; goal: string }
        if (!this.host.createTask) return fail(req.id, 'INTERNAL', '这个 domid 不支持按目标建任务')
        const r = await this.host.createTask(p)
        const submitted = await this.dispatch(conn, req, 'session.submit', {
          sessionId: r.sessionId,
          text: p.goal,
        } as never)
        if (submitted.error) return submitted
        return ok(req.id, r)
      }

      case 'session.toTask': {
        const p = params as { sessionId: string; projectId: string; goal: string }
        const from = (await this.host.list({ includeDeleted: true })).find((x) => x.id === p.sessionId)
        if (!from) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        const id = await this.host.create(undefined, { kind: 'task', projectId: p.projectId })
        // 引用原会话全文（终点给大，daemon 截到末尾）；走和普通提交同一条路
        const submitted = await this.dispatch(conn, req, 'session.submit', {
          sessionId: id,
          text: p.goal,
          refs: [{ sessionId: p.sessionId, fromSeq: 1, toSeq: Number.MAX_SAFE_INTEGER }],
        } as never)
        if (submitted.error) return submitted
        return ok(req.id, { sessionId: id })
      }

      case 'config.get':
      case 'config.set': {
        const h = this.host.config
        if (!h) return fail(req.id, 'INTERNAL', '这个 domid 不支持从这里改配置')
        if (method === 'config.get') return ok(req.id, await h.get())
        return ok(req.id, await h.set((params as { patch: Record<string, unknown> }).patch))
      }

      case 'usage.summary': {
        const p = params as { from: number; to: number }
        if (!this.host.usage) return fail(req.id, 'INTERNAL', '这个 domid 不支持用量统计')
        return ok(req.id, await this.host.usage(p.from, p.to))
      }

      case 'fs.list':
      case 'attachment.put':
      case 'skill.list':
      case 'model.list': {
        const h = this.host.composer
        if (!h) return fail(req.id, 'INTERNAL', '这个 domid 不支持附件与文件引用')
        const p = params as Record<string, unknown>
        switch (method) {
          case 'fs.list':
            return ok(
              req.id,
              await h.files(
                p.sessionId as string,
                (p.query as string | undefined) ?? '',
                (p.limit as number | undefined) ?? 50,
              ),
            )
          case 'attachment.put': {
            const data = Buffer.from(p.dataBase64 as string, 'base64')
            return ok(
              req.id,
              await h.attach(p.sessionId as string, { name: p.name as string, mime: p.mime as string, data }),
            )
          }
          case 'skill.list':
            return ok(req.id, { skills: await h.skills(p.sessionId as string | undefined) })
          default:
            return ok(req.id, await h.models())
        }
      }

      case 'schedule.list':
      case 'schedule.create':
      case 'schedule.update':
      case 'schedule.delete':
      case 'schedule.runNow':
      case 'schedule.runs':
      case 'schedule.preview':
        return ok(req.id, await this.scheduleCall(method, params))

      case 'project.list':
      case 'project.create':
      case 'project.update':
      case 'project.archive':
      case 'project.resolve': {
        const h = this.host.projects
        if (!h) return fail(req.id, 'INTERNAL', '这个 domid 不支持项目')
        const p = params as Record<string, unknown>
        if (method === 'project.list') {
          return ok(req.id, {
            projects: await h.list({
              includeArchived: p.includeArchived === true,
              recent: (p.recent as number | undefined) ?? 5,
            }),
          })
        }
        if (method === 'project.create') {
          return ok(req.id, { project: await h.create(p.path as string, p.name as string | undefined) })
        }
        if (method === 'project.update') {
          return ok(req.id, { project: await h.update(p.id as string, p as ParamsOf<'project.update'>) })
        }
        if (method === 'project.archive') {
          await h.archive(p.id as string, p.archived === true)
          return ok(req.id, { ok: true })
        }
        return ok(req.id, await h.resolve(p.cwd as string))
      }

      case 'session.delete': {
        const p = params as { sessionId: string }
        if (this.isBusy(p.sessionId)) return fail(req.id, 'SESSION_BUSY', '这个会话正在处理，等它停下来再删')
        await this.host.remove(p.sessionId)
        const open = this.sessions.get(p.sessionId)
        this.sessions.delete(p.sessionId)
        await open?.close()
        return ok(req.id, { ok: true })
      }

      case 'session.restore': {
        const p = params as { sessionId: string }
        await this.host.restore(p.sessionId)
        return ok(req.id, { ok: true })
      }

      case 'session.branch': {
        const p = params as { sessionId: string; atSeq: number }
        return ok(req.id, { sessionId: await this.host.branch(p.sessionId, p.atSeq) })
      }

      case 'task.start':
      case 'task.list':
      case 'task.get':
      case 'task.retry':
      case 'task.cancel': {
        const t = this.host.tasks
        if (!t) throw new Error('这个 daemon 不支持编排（PRD-M5）')
        const p = params as { spec?: string; cwd?: string; runId?: string; nodeId?: string }
        if (method === 'task.start') return ok(req.id, await t.start(p.spec as string, p.cwd))
        if (method === 'task.list') return ok(req.id, { runs: await t.list() })
        if (method === 'task.get') return ok(req.id, await t.get(p.runId as string))
        if (method === 'task.retry') {
          await t.retry(p.runId as string, p.nodeId as string)
          return ok(req.id, { ok: true })
        }
        return ok(req.id, { ok: await t.cancel(p.runId as string) })
      }

      case 'plugin.list':
      case 'plugin.ui': {
        const pl = this.host.plugins
        if (!pl) throw new Error('这个 daemon 不支持插件（PRD-M6）')
        if (method === 'plugin.list') return ok(req.id, await pl.list())
        const p = params as { plugin: string; id: string }
        const html = await pl.ui(p.plugin, p.id)
        if (html === null) return fail(req.id, 'INVALID_PARAMS', `没有插件面板 ${p.plugin}/${p.id}`)
        return ok(req.id, { html })
      }

      case 'audit.record': {
        const p = params as { kind: string; detail: string }
        await this.host.auditRecord?.(p.kind, p.detail, this.clientNames.get(conn.id) ?? 'unknown')
        return ok(req.id, { ok: true })
      }

      case 'memory.list':
      case 'memory.search':
      case 'memory.delete':
      case 'memory.extract':
      case 'soul.get':
      case 'soul.changes':
      case 'soul.review':
      case 'soul.write':
      case 'soul.export':
      case 'soul.import':
      case 'soul.update':
        return ok(req.id, await this.memoryCall(method, params))

      case 'session.switchModel': {
        const p = params as { sessionId: string; model: string; provider?: string }
        // 一轮进行到一半换模型，后半轮和前半轮就不是同一个模型答的了
        if (this.isBusy(p.sessionId)) return fail(req.id, 'SESSION_BUSY', '这个会话正在处理，等这一轮结束再切')
        const session = await this.session(p.sessionId)
        if (!session) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        return ok(req.id, await session.switchModel(p.model, p.provider))
      }

      case 'review.start': {
        if (!this.host.review) return fail(req.id, 'INTERNAL', '这个 domid 不支持审阅')
        const p = params as { cwd?: string; base?: string; specs?: string[]; fromSessionId?: string }
        return ok(req.id, { sessionId: await this.host.review(p) })
      }

      case 'session.budget': {
        const p = params as { sessionId: string; budget: { tokens?: number; costUsd?: number; toolCalls?: number } }
        const session = await this.session(p.sessionId)
        if (!session) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        if (!session.setBudget) return fail(req.id, 'INTERNAL', '这个 domid 不支持用量上限')
        await session.setBudget(p.budget)
        return ok(req.id, { ok: true })
      }

      case 'session.mode': {
        const p = params as { sessionId: string; mode: 'plan' | 'act' }
        if (this.isBusy(p.sessionId)) return fail(req.id, 'SESSION_BUSY', '这个会话正在处理，等这一轮结束再切')
        const session = await this.session(p.sessionId)
        if (!session) return fail(req.id, 'SESSION_NOT_FOUND', `没有这个会话：${p.sessionId}`)
        if (!session.setMode) return fail(req.id, 'INTERNAL', '这个 domid 不支持计划模式')
        return ok(req.id, await session.setMode(p.mode))
      }

      case 'session.create': {
        const p = params as { cwd?: string; isolate?: boolean; kind?: 'chat' | 'task'; projectId?: string }
        if (p.isolate) {
          if (!this.host.worktrees) return fail(req.id, 'INTERNAL', '这个 domid 不支持隔离工作区')
          return ok(req.id, await this.host.worktrees.create(p.cwd))
        }
        const opts: CreateOptions = {
          ...(p.kind === undefined ? {} : { kind: p.kind }),
          ...(p.projectId === undefined ? {} : { projectId: p.projectId }),
        }
        return ok(req.id, { sessionId: await this.host.create(p.cwd, opts) })
      }

      case 'worktree.diff':
      case 'worktree.discard':
      case 'worktree.restore':
      case 'worktree.apply': {
        const w = this.host.worktrees
        if (!w) return fail(req.id, 'INTERNAL', '这个 domid 不支持隔离工作区')
        const p = params as {
          sessionId: string
          path?: string
          trash?: string
          mode?: 'squash' | 'merge' | 'branch'
          message?: string
        }
        if (method === 'worktree.diff') return ok(req.id, await w.diff(p.sessionId))
        // 改工作区的操作和会话里的一轮互斥：模型正在改文件时丢弃 / 带回，结果说不清
        if (this.isBusy(p.sessionId)) return fail(req.id, 'SESSION_BUSY', '这个会话正在处理，等这一轮结束再操作')
        if (method === 'worktree.discard') return ok(req.id, { trash: await w.discard(p.sessionId, p.path as string) })
        if (method === 'worktree.restore') return ok(req.id, { path: await w.restore(p.sessionId, p.trash as string) })
        return ok(req.id, await w.apply(p.sessionId, p.mode ?? 'squash', p.message))
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
        // 事件之外的三样状态也补上：指标、忙闲、还在等回答的询问
        const m = this.metrics.get(p.sessionId)
        if (m) conn.send(notify('session.metrics', { sessionId: p.sessionId, metrics: m }))
        if (this.hostBusy.has(p.sessionId)) conn.send(notify('session.busy', { sessionId: p.sessionId, busy: true }))
        for (const ask of this.asks.values()) {
          if (ask.sessionId === p.sessionId) conn.send(this.askNotice(p.sessionId, ask))
        }
        return ok(req.id, { head: await session.head() })
      }

      case 'session.read': {
        const p = params as { sessionId: string; seq: number }
        if (!this.host.markRead) return ok(req.id, { changed: false })
        const changed = await this.host.markRead(p.sessionId, p.seq)
        if (changed) this.touch(p.sessionId)
        return ok(req.id, { changed })
      }

      case 'session.submit': {
        const p = params as { sessionId: string; text: string; refs?: RefLink[] } & SubmitExtras
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
        let refs: RefLink[] = []
        try {
          session = await this.session(p.sessionId)
          // 引用要在接受之前校验：接受之后的错误只会被吞掉，用户以为引用成功了
          if (session && p.refs && p.refs.length > 0) {
            if (!session.checkRefs) throw new InvalidRefError('这个 daemon 不支持跨会话引用')
            refs = await session.checkRefs(p.refs)
          }
          if (session && hasExtras(p)) {
            if (!session.checkInputs) throw new InvalidInputError('这个 daemon 不支持附件与文件引用', 'INVALID')
            await session.checkInputs(extrasOf(p))
          }
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
          .submit(p.text, refs.length > 0 ? refs : undefined, hasExtras(p) ? extrasOf(p) : undefined)
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

      case 'session.answer': {
        const p = params as {
          askId: string
          allowed: boolean
          content?: Record<string, unknown>
          channel?: string
          grant?: boolean
        }
        const ask = this.asks.get(p.askId)
        // 已经被别的客户端答过（或根本不存在）：如实说没生效，不重复作答
        if (!ask) return ok(req.id, { ok: false })
        this.asks.delete(p.askId)
        // 审批从哪个端来（M5-007 AC-3）：客户端说了算，没说就用它握手时报的名字
        ask.answer(
          p.allowed,
          p.content,
          p.channel ?? this.clientNames.get(conn.id)?.replace(/^domi-/, ''),
          p.grant === true && ask.grantable === true,
        )
        this.broadcast(
          ask.sessionId,
          notify('session.askDone', { sessionId: ask.sessionId, askId: p.askId, allowed: p.allowed }),
        )
        return ok(req.id, { ok: true })
      }

      default:
        return fail(req.id, 'UNKNOWN_METHOD', `未实现：${method}`)
    }
  }

  private isBusy(id: string): boolean {
    return this.busy.has(id) || this.hostBusy.has(id)
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
    this.stopScheduler()
    if (this.changedTimer !== null) clearTimeout(this.changedTimer)
    this.conns.clear()
    for (const s of this.sessions.values()) await s.close()
    this.sessions.clear()
    this.subs.clear()
    this.handshaked.clear()
  }
}
