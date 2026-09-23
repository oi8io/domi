/**
 * 真正的宿主：把 runtime 的 DomiSession 接到 daemon core 上 —— PRD-M3-002 AC-1
 *
 * core 只认 `DaemonHost` 接口（测试注入假的）。这里是生产那一份：
 * 每个会话一个 DomiSession，共用同一个 SQLite 文件；会话列表由宿主自己的一条连接读。
 *
 * 权限询问经 core 推给客户端（session.ask），由任一客户端回答（session.answer）。
 * 没有客户端在线时，任务就停在询问上等——这和「断开不影响任务」不矛盾：
 * 执行一个需要确认的操作，本来就该等人，而不是替人答。
 */

import { dirname, join } from 'node:path'
import { SkillRegistry } from '@domi/capability'
import {
  ConfigParseError,
  ConfigWriteError,
  type DomiConfig,
  type LoadOptions,
  loadConfig,
  MissingCredentialError,
  pricingOf,
  readSettings,
  writeConfigPatch,
} from '@domi/config'
import { tr } from '@domi/i18n'
import { Notifier } from '@domi/notify'
import { DagSpecError } from '@domi/orchestrator'
import type { PluginHost } from '@domi/plugin'
import type { DomiEvent, EventEnvelope, Schedule } from '@domi/protocol'
import {
  AttachmentError,
  applyWorktree,
  assertResolved,
  collectDiff,
  createWorktree,
  DomiSession,
  decideIsolation,
  discardFile,
  ensureWorktree,
  type IsolationDecision,
  MAX_SPAWN_DEPTH,
  MemoryService,
  ModelCatalog,
  type ModelCatalogOptions,
  ModelResolveError,
  makeReviewReportTool,
  officialSkillsPlugin,
  ProjectError,
  ProjectService,
  REVIEW_PREFIX,
  REVIEW_REPORT_RULE,
  REVIEW_SCOPE,
  RefError,
  ReviewInputError,
  readSpecs,
  removeWorktree,
  resolveModel,
  restoreDiscard,
  reviewPrompt,
  type SessionOptions,
  SoulConflictError,
  summarizeUsage,
  TaskService,
  WorktreeError,
  type WorktreeInfo,
  worktreeDiff,
  worktreeFromEvents,
} from '@domi/runtime'
import { type ProjectRow, type ProjectSettings, type ScheduleRow, SqliteEventLog } from '@domi/store'
import { AUDIT_SESSION_ID } from './auth.ts'

const RUN_PREFIX = 'run-'

import {
  BranchPointError,
  type CreateOptions,
  type DaemonHost,
  type HostAsk,
  type HostMetrics,
  HostRequestError,
  InvalidInputError,
  InvalidRefError,
  InvalidTaskError,
  type ProjectSummary,
  type SessionHandle,
  SessionNotFoundError,
  type SessionSummary,
} from './core.ts'
import { CronError, previewCron } from './cron.ts'
import { scheduleNextRun } from './scheduler.ts'

export interface RuntimeHostOptions {
  config: DomiConfig
  /** 时钟（定时任务的测试注入） */
  now?: () => number
  dbPath: string
  /** 新建会话没给 cwd 时用这个 */
  defaultCwd: string
  /** 测试注入模型替身 */
  provider?: SessionOptions['provider']
  /** 外部工具（MCP hub），每轮现取 */
  extraTools?: SessionOptions['extraTools']
  /** 进程级提示（MCP server 连不上之类），每个会话各落一次 */
  notices?: SessionOptions['notices']
  newId?: () => string
  /** Soul 与 Skill 所在的目录。默认是 dbPath 旁边的 soul/ 与 skills/（即 ~/.domi 下） */
  soulDir?: string
  skillsDir?: string
  /** 已加载的插件（PRD-M6）：skill 进 Skill 清单，UI 面板经协议给客户端 */
  plugins?: PluginHost
  /** 模型探测用的 fetch（PRD-M9-001）。测试注入假的；不给用全局 fetch */
  probeFetch?: ModelCatalogOptions['fetch']
  /** 配置从哪读（PRD-M8-011）。给了才开放 config.get / config.set */
  configSource?: LoadOptions
  /** 测试注入：记忆抽取用的模型。不给就用 provider（再不给就按配置建） */
  memoryProvider?: SessionOptions['provider']
}

export interface RuntimeHost extends DaemonHost {
  /** daemon 启动后调：没结束的编排运行接着跑（M5-003）。返回恢复了哪些 */
  resumeTasks(): Promise<string[]>
  /** daemon 自己的审计事件（被拒的连接等）。写进 AUDIT_SESSION_ID，不出现在会话列表里 */
  audit(ev: DomiEvent): Promise<void>
  close(): void
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const normalizeCron = (cron: string): string => cron.trim().split(/\s+/).join(' ')

function cronError(e: unknown): unknown {
  return e instanceof CronError ? HostRequestError.from(e, { reason: 'INVALID_CRON', field: e.field }) : e
}

/** 校验 cron 与时区（还要确实会触发） */
function checkCron(cron: string, tz: string): void {
  try {
    previewCron(cron, tz, Date.now(), 1)
  } catch (e) {
    throw cronError(e)
  }
}

/** 会话最后活动时间与它里面事件的时间差：按 updated_at 粗筛时留的余量（一天） */
const SESSION_SLACK_MS = 24 * 60 * 60 * 1000

/** 计划转出来的运行带给宿主的信息（经 TaskService.start 的 meta 透传） */
interface RunMeta {
  projectId?: string
  isolation?: IsolationDecision
  worktree?: WorktreeInfo
}

export function createRuntimeHost(opts: RuntimeHostOptions): RuntimeHost {
  const index = new SqliteEventLog({ path: opts.dbPath, cwd: opts.defaultCwd })
  let emit: ((sessionId: string, events: EventEnvelope[]) => void) | null = null
  let busy: ((sessionId: string, b: boolean) => void) | null = null
  let asked: ((sessionId: string, ask: HostAsk) => void) | null = null
  let measured: ((sessionId: string, m: HostMetrics) => void) | null = null
  let askSeq = 0
  const newId = opts.newId ?? (() => `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const home = dirname(opts.dbPath)
  const memoryProvider = opts.memoryProvider ?? opts.provider
  const memory = new MemoryService({
    config: opts.config,
    dbPath: opts.dbPath,
    soulDir: opts.soulDir ?? join(home, 'soul'),
    ...(memoryProvider === undefined ? {} : { provider: memoryProvider }),
  })
  const skills = opts.config.skills.enabled
    ? new SkillRegistry({
        dir: opts.skillsDir ?? join(home, 'skills'),
        // 官方 Skill 以插件形态提供（PRD-M6-001 AC-3）
        official: officialSkillsPlugin.skills?.() ?? [],
        watch: true,
        ...(opts.plugins ? { extraFiles: () => opts.plugins?.skillFiles() ?? [] } : {}),
      })
    : undefined

  /** 用量的整月缓存（事件只增不改，过去的窗口不会变） */
  const usageCache = new Map<string, { value: ReturnType<typeof summarizeUsage>; cachedAt: number }>()

  /** 启动时就连上的插件 MCP server（启用启动时停着的插件，要重启才连） */
  const startedServers = new Set(opts.plugins?.mcpServers().map((s) => s.name) ?? [])

  /** 项目（M8-003）。升级前的老会话在这里一次性归类（M8-004） */
  const projects = new ProjectService({ log: index, home })
  try {
    projects.backfill()
  } catch (e) {
    process.stderr.write(`[domid] 老会话归类失败（不影响使用）：${e instanceof Error ? e.message : String(e)}\n`)
  }
  try {
    // 升级后第一次启动：已有的会话都算看过（PRD-M8-009），不然满屏未读
    index.readMarks.backfill()
  } catch (e) {
    process.stderr.write(`[domid] 已读位置初始化失败（不影响使用）：${e instanceof Error ? e.message : String(e)}\n`)
  }
  /** ProjectError → INVALID_PARAMS */
  function pj<T>(fn: () => T): T {
    try {
      return fn()
    } catch (e) {
      throw e instanceof ProjectError ? HostRequestError.from(e) : e
    }
  }
  function toSummary(p: ProjectRow | ProjectSummary | { id: string }): ProjectSummary {
    const s = projects.summary(p.id)
    return {
      id: s.id,
      name: s.name,
      path: s.path,
      createdAt: s.createdAt,
      archived: s.archivedAt !== null,
      taskCount: s.taskCount,
      lastActivity: s.lastActivity,
      settings: s.settings,
      recentTasks: s.recentTasks.map((t) => ({
        ...t,
        busy: false,
        // 空标题回退首条输入前 40 字（PRD-M10-001 AC-2）——项目展开列表与 session.list 同一口径
        title: t.title.trim() !== '' ? t.title : (t.firstInput ?? tr('daemon.sessions.untitled')),
      })),
    }
  }

  /**
   * 建一个任务会话的元数据：归到项目、记两条事件（M8-003 / 004）。cwd 不给就用项目路径
   */
  async function createTask(
    id: string,
    cwd: string | undefined,
    projectId: string | undefined,
    title = '',
    isolation?: { isolate: boolean; reason: string },
  ) {
    const { project, auto, dir } = pj(() => {
      if (projectId !== undefined) {
        const p = projects.get(projectId)
        if (p.archivedAt !== null) throw new ProjectError('error.project_archived', { name: p.name })
        return { project: p, auto: false, dir: cwd ?? p.path }
      }
      const dir = cwd ?? opts.defaultCwd
      return { ...projects.assign(dir), dir }
    })
    index.sessions.upsert({ id, cwd: dir, title, model: opts.config.model.name, kind: 'task', projectId: project.id })
    await index.append(id, [
      { t: 'session.kind', kind: 'task', cwd: dir, ...(isolation === undefined ? {} : { isolation }) },
      { t: 'project.assign', projectId: project.id, path: project.path, auto },
    ])
  }

  /** 按目标建任务（PRD-M8-005 / 006）：隔离决定 → 建会话 → 需要时先进计划模式 */
  async function createGoalTask(p: {
    projectId: string
    goal: string
    trigger?: 'user' | 'schedule'
    schedule?: { scheduleId: string; due: number; late: boolean }
  }) {
    const project = pj(() => projects.get(p.projectId))
    if (project.archivedAt !== null) throw HostRequestError.keyed('error.project_archived', { name: project.name })
    const isolation = decideIsolation({
      policy: project.settings.isolation,
      cwd: project.path,
      ...(p.trigger === undefined ? {} : { trigger: p.trigger }),
    })
    const id = newId()
    if (isolation.isolate) {
      const { info, cwd: inTree } = await wt(() => createWorktree(project.path, id, home))
      index.sessions.upsert({ id, cwd: inTree, model: opts.config.model.name, kind: 'task', projectId: project.id })
      await index.append(id, [
        { t: 'session.kind', kind: 'task', cwd: inTree, isolation },
        { t: 'project.assign', projectId: project.id, path: project.path, auto: false },
        { t: 'worktree.create', ...info },
      ])
    } else {
      await createTask(id, project.path, project.id, '', isolation)
    }
    if (p.schedule) await index.append(id, [{ t: 'schedule.fire', ...p.schedule }])
    // M12-004：取消 plan/act，任务直接执行（确认点由 permissionsMode 处理）
    return { sessionId: id, isolation }
  }

  const now = opts.now ?? Date.now

  function schedule(id: string): ScheduleRow {
    const row = index.schedules.get(id)
    if (!row) throw HostRequestError.keyed('error.schedule_not_found', { id })
    return row
  }

  function toSchedule(row: ScheduleRow): Schedule {
    const last = index.schedules.runs(row.id, 1)[0]
    return {
      id: row.id,
      projectId: row.projectId,
      goal: row.goal,
      cron: row.cron,
      tz: row.tz,
      paused: row.paused,
      createdAt: row.createdAt,
      nextRun: scheduleNextRun(row, now()),
      ...(last === undefined
        ? {}
        : {
            lastRun: {
              due: last.due,
              firedAt: last.firedAt,
              skipped: last.skipped,
              ...(last.sessionId === null ? {} : { sessionId: last.sessionId }),
            },
          }),
    }
  }

  /**
   * 计划转成的 DAG 运行（PRD-M8-006 AC-1）：跟着来源任务的项目走；来源任务没在单独的工作区里、
   * 项目策略允许时，给运行建一个（多节点并行改，不直接动用户的工作区）
   */
  async function runMeta(fromSession: string, cwd: string): Promise<RunMeta & { cwd: string }> {
    const row = index.sessions.get(fromSession)
    if (!row?.projectId) return { cwd }
    const projectId = row.projectId
    const project = pj(() => projects.get(projectId))
    if (await worktreeOf(fromSession)) return { cwd, projectId }
    const isolation = decideIsolation({ policy: project.settings.isolation, cwd, shape: 'dag' })
    if (!isolation.isolate) return { cwd, projectId, isolation }
    const key = `dag-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const { info, cwd: inTree } = await wt(() => createWorktree(cwd, key, home))
    return { cwd: inTree, projectId, isolation, worktree: info }
  }

  const notifier = new Notifier(opts.config.notify, { log: (l) => process.stderr.write(`${l}\n`) })
  /** 同一个会话只有一个 DomiSession：core、编排、子 agent 共用，推送才不会重复 */
  const sessions = new Map<string, Promise<DomiSession>>()
  // 模型清单与探测缓存（PRD-M9-001）：整个 domid 一份，配置变了靠指纹自己失效
  // 注入了模型替身（测试）时不向任何地址探测：替身背后没有真实端点，探测只会是一次多余的出站（INV-08）
  const probeFetch =
    opts.probeFetch ??
    (opts.provider !== undefined
      ? async () => {
          throw new Error('注入了模型替身，不探测')
        }
      : undefined)
  const catalog = new ModelCatalog(probeFetch === undefined ? {} : { fetch: probeFetch })
  const pushChild = (id: string, envs: EventEnvelope[]): void => emit?.(id, envs)

  /** 这个会话的隔离工作区（从事件流里找；不是隔离会话 → null） */
  async function worktreeOf(sessionId: string): Promise<WorktreeInfo | null> {
    if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
    return worktreeFromEvents(await index.read(sessionId))
  }

  /** WorktreeError → INVALID_PARAMS */
  async function wt<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw e instanceof WorktreeError ? HostRequestError.from(e) : e
    }
  }

  function live(
    sessionId: string,
    init?: { cwd: string; title: string; spawnedBy?: string; meta?: unknown },
    extra: Partial<SessionOptions> = {},
  ): Promise<DomiSession> {
    const cached = sessions.get(sessionId)
    if (cached) return cached
    const made = (async () => {
      if (init && !index.sessions.get(sessionId)) {
        if (init.spawnedBy === undefined) {
          // 长任务的运行会话（M5）、审阅会话（M7-010）：是任务。计划转出来的运行带着来源任务的项目与隔离决定，
          // 其余的归到 cwd 的项目
          const m = init.meta as RunMeta | undefined
          await createTask(sessionId, init.cwd, m?.projectId, init.title, m?.isolation)
          if (m?.worktree) await index.append(sessionId, [{ t: 'worktree.create', ...m.worktree }])
        } else {
          const parent = init.spawnedBy === undefined ? null : index.sessions.get(init.spawnedBy)
          index.sessions.upsert({
            id: sessionId,
            cwd: init.cwd,
            title: init.title,
            model: opts.config.model.name,
            ...(init.spawnedBy === undefined ? {} : { spawnedBy: init.spawnedBy }),
            ...(parent?.kind ? { kind: parent.kind, projectId: parent.projectId } : { kind: 'task' as const }),
          })
        }
      }
      const row = index.sessions.get(sessionId)
      if (!row) throw new SessionNotFoundError(sessionId)
      // 自由会话（M8-004）：不带项目上下文，命令每次都问
      const chat: Partial<SessionOptions> =
        row.kind === 'chat' ? { projectContext: false, askAlways: ['shell.exec'] } : {}
      // 任务：计划审阅策略取所在项目的设置，每次现读（设置页改了就生效）
      const projectId = row.projectId
      const planReview: Partial<SessionOptions> =
        projectId === null
          ? {}
          : {
              planReview: () => {
                try {
                  return projects.get(projectId).settings.planReview
                } catch {
                  return 'always'
                }
              },
            }
      // 隔离会话被删过又恢复时 worktree 目录已经清掉了：按分支重新挂上（M7-006）
      const tree = await worktreeOf(sessionId)
      if (tree) await wt(() => ensureWorktree(tree))
      const s = new DomiSession({
        config: opts.config,
        sessionId,
        cwd: row.cwd,
        dbPath: opts.dbPath,
        ...(opts.provider === undefined ? {} : { provider: opts.provider }),
        ...(opts.extraTools === undefined ? {} : { extraTools: opts.extraTools }),
        ...(opts.notices === undefined ? {} : { notices: opts.notices }),
        memory,
        ...(skills === undefined ? {} : { skills }),
        childEvents: pushChild,
        // 花费与预算的金额上限（M7-009）
        pricing: pricingOf(opts.config),
        ...chat,
        ...planReview,
        ...extra,
        // 计划批准后转长任务（M7-005）：同一个 TaskService
        startTask: async (spec, cwd) => {
          const meta = await runMeta(sessionId, cwd)
          try {
            return (await tasks.start(JSON.stringify(spec), meta.cwd, meta)).runId
          } catch (e) {
            if (meta.worktree) removeWorktree(meta.worktree)
            throw e
          }
        },
      })
      // 上一个 domid 可能是被 kill -9 的：先把这个会话补到一致点，再交出去（TASK-M3-010）。
      // 这时还没有订阅者，补的事件由之后的订阅补发带过去
      await s.recover()
      s.on('onEvents', (envs) => emit?.(sessionId, envs))
      s.on('onBusy', (b) => busy?.(sessionId, b))
      s.on('onMetrics', (m) => measured?.(sessionId, { ...s.modelInfo(), ...m }))
      s.on('onAsk', (ask) => {
        // null = 这次询问已经答完，core 那边在 answer 时已经清掉了
        if (!ask) return
        askSeq++
        const detail = ask.form ? ask.form.message : (JSON.stringify(ask.args, null, 2) ?? String(ask.args))
        asked?.(sessionId, {
          askId: `${sessionId}#${askSeq}`,
          capabilityId: ask.capabilityId,
          // 完整内容，不截断（PRD-M0-003 AC-1）：确认框是用户做决定的地方
          detail,
          ...(ask.form === undefined ? {} : { form: ask.form }),
          ...(ask.grantable === true ? { grantable: true } : {}),
          answer: (allowed, content, channel, grant) => ask.answer(allowed, content, channel, grant),
        })
        // 长任务在等人（M5-004 AC-1）。通知里只说「在等什么能力」，不带参数内容
        if (sessionId.startsWith(RUN_PREFIX) && notifier.enabled) {
          void notifier.send({
            kind: 'approval',
            title: '任务在等你确认',
            detail: `${ask.capabilityId} 需要确认`,
            runId: sessionId,
          })
        }
      })
      return s
    })()
    sessions.set(sessionId, made)
    made.catch(() => sessions.delete(sessionId))
    return made
  }

  const tasks = new TaskService({
    dbPath: opts.dbPath,
    defaultCwd: opts.defaultCwd,
    openSession: (id, init) => live(id, init),
    onEvent: (runId, evs, st) => {
      const end = evs.find((e) => e.t === 'task.end') as { status?: string } | undefined
      if (!end || end.status === 'cancelled' || !notifier.enabled) return
      const failed = Object.values(st.nodes)
        .filter((n) => n.status === 'failed')
        .map((n) => n.id)
      void notifier.send({
        kind: end.status === 'done' ? 'done' : 'failed',
        // 系统通知按 domid 的语言（ui.locale，PRD-M9-004）
        title: tr(end.status === 'done' ? 'daemon.notify.done' : 'daemon.notify.failed', { name: st.name }),
        detail:
          end.status === 'done'
            ? tr('daemon.notify.allDone', { count: Object.keys(st.nodes).length })
            : tr('daemon.notify.failedNodes', { nodes: failed.join(', ') }),
        runId,
      })
    },
  })

  return {
    async open(sessionId: string): Promise<SessionHandle> {
      const s = await live(sessionId)
      let head = 0

      let hostWindowMeta: { oldestSeq: number; hasOlder: boolean } | undefined
      return {
        id: sessionId,
        submit: (text, refs, inputs) => s.submit(text, { ...(refs === undefined ? {} : { refs }), ...(inputs ?? {}) }),
        async checkReady() {
          try {
            s.checkCredential()
          } catch (e) {
            if (!(e instanceof MissingCredentialError)) throw e
            const provider = e.provider ?? opts.config.model.provider
            throw InvalidInputError.keyed(
              'MISSING_CREDENTIAL',
              'error.missing_credential',
              { provider, envNames: e.envNames.join(' / ') },
              { provider, envNames: e.envNames },
            )
          }
        },
        async checkInputs(inputs) {
          try {
            s.checkInputs(inputs)
          } catch (e) {
            throw e instanceof AttachmentError ? InvalidInputError.from(e, e.reason) : e
          }
        },
        async checkRefs(refs) {
          try {
            return await s.checkRefs(refs)
          } catch (e) {
            throw e instanceof RefError ? new InvalidRefError(e.message, { cause: e }) : e
          }
        },
        async switchModel(model, provider) {
          // 端上只给模型名时由这里归属（PRD-M9-003 AC-3）；给了 provider 也要是启用着的那一家
          const list = await catalog.list(opts.config)
          let target: { provider: string; name: string }
          try {
            if (provider === undefined)
              target = assertResolved(resolveModel(list.models, model, opts.config.model.provider))
            else if (list.providers.some((p) => p.id === provider)) target = { provider, name: model }
            else throw new ModelResolveError('error.model.providerUnavailable', { provider }, 'PROVIDER_UNAVAILABLE')
          } catch (e) {
            if (e instanceof ModelResolveError) throw InvalidInputError.from(e, e.reason, e.detail)
            throw e
          }
          return s.switchModel(target.name, { provider: target.provider })
        },
        setPermissionsMode: (mode) => s.setPermissionsMode(mode as 'always-ask' | 'on-demand' | 'allow-all'),
        setBudget: (b) => s.setBudget(b),
        compactNow: (trigger) => s.compactNow(trigger),
        async readEvents(fromSeq, opts?: { maxLines?: number | undefined }) {
          // PRD-M11-009：fromSeq=0（首连）只回尾部窗口（按轮 + 屏预算），不全量拉回。
          // fromSeq>0（断点续订）仍是增量：seq > fromSeq 的全部事件。
          if (fromSeq === 0) {
            const page = await s.tailWindow(opts?.maxLines ?? 120)
            head = page.toSeq
            hostWindowMeta = { oldestSeq: page.fromSeq, hasOlder: page.hasOlder }
            await s.emitMetricsNow()
            return page.events
          }
          const all = await s.pumpAll()
          head = all[all.length - 1]?.seq ?? head
          await s.emitMetricsNow()
          return all.filter((e) => e.seq > fromSeq)
        },
        async history(beforeSeq, maxLines = 80) {
          return s.history(beforeSeq, maxLines)
        },
        get windowMeta() {
          return hostWindowMeta
        },
        async head() {
          const all = await s.pumpAll()
          head = all[all.length - 1]?.seq ?? 0
          return head
        },
        async close() {
          sessions.delete(sessionId)
          await s.flushAndClose()
        },
      }
    },

    async create(cwd?: string, o: CreateOptions = {}): Promise<string> {
      const id = newId()
      const looksLikeProject = (): boolean => {
        if (cwd === undefined) return false
        const r = pj(() => projects.resolve(cwd))
        return r.project !== null || r.projectLike
      }
      const kind = o.kind ?? (o.projectId !== undefined || looksLikeProject() ? 'task' : 'chat')
      if (kind === 'task') {
        await createTask(id, cwd, o.projectId)
        return id
      }
      // 自由会话：工作目录是自己的沙盒，给了 cwd 也不用（M8-004 AC-2）
      const dir = projects.scratchDir(id)
      index.sessions.upsert({ id, cwd: dir, model: opts.config.model.name, kind: 'chat', projectId: null })
      await index.append(id, [{ t: 'session.kind', kind: 'chat', cwd: dir }])
      return id
    },

    async list({ includeDeleted, kind, projectId }): Promise<SessionSummary[]> {
      // 下划线开头的是 daemon 自己的会话（审计），不是用户的对话
      const rows = index.sessions
        .list({
          includeDeleted,
          limit: 500,
          ...(kind === undefined ? {} : { kind }),
          ...(projectId === undefined ? {} : { projectId }),
        })
        .filter((r) => !r.id.startsWith('_'))
      const read = index.readMarks.states(rows.map((r) => r.id))
      return rows.map((r) => ({
        id: r.id,
        // 空标题回退首条输入前 40 字（PRD-M10-001 AC-2，SPEC-M10 取舍-2）——别再让侧栏显示会话 id
        title: r.title.trim() !== '' ? r.title : (r.firstInput ?? tr('daemon.sessions.untitled')),
        model: r.model,
        updatedAt: r.updatedAt,
        eventCount: r.eventCount,
        deleted: r.deletedAt !== null,
        cwd: r.cwd,
        ...(r.parentSessionId === null ? {} : { parentId: r.parentSessionId }),
        ...(r.kind === null ? {} : { kind: r.kind }),
        ...(r.projectId === null ? {} : { projectId: r.projectId }),
        ...(read.get(r.id)?.unread ? { unread: true } : {}),
      }))
    },

    /**
     * 用量（PRD-M8-013）：按 updated_at 粗筛会话，再按事件 ts 精筛。
     * 已经过去的整月结果缓存起来（事件只增不改，过去的月份不会再变）
     */
    async usage(from, to) {
      const key = `${from}:${to}`
      const cached = usageCache.get(key)
      if (cached) return cached.value
      const rows = index.sessions
        .list({ includeDeleted: true, includeSpawned: true, limit: 5000 })
        .filter((r) => !r.id.startsWith('_') && r.updatedAt >= from - SESSION_SLACK_MS)
      const sessions = []
      for (const r of rows) sessions.push({ id: r.id, events: await index.read(r.id) })
      const value = summarizeUsage(sessions, { from, to, pricing: pricingOf(opts.config) })
      const now = (opts.now ?? Date.now)()
      // 只缓存「窗口已经过去」的查询；当月每次现算
      if (to <= now) usageCache.set(key, { value, cachedAt: now })
      return value
    },

    async markRead(sessionId, seq) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      const own = seq - index.viewOffset(sessionId)
      return own > 0 && index.readMarks.mark(sessionId, own)
    },

    createTask: (p) => createGoalTask(p),

    composer: {
      async files(sessionId, query, limit) {
        return (await live(sessionId)).listFiles(query, limit)
      },
      async attach(sessionId, file) {
        const s = await live(sessionId)
        try {
          return s.attachments.put(sessionId, file)
        } catch (e) {
          throw e instanceof AttachmentError ? InvalidInputError.from(e, e.reason) : e
        }
      },
      async skills(sessionId) {
        if (sessionId !== undefined) return (await live(sessionId)).listSkills()
        return (skills?.list() ?? []).map((k) => ({ name: k.name, description: k.description, source: k.source }))
      },
      async models(refresh) {
        return catalog.list(opts.config, { refresh: refresh === true })
      },
    },

    schedules: {
      store: index.schedules,
      async list() {
        return index.schedules.list().map(toSchedule)
      },
      async create(p) {
        const project = pj(() => projects.get(p.projectId))
        if (project.archivedAt !== null) throw HostRequestError.keyed('error.project_archived', { name: project.name })
        const tz = p.tz ?? localTimeZone()
        checkCron(p.cron, tz)
        const at = now()
        const row = index.schedules.insert({
          id: `sch-${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          projectId: project.id,
          goal: p.goal.trim(),
          cron: normalizeCron(p.cron),
          tz,
          createdAt: at,
        })
        index.schedules.setLastDue(row.id, at)
        return toSchedule(schedule(row.id))
      },
      async update(p) {
        const cur = schedule(p.id)
        const cron = p.cron === undefined ? cur.cron : normalizeCron(p.cron)
        const tz = p.tz ?? cur.tz
        if (p.cron !== undefined || p.tz !== undefined) checkCron(cron, tz)
        index.schedules.update(p.id, {
          ...(p.goal === undefined ? {} : { goal: p.goal.trim() }),
          cron,
          tz,
          ...(p.paused === undefined ? {} : { paused: p.paused }),
        })
        // 改了时间表、或者从暂停恢复：从此刻重新算，不补之前错过的
        const resumed = cur.paused && p.paused === false
        if (resumed || cron !== cur.cron || tz !== cur.tz) index.schedules.setLastDue(p.id, now())
        return toSchedule(schedule(p.id))
      },
      async remove(id) {
        schedule(id)
        index.schedules.delete(id, now())
      },
      async runs(id, limit) {
        schedule(id)
        return index.schedules.runs(id, limit)
      },
      async preview(cron, tz, count) {
        const zone = tz ?? localTimeZone()
        try {
          return { nextRuns: previewCron(cron, zone, now(), count), tz: zone }
        } catch (e) {
          throw cronError(e)
        }
      },
    },

    async rename(sessionId, title) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      index.sessions.setTitle(sessionId, title)
    },

    ...(opts.configSource === undefined
      ? {}
      : {
          config: {
            async get() {
              try {
                const v = readSettings(opts.configSource)
                return { ...v, writable: [...v.writable] }
              } catch (e) {
                throw e instanceof ConfigParseError ? new HostRequestError(e.message) : e
              }
            },
            async set(patch) {
              const src = opts.configSource as LoadOptions
              try {
                writeConfigPatch(patch, src)
              } catch (e) {
                if (e instanceof ConfigWriteError)
                  throw HostRequestError.from(e, e.reason === undefined ? undefined : { reason: e.reason })
                throw e instanceof ConfigParseError ? new HostRequestError(e.message) : e
              }
              // 热加载（AC-3）：之后新建的会话用新配置；已经开着的会话下一轮用新配置
              const next = loadConfig(src)
              ;(opts as { config: DomiConfig }).config = next
              for (const s of sessions.values()) void s.then((x) => x.reconfigure(next)).catch(() => undefined)
              // 插件启停即时生效；只有「启用一个启动时停着、带 MCP server 的插件」要重启才连得上
              let pluginRestart = false
              if ('plugins.disabled' in patch && opts.plugins) {
                const before = new Set(opts.plugins.disabledServers())
                opts.plugins.setDisabled(next.plugins.disabled)
                skills?.reload()
                pluginRestart = [...before].some(
                  (s) => !opts.plugins?.disabledServers().includes(s) && !startedServers.has(s),
                )
              }
              const restartRequired = Object.keys(patch).filter(
                (k) =>
                  k.startsWith('memory.') || (k.startsWith('plugins.') && (k !== 'plugins.disabled' || pluginRestart)),
              )
              return { ok: true as const, restartRequired }
            },
          },
        }),

    projects: {
      async list({ includeArchived, recent }) {
        return projects.list({ includeArchived, recent }).map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          createdAt: p.createdAt,
          archived: p.archivedAt !== null,
          taskCount: p.taskCount,
          lastActivity: p.lastActivity,
          settings: p.settings,
          recentTasks: p.recentTasks.map((t) => ({
            ...t,
            busy: false,
            // 空标题回退首条输入前 40 字（PRD-M10-001 AC-2）——项目展开列表与 session.list 同一口径
            title: t.title.trim() !== '' ? t.title : (t.firstInput ?? tr('daemon.sessions.untitled')),
          })),
        }))
      },
      async create(path, name) {
        return toSummary(pj(() => projects.create(path, name)).project)
      },
      async update(id, patch) {
        return toSummary(
          pj(() =>
            projects.update(id, {
              ...(patch.name === undefined ? {} : { name: patch.name }),
              ...(patch.settings === undefined
                ? {}
                : {
                    settings: Object.fromEntries(
                      Object.entries(patch.settings).filter(([, v]) => v !== undefined),
                    ) as Partial<ProjectSettings>,
                  }),
            }),
          ),
        )
      },
      async archive(id, archived) {
        pj(() => projects.archive(id, archived))
      },
      async resolve(cwd) {
        const r = pj(() => projects.resolve(cwd))
        return {
          ...(r.project === null ? {} : { project: toSummary(r.project) }),
          projectLike: r.projectLike,
          root: r.root,
        }
      },
    },

    /**
     * atSeq 是客户端看到的**视图** seq。它可能落在祖先那一段里——那就从祖先分：
     * 「从这条消息分支」的意思是「回到这条消息之后」，和它当初属于哪一段无关
     */
    async branch(sessionId, atSeq) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      const at = index.resolveViewSeq(sessionId, atSeq)
      if (!at) {
        const head = index.viewOffset(sessionId) + (await index.head(sessionId))
        throw new BranchPointError(sessionId, atSeq, head)
      }
      const id = newId()
      await index.fork(at.sessionId, at.seq, id)
      return id
    },

    async remove(sessionId) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      // 隔离会话：worktree 里有没提交的改动就不删（PRD-M7-006 AC-4）；删目录不删分支
      const tree = await worktreeOf(sessionId)
      if (tree) await wt(() => removeWorktree(tree))
      index.sessions.softDelete(sessionId, Date.now())
    },

    async review(p) {
      const from = p.fromSessionId === undefined ? undefined : index.sessions.get(p.fromSessionId)
      if (p.fromSessionId !== undefined && !from) throw new SessionNotFoundError(p.fromSessionId)
      const cwd = p.cwd ?? from?.cwd ?? opts.defaultCwd
      const base = p.base ?? 'HEAD'
      let prompt: string
      try {
        prompt = reviewPrompt(collectDiff(cwd, base), readSpecs(cwd, p.specs ?? []), base)
      } catch (e) {
        throw e instanceof ReviewInputError ? HostRequestError.from(e) : e
      }
      const id = `${REVIEW_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const report = makeReviewReportTool()
      const s = await live(
        id,
        {
          cwd,
          title: `审阅：${(p.specs ?? []).join('、') || base}`,
          ...(p.fromSessionId === undefined ? {} : { spawnedBy: p.fromSessionId }),
        },
        {
          // 只读 + 提交发现；**不带**发起会话的任何事件（AC-1）
          scope: (c: string) => REVIEW_SCOPE.some((x) => x === c || (x.endsWith('.*') && c.startsWith(x.slice(0, -1)))),
          extraRules: [REVIEW_REPORT_RULE],
          extraTools: () => [report],
          spawnDepth: MAX_SPAWN_DEPTH,
        },
      )
      // 挂到发起会话的轨迹下（和 task.spawn 同一个形状）
      if (p.fromSessionId !== undefined) {
        const parent = sessions.get(p.fromSessionId)
        if (parent) {
          const ps = await parent
          await ps.appendEvents([{ t: 'task.spawn', childSessionId: id, goal: '审阅改动' }]).catch(() => undefined)
        }
      }
      void s.submit(prompt).catch(async (e) => {
        await s
          .appendEvents([
            { t: 'error', scope: 'review', message: e instanceof Error ? e.message : String(e), recoverable: false },
          ])
          .catch(() => undefined)
      })
      return id
    },

    worktrees: {
      async create(cwd) {
        const id = newId()
        const { info, cwd: inTree } = await wt(() => createWorktree(cwd ?? opts.defaultCwd, id, home))
        // 隔离会话也是任务（M8-004）：项目按原仓库算，工作目录是 worktree
        const { project, auto } = pj(() => projects.assign(cwd ?? opts.defaultCwd))
        index.sessions.upsert({ id, cwd: inTree, model: opts.config.model.name, kind: 'task', projectId: project.id })
        await index.append(id, [
          { t: 'session.kind', kind: 'task', cwd: inTree, isolation: { isolate: true, reason: 'requested' } },
          { t: 'project.assign', projectId: project.id, path: project.path, auto },
          { t: 'worktree.create', ...info },
        ])
        return { sessionId: id, worktree: { path: info.path, branch: info.branch } }
      },
      async diff(sessionId) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw HostRequestError.keyed('error.not_isolated', { sessionId })
        const files = await wt(() => worktreeDiff(tree))
        return { repo: tree.repo, branch: tree.branch, base: tree.base, files }
      },
      async discard(sessionId, path) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw HostRequestError.keyed('error.not_isolated', { sessionId })
        const trash = await wt(() => discardFile(tree, path, home))
        await (await live(sessionId)).appendEvents([{ t: 'worktree.discard', path, trash }])
        return trash
      },
      async restore(sessionId, trash) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw HostRequestError.keyed('error.not_isolated', { sessionId })
        const path = await wt(() => restoreDiscard(tree, trash, home))
        await (await live(sessionId)).appendEvents([{ t: 'worktree.restore', path, trash }])
        return path
      },
      async apply(sessionId, mode, message) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw HostRequestError.keyed('error.not_isolated', { sessionId })
        const s = await live(sessionId)
        const title = index.sessions.get(sessionId)?.title ?? ''
        const msg = message ?? (title === '' ? `domi 会话 ${sessionId} 的改动` : title)
        const target =
          mode === 'branch'
            ? `只留在分支 ${tree.branch}`
            : `${mode === 'squash' ? '压成一个提交' : '合并'}到 ${tree.repo} 当前分支`
        // 人工批准（AC-3）：没批准，原仓库一个字节不动
        const { allowed } = await s.askApproval(
          `把隔离工作区的改动${target}？`,
          { message: msg, repo: tree.repo, mode },
          'worktree.apply',
        )
        if (!allowed) {
          const r = { ok: false, message: '没有批准，原仓库没有改动' }
          await s.appendEvents([{ t: 'worktree.apply', mode, ...r }])
          return r
        }
        const r = await wt(() => applyWorktree(tree, mode, msg))
        await s.appendEvents([{ t: 'worktree.apply', mode, ...r }])
        return r
      },
    },

    async restore(sessionId) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      index.sessions.restore(sessionId)
    },

    tasks: {
      async start(spec, cwd) {
        try {
          const r = await tasks.start(spec, cwd)
          return { runId: r.runId, name: r.spec.name, nodes: r.spec.nodes.map((n) => n.id) }
        } catch (e) {
          throw e instanceof DagSpecError ? new InvalidTaskError(e.message) : e
        }
      },
      list: () => tasks.list(),
      async get(runId) {
        const st = await tasks.state(runId)
        if (!st) throw new SessionNotFoundError(runId)
        return {
          runId,
          name: st.name,
          status: st.status,
          active: tasks.isRunning(runId),
          nodes: (st.spec?.nodes ?? []).map((n) => {
            const ns = st.nodes[n.id]
            return {
              id: n.id,
              type: n.type,
              ...(n.title === undefined ? {} : { title: n.title }),
              needs: n.needs,
              status: ns?.status ?? 'pending',
              attempt: ns?.attempt ?? 0,
              ...(ns?.output === undefined ? {} : { output: ns.output }),
              ...(ns?.error === undefined ? {} : { error: ns.error }),
              ...(ns?.sessionId === undefined ? {} : { sessionId: ns.sessionId }),
              ...(ns?.ms === undefined ? {} : { ms: ns.ms }),
            }
          }),
        }
      },
      async retry(runId, nodeId) {
        try {
          await tasks.retry(runId, nodeId)
        } catch (e) {
          throw e instanceof DagSpecError ? new InvalidTaskError(e.message) : e
        }
      },
      cancel: (runId) => tasks.cancel(runId),
    },

    async auditRecord(kind, detail, client) {
      await index.append(AUDIT_SESSION_ID, [
        { t: 'error', scope: `audit.${kind}`, message: `[${client}] ${detail}`, recoverable: true },
      ])
    },

    resumeTasks: () => tasks.resumeAll(),

    ...(opts.plugins === undefined
      ? {}
      : {
          plugins: {
            async list() {
              const ph = opts.plugins as PluginHost
              return {
                sandbox: ph.backend,
                plugins: ph.plugins.map((p) => ({
                  name: p.manifest.name,
                  version: p.manifest.version,
                  description: p.manifest.description,
                  tools: p.manifest.contributes.tools.map((t) => `plugin.${p.manifest.name}.${t.name}`),
                  skills: p.manifest.contributes.skills.length,
                  mcp: p.manifest.contributes.mcp.map((s) => s.name),
                  ui: p.manifest.contributes.ui.map((u) => ({ id: u.id, title: u.title })),
                  enabled: ph.isEnabled(p.manifest.name),
                })),
                problems: [...ph.problems()],
              }
            },
            async ui(plugin: string, id: string) {
              return (opts.plugins as PluginHost).uiHtml(plugin, id)
            },
          },
        }),

    memory: {
      async list(includeDeleted) {
        return memory.list({ includeDeleted }).map((i) => ({
          id: i.id,
          kind: i.kind,
          text: i.text,
          sourceRefs: i.sourceRefs,
          createdAt: i.createdAt,
          deleted: i.deletedAt !== null,
        }))
      },
      async search(query, limit) {
        const r = await memory.search(query, limit)
        return {
          mode: r.mode,
          items: r.items.map((i) => ({
            id: i.id,
            kind: i.kind,
            text: i.text,
            sourceRefs: i.sourceRefs,
            createdAt: i.createdAt,
            deleted: false,
            score: i.score,
          })),
        }
      },
      remove: (id) => memory.remove(id),
      async extract(sessionId) {
        if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
        const r = await memory.extract(sessionId)
        return { added: r.added, soulChanges: r.soul }
      },
      async soul() {
        const { readFileSync, existsSync, statSync } = await import('node:fs')
        if (!existsSync(memory.soulPath)) return { path: memory.soulPath, text: '' }
        return {
          path: memory.soulPath,
          text: readFileSync(memory.soulPath, 'utf8'),
          mtime: statSync(memory.soulPath).mtimeMs,
        }
      },
      async writeSoul(text, mtime) {
        try {
          return { ok: true as const, mtime: await memory.writeText(text, mtime) }
        } catch (e) {
          throw e instanceof SoulConflictError ? HostRequestError.from(e, { reason: 'CONFLICT' }) : e
        }
      },
      async exportSoul() {
        const r = memory.exportText()
        // 同一行被几条规则同时命中时只报一次
        const seen = new Set<string>()
        const findings = r.findings.filter((f) => {
          const k = `${f.line}:${f.kind}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        return { text: r.text, findings: findings.map((f) => ({ line: f.line, kind: f.kind, text: f.text })) }
      },
      async importSoul(p) {
        const plans = memory.planImport(p.text, p.name)
        const view = plans.map((x) => ({ section: x.section as string, add: x.add }))
        if (p.sections === undefined) return { plans: view, imported: 0 }
        const wanted = new Set(p.sections)
        const changes = await memory.applyImport(plans.filter((x) => wanted.has(x.section)))
        return { plans: view, imported: changes.length }
      },
      changes: () => memory.pendingChanges(),
      review: (id, decision) => memory.review(id, decision),
      update: () => memory.updateSoul(),
    },

    async audit(ev) {
      await index.append(AUDIT_SESSION_ID, [ev])
    },

    onEvents(cb) {
      emit = cb
    },
    onBusy(cb) {
      busy = cb
    },
    onAsk(cb) {
      asked = cb
    },
    onMetrics(cb) {
      measured = cb
    },
    close() {
      tasks.close()
      skills?.close()
      memory.close()
      index.close()
    },
  }
}
