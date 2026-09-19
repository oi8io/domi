/**
 * DomiSession —— M0 的进程内接线层。
 *
 * **为什么要有这一层**：M0「不拆 daemon」（PRD §M0 不做什么），但 INV-02 要求
 * 三端零业务逻辑。如果让 `apps/tui` 自己去 new SqliteEventLog、装配 loop，
 * 那 TUI 里就有了业务逻辑，M3 拆 daemon 时要把它们一个个抠出来。
 *
 * 所以装配集中在这里，`apps/tui` 只看得到 DomiSession 这个门面。
 * M3 的做法是：daemon 里跑 DomiSession，客户端换成 Domi Protocol 的代理实现，
 * **TUI 一行不用改**——门面的方法签名就是按将来的协议形状设计的。
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  fsEdit,
  fsGlob,
  fsGrep,
  fsRead,
  fsWrite,
  JobTable,
  listFiles,
  makeShellKillTool,
  makeShellOutputTool,
  makeSkillLoadTool,
  PermissionEngine,
  SkillOverlay,
  type SkillRegistry,
  scopeOf,
  shellExec,
  type Tool,
  ToolRegistry,
} from '@domi/capability'
import { DiagnosticsService, makeDiagnosticsTool, makeOutlineTool } from '@domi/codeintel'
import {
  credentialEnvNames,
  type DomiConfig,
  listProviders,
  MissingCredentialError,
  providerConnection,
} from '@domi/config'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import {
  aggregate,
  type ContextPolicy,
  contextLevel,
  formatCost,
  type PricingTable,
  recoveryEvents,
  runTurn,
  type TurnResult,
  type VerifyState,
  verifyNudges,
  verifyState,
} from '@domi/kernel'
import { compact, registerCleanStrategy, registerCompactStrategy, SummarySchema, shouldCompact } from '@domi/memory'
import {
  capabilitiesFor,
  createProvider,
  generateStructured,
  lostCapabilities,
  type ModelProvider,
  providerConfigOf,
  StructuredOutputError,
} from '@domi/model'
import { assemble, BUILTIN_LAYERS, layersFromConfig, mergeLayers, type PromptLayer } from '@domi/prompt'
import type { DomiEvent, EventEnvelope, RefLink, UploadRef } from '@domi/protocol'
import { z } from 'zod'
import { AttachmentError, AttachmentStore, DEFAULT_ATTACHMENT_MAX_BYTES, isImage } from './attachments.ts'

/**
 * 在**组合根**注册确定性清理策略（PRD-M2-002）。
 * kernel 只提供注册点，永远不知道有这回事——这就是 PRD-M2-003 AC-6
 * 「切换压缩策略实现，packages/kernel diff 为 0」的兑现处。
 * 注册是幂等的，放在模块顶层是为了「配置里写了 strategy = "clean" 就直接能用」。
 */
registerCleanStrategy()
registerCompactStrategy()

const TitleSchema = z.object({ title: z.string() })

import { SqliteEventLog } from '@domi/store'
import { BUDGET_DECISION_SCHEMA, type BudgetLimits, makeBudgetGate } from './budget.ts'
import { memorySearchPlugin } from './builtin-plugins.ts'
import { HookRunner } from './hooks.ts'
import { type MemoryService, makeMemoryRecallTool } from './memory-service.ts'
import { makePlanSubmitTool } from './plan.ts'
import {
  findRepoRoot,
  hasProjectContent,
  projectRulesLayer,
  projectSkillsDir,
  rulesFiles,
  rulesText,
  TrustStore,
} from './project.ts'
import { MAX_SPAWN_DEPTH, makeSpawnTool } from './subagent.ts'

/** 这一轮（最后一条 user.input 之后）有没有改过文件 */
function changedThisTurn(events: readonly EventEnvelope[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = (events[i] as EventEnvelope).ev as { t: string; phase?: string }
    if (ev.t === 'user.input') return false
    if (ev.t === 'fs.snapshot' && ev.phase === 'after') return true
  }
  return false
}

/**
 * 一次询问。TUI / daemon 渲染它，用户回答后 resolve。
 * 两种：权限确认（只要是/否），与工具要输入（form 不为空，回答可带内容）
 */
/** 引用指向的会话不存在、或区间不成立（PRD-M3-005）。daemon 把它翻译成 INVALID_PARAMS */
export class RefError extends KeyedError {
  constructor(key: MessageKey, params?: Params) {
    super(key, params)
    this.name = 'RefError'
  }
}

/** 新建任务时系统开计划模式用的 reason（M8-005）。审阅策略只对这种规划生效 */
export const AUTO_PLAN_REASON = '新任务先规划'

export interface PendingAsk {
  capabilityId: string
  args: unknown
  form?: { message: string; schema: unknown }
  /** 可以答「本会话始终允许」（M8-016） */
  grantable?: boolean
  /**
   * channel：用户在哪个端上回答的（tui / web / telegram），进 permission 事件（M5-007）。
   * grant：本会话始终允许（M8-016），只在 grantable 时有意义
   */
  answer(allowed: boolean, content?: Record<string, unknown>, channel?: string, grant?: boolean): void
}

export interface MetricsSnapshot {
  tokens: { input: number; output: number; cacheRead: number }
  cost: string
  turnMs: number
  contextPercent: number
  contextLevel: 'ok' | 'warn' | 'danger'
  unpricedModels: string[]
  /** 本轮验证状态（M7-004） */
  verify: VerifyState
  mode: 'plan' | 'act'
  turns?: number
  steps?: number
  tokPerSec?: number | null
  cacheHitPercent?: number | null
}

export interface SessionEvents {
  onEvents(envelopes: EventEnvelope[]): void
  /** 指标由 runtime 算好推过来 —— 三端共用 kernel 的同一份 aggregate（PRD-M1-007 AC-3） */
  onMetrics(metrics: MetricsSnapshot): void
  onAsk(ask: PendingAsk | null): void
  onBusy(busy: boolean): void
}

export interface SessionOptions {
  config: DomiConfig
  sessionId: string
  cwd: string
  dbPath: string
  /** 注入替身用；不给就按配置建 AiSdkProvider */
  provider?: ModelProvider
  clock?: { now(): number }
  /** 价目表。未在表里的模型花费显示 `—` 且不参与累计（AC-4） */
  pricing?: PricingTable
  /**
   * 外部工具（MCP，ADR-015）。**每轮现取**：会话建好之后才连上的 server 也能用上。
   * 它们和内置工具走同一个 ToolRegistry、同一条权限路径（INV-03）
   */
  extraTools?: (cwd: string) => readonly Tool[]
  /** 进程级的提示（比如某个 MCP server 连不上）。每条只在本会话落一次 error 事件 */
  notices?: () => readonly string[]
  /** 记忆与 Soul（PRD-M4）。daemon 里所有会话共用一个；不给就没有抽取、Soul 不进提示词 */
  memory?: MemoryService
  /** Skill（PRD-M4-005）。不给就没有 Skill 清单与 skill.load */
  skills?: SkillRegistry
  /** 能力范围（M5-001）：子 agent 的会话只能用这些。不给 = 不额外收窄 */
  scope?: (capabilityId: string) => boolean
  /** 第几层子 agent。0 = 用户直接对话的会话；到 MAX_SPAWN_DEPTH 就不再给 task.spawn */
  spawnDepth?: number
  /** 追加在配置规则前面的规则（审阅会话放行 review.report，M7-010） */
  extraRules?: ReadonlyArray<{ name: string; capability: string; decision: 'allow' | 'deny' | 'ask' }>
  /**
   * 带不带项目上下文（PRD-M8-004）。false = 自由会话：不问工作区信任、不加载规矩文件与项目级 Skill。默认 true
   */
  projectContext?: boolean
  /** 计划审阅策略（PRD-M8-005）。任务会话取项目设置；不给 = 每个计划都问人 */
  planReview?: () => 'auto' | 'always' | 'never'
  /** 即使规则放行也要问人的能力（PRD-M8-004：自由会话里的 shell.exec）。只收紧不放松 */
  askAlways?: readonly string[]
  /** 这个会话自己的用量上限（M7-009，长任务节点用）。覆盖配置里的 budget */
  budget?: BudgetLimits
  /** 计划批准后转长任务（M7-005）。daemon 里接 TaskService；不给就不能转 */
  startTask?: (spec: unknown, cwd: string) => Promise<string>
  /** 子 agent 会话的事件往哪推（daemon 里是这个子会话的订阅者） */
  childEvents?: (sessionId: string, envs: EventEnvelope[]) => void
}

/** 一轮输入里除了文字之外的东西（PRD-M8-010） */
export interface SubmitInputs {
  /** attachment.put 返回的 id */
  uploads?: readonly string[]
  /** 相对工作目录的路径 */
  files?: readonly string[]
  skills?: readonly string[]
}

/** 文件名模糊匹配：子串优先（文件名命中排前面），其次按字符顺序的子序列 */
export function fuzzyFiles(all: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...all].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const scored: Array<[number, string]> = []
  for (const f of all) {
    const l = f.toLowerCase()
    const base = l.slice(l.lastIndexOf('/') + 1)
    let score: number
    if (base.startsWith(q)) score = 0
    else if (base.includes(q)) score = 1
    else if (l.includes(q)) score = 2
    else {
      let i = 0
      for (const ch of l) if (ch === q[i]) i++
      if (i < q.length) continue
      score = 3
    }
    scored.push([score * 10_000 + Math.min(l.length, 9_999), f])
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map(([, f]) => f)
}

export class DomiSession {
  private readonly log: SqliteEventLog
  private readonly tools: ToolRegistry
  private readonly permissions: PermissionEngine
  /** 类型诊断（M7-007）：每个 tsconfig 一个常驻 LanguageService */
  private readonly diagnostics = new DiagnosticsService()
  /** 后台命令（M7-001）。会话关闭时一起杀掉 */
  private readonly jobs: JobTable
  /** 仓库根与工作区信任（M7-002）。null = 本会话还没决定 */
  private readonly repoRoot: string
  private trusted: boolean | null = null
  private readonly trustStore: TrustStore
  /** Skill 清单 = 共享注册表 + 仓库 .domi/skills/（信任之后才叠） */
  private readonly skillSource: SkillOverlay | undefined
  /** 用户配置的钩子（M7-003）。只从 config 来 */
  private readonly hooks: HookRunner
  /** 上传的附件（M8-010） */
  readonly attachments: AttachmentStore
  private provider: ModelProvider
  /** 注入的替身不随切换重建——测试要的就是同一个实例 */
  private readonly injectedProvider: boolean
  private readonly listeners: Partial<SessionEvents> = {}
  /** 已推送到的**自己的** seq（不是视图 seq） */
  private lastSeq = 0
  /** 视图前缀长度：分支会话先接上父链那一段（TASK-M3-014）。对一个会话是常数 */
  private readonly offset: number
  private noticesDelivered = 0
  private busy = false
  /** 计划模式（M7-005）。从事件流里最后一条 mode.switch 恢复 */
  private mode: 'plan' | 'act' = 'act'
  private modeLoaded = false
  /** 当前的计划模式是新建任务时系统开的（M8-005），不是用户切的 */
  private autoPlanned = false
  private titleTried = false
  private planTool!: ReturnType<typeof makePlanSubmitTool>
  private currentModel: string
  private currentProvider: string

  constructor(private readonly opts: SessionOptions) {
    this.log = new SqliteEventLog({ path: opts.dbPath, cwd: opts.cwd })
    this.offset = this.log.viewOffset(opts.sessionId)
    this.currentModel = opts.config.model.name
    this.currentProvider = opts.config.model.provider

    const permissions = new PermissionEngine(
      {
        rules: [...(opts.extraRules ?? []), ...opts.config.permissions.rules],
        ...(opts.scope ? { scope: opts.scope } : {}),
        mode: () => this.mode,
        ...(opts.askAlways && opts.askAlways.length > 0
          ? { askAlways: (c: string) => (opts.askAlways as readonly string[]).includes(c) }
          : {}),
        cwd: opts.cwd,
      },
      (capabilityId, args, o) => this.askUser(capabilityId, args, o?.grantable === true),
    )
    this.permissions = permissions
    const outputDir = join(dirname(opts.dbPath), 'outputs', opts.sessionId)
    this.attachments = new AttachmentStore(
      dirname(opts.dbPath),
      (opts.config.attachments?.maxMB ?? DEFAULT_ATTACHMENT_MAX_BYTES / 1024 / 1024) * 1024 * 1024,
    )
    this.hooks = new HookRunner(opts.config.hooks ?? [], { sessionId: opts.sessionId, cwd: opts.cwd })
    this.jobs = new JobTable({ outputDir })
    this.tools = new ToolRegistry({
      cwd: opts.cwd,
      permissions,
      elicit: (tool, req) => this.askInput(tool.capability, req),
      jobs: this.jobs,
      outputDir,
      ...(this.hooks.empty ? {} : { hooks: this.hooks.toolHooks() }),
      // 预算闸门（M7-009）：每次调用之前算用量，到顶问人
      gate: makeBudgetGate({
        base: () => ({ ...(opts.config.budget ?? {}), ...(opts.budget ?? {}) }),
        events: () => this.view(),
        pricing: opts.pricing ?? {},
        ask: async (message, detail) => {
          const r = await this.askInput('budget.exceeded', { message, requestedSchema: BUDGET_DECISION_SCHEMA }, detail)
          if (r.action !== 'accept') return { action: 'stop' }
          const limit =
            typeof r.content?.limit === 'number' && Number.isFinite(r.content.limit) ? r.content.limit : undefined
          return r.content?.action === 'raise' && limit !== undefined
            ? { action: 'raise', limit }
            : { action: 'continue' }
        },
      }),
    })
      .register(fsRead)
      .register(fsWrite)
      .register(shellExec)
      // M7-001 编码工具：不新增能力类别（edit 归 fs.write，glob / grep / 输出查询归 fs.read，终止归 shell.exec）
      .register(fsEdit)
      .register(fsGlob)
      .register(fsGrep)
      .register(makeShellOutputTool(this.jobs))
      .register(makeShellKillTool(this.jobs))
      // M7-007 代码结构理解：只读，TypeScript 第一次用到才加载
      .register(makeOutlineTool())
      .register(makeDiagnosticsTool(this.diagnostics))
    // PRD-M2-004 AC-2：检索是工具，由模型决定何时调用。以插件形态注册（PRD-M6-001 AC-3）
    for (const t of memorySearchPlugin.tools?.({ search: this.log.search }) ?? []) this.tools.register(t)
    if (opts.memory) this.tools.register(makeMemoryRecallTool(opts.memory))
    this.repoRoot = findRepoRoot(opts.cwd)
    this.trustStore = new TrustStore(join(dirname(opts.dbPath), 'trust.json'))
    this.skillSource = opts.skills
      ? new SkillOverlay(opts.skills, () =>
          this.trusted ? projectSkillsDir(this.repoRoot, dirname(opts.dbPath)) : null,
        )
      : undefined
    if (this.skillSource) this.tools.register(makeSkillLoadTool(this.skillSource))
    if ((opts.spawnDepth ?? 0) < MAX_SPAWN_DEPTH) this.tools.register(makeSpawnTool(this))
    // plan.submit 一直在册，但只有计划模式下能用（权限层按模式放行 / 拒绝）；执行模式下不发给模型
    this.planTool = makePlanSubmitTool({
      approved: () => {
        this.mode = 'act'
        this.tools.unregister('plan.submit')
        return [{ t: 'mode.switch', to: 'act', reason: '计划已批准' }]
      },
      ...(opts.startTask
        ? { startTask: (spec: unknown) => (opts.startTask as NonNullable<typeof opts.startTask>)(spec, opts.cwd) }
        : {}),
      // 项目的审阅策略只管系统替用户开的规划（新任务）；用户自己切到计划模式的，照旧每次都问
      reviewPolicy: () => (this.autoPlanned && opts.planReview ? opts.planReview() : 'always'),
    })

    // M1-001：provider 由工厂按配置建。kernel 与本文件都不知道「有哪些 provider」，
    // 那份知识只在 packages/model/src/factory.ts 里（AC-4 的 diff 为 0 靠这个成立）
    this.injectedProvider = opts.provider !== undefined
    this.provider = opts.provider ?? this.buildProvider(opts.config.model.provider, opts.config.model.name)
  }

  private now(): number {
    return (this.opts.clock ?? { now: () => Date.now() }).now()
  }

  private buildProvider(provider: string, name: string): ModelProvider {
    // 凭据、地址、能力覆盖都只按这一家取（providerConnection）：别家没配 key 就是没配，
    // 不回落到默认那一家的——那样会把一家的 key 发往另一家的地址（BUG-M9-002）
    return createProvider(providerConfigOf(providerConnection(this.opts.config, provider), name))
  }

  /**
   * 换一份配置（PRD-M8-011 AC-3：设置页改完，下一轮生效）。已经在跑的这一轮不受影响；
   * 权限规则与钩子不从设置页改，这里不重建它们。模型实例按新凭据重建（测试注入的替身不动）
   */
  reconfigure(config: DomiConfig): void {
    ;(this.opts as { config: DomiConfig }).config = config
    if (!this.injectedProvider) this.provider = this.buildProvider(this.currentProvider, this.currentModel)
  }

  /**
   * 当前 provider 有没有 key（OPT-M8-001）。domid 允许无 key 启动，缺 key 的事留到提交时说：
   * 不然第一次用的人连设置页都打不开，也就没处填第一把 key。测试注入的替身不查
   */
  checkCredential(): void {
    if (this.injectedProvider) return
    if (providerConnection(this.opts.config, this.currentProvider).apiKey) return
    const isDefault = this.currentProvider === this.opts.config.model.provider
    throw new MissingCredentialError(credentialEnvNames(this.currentProvider, isDefault), this.currentProvider)
  }

  /** 当前在用的 provider 与模型（会话中途可能被 switchModel 换掉） */
  modelInfo(): { provider: string; model: string } {
    return { provider: this.currentProvider, model: this.currentModel }
  }

  on<K extends keyof SessionEvents>(k: K, fn: SessionEvents[K]): this {
    this.listeners[k] = fn
    return this
  }

  private askUser(
    capabilityId: string,
    args: unknown,
    grantable = false,
  ): Promise<{ allowed: boolean; channel?: string; grant?: boolean }> {
    return new Promise((resolve) => {
      const ask: PendingAsk = {
        capabilityId,
        args,
        ...(grantable ? { grantable: true } : {}),
        answer: (allowed, _content, channel, grant) => {
          this.listeners.onAsk?.(null)
          resolve({
            allowed,
            ...(channel === undefined ? {} : { channel }),
            ...(grantable && grant === true ? { grant: true } : {}),
          })
        },
      }
      if (!this.listeners.onAsk) {
        // 没有人能回答（非交互环境）→ 拒绝。与 PermissionEngine 的兜底同一个立场
        resolve({ allowed: false })
        return
      }
      this.listeners.onAsk(ask)
    })
  }

  /**
   * 工具向用户要输入（TASK-M3-016）。走和权限确认同一个通道，能力 id 是「同组.input」，
   * 比如 mcp.github.create_issue 要输入时显示为 mcp.github.input。没人能回答 → decline，不替人填
   */
  private askInput(
    capability: string,
    req: { message: string; requestedSchema?: unknown },
    detail?: Record<string, unknown>,
  ): Promise<{ action: 'accept' | 'decline'; content?: Record<string, unknown> }> {
    // 运行时自己问的（预算到顶）用原名；工具要输入时显示为「同组.input」
    const capabilityId =
      detail !== undefined ? capability : `${capability.split('.').slice(0, -1).join('.') || capability}.input`
    return new Promise((resolve) => {
      if (!this.listeners.onAsk) {
        resolve({ action: 'decline' })
        return
      }
      this.listeners.onAsk({
        capabilityId,
        args: { message: req.message, ...detail },
        form: { message: req.message, schema: req.requestedSchema ?? { type: 'object', properties: {} } },
        answer: (allowed, content) => {
          this.listeners.onAsk?.(null)
          // 拒绝时也带上内容（计划审批的驳回意见）；转给 MCP server 之前会剥掉（hub.ts）
          resolve({ action: allowed ? 'accept' : 'decline', ...(content === undefined ? {} : { content }) })
        },
      })
    })
  }

  /** 把自上次以来的新事件推给订阅者。轮询而非推送是 M0 的简化，M3 换成协议推送 */
  async pump(): Promise<void> {
    const own = await this.log.read(this.opts.sessionId, { fromSeq: this.lastSeq + 1 })
    if (own.length === 0) return
    this.lastSeq = own[own.length - 1]!.seq
    // 推出去的是视图 seq：客户端看到的分支是一条从 1 开始的连续流，不知道也不必知道拼接
    const fresh =
      this.offset === 0
        ? own
        : own.map((e) => ({
            ...e,
            seq: e.seq + this.offset,
            parentSeq: (e.parentSeq ?? 0) + this.offset,
          }))
    this.listeners.onEvents?.(fresh)

    if (this.listeners.onMetrics) {
      const all = await this.view()
      const m = aggregate(all, {
        pricing: this.opts.pricing ?? {},
        maxContextTokens: this.opts.config.context.maxTokens,
        // 这一轮还在跑：耗时算到现在；跑完了就算到这一轮最后一条事件
        ...(this.busy ? { now: this.now() } : {}),
      })
      this.listeners.onMetrics({
        tokens: m.tokens,
        cost: formatCost(m),
        turnMs: m.turnMs,
        contextPercent: m.contextPercent,
        contextLevel: contextLevel(m.contextPercent),
        unpricedModels: m.unpricedModels,
        verify: verifyState(all, { command: this.opts.config.verify?.command }),
        mode: this.mode,
        turns: m.turns,
        steps: m.steps,
        tokPerSec: m.tokPerSec,
        cacheHitPercent: m.cacheHitPercent,
      })
    }
  }

  /**
   * 会话中途切换模型 —— PRD-M1-002。
   *
   * 事件流**一条不动**：切换只是追加一个 model.switch。
   * 上下文按新模型窗口重拼是 buildContext 的事，所以 AC-3 的
   * 「历史事件零丢失」是自动成立的——这正是选事件流架构换来的。
   *
   * 允许同时换 provider：「贵模型想思路、便宜模型跑体力活」在现实里
   * 常常是跨 provider 的（Claude 想 → 本地 Qwen 跑）。
   */
  async switchModel(to: string, opts: { provider?: string; reason?: string } = {}): Promise<{ lost: string[] }> {
    const from = this.currentModel
    const toProvider = opts.provider ?? this.currentProvider
    const lost = this.previewSwitch(to, toProvider).lost

    this.currentModel = to
    this.currentProvider = toProvider
    // provider 实例在构造时就绑定了模型名，只改字符串的话请求照旧发给旧模型。
    // 跨 provider 时用那一家自己的 key / base_url（providerConnection）
    if (!this.injectedProvider) this.provider = this.buildProvider(toProvider, to)
    await this.log.append(this.opts.sessionId, [
      {
        t: 'model.switch',
        from,
        to,
        provider: toProvider,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        ...(lost.length > 0 ? { lostCapabilities: lost } : {}),
      },
    ])
    this.log.sessions.upsert({ id: this.opts.sessionId, cwd: this.opts.cwd, model: to })
    await this.pump()
    return { lost }
  }

  /**
   * 切之前问一下会失去什么，给 TUI 弹确认用（AC-2）。
   *
   * 比的是**两个模型各自声明的矩阵**，不是当前 provider 实例的能力——
   * 注入替身时后者是「全都支持」，拿它当基准会把每次切换都报成降级。
   */
  previewSwitch(to: string, toProvider?: string): { lost: string[] } {
    // 带上各自那一家的能力覆盖：不然配置里显式打开的能力会被当成「要失去」
    const cfg = this.opts.config
    const target = toProvider ?? this.currentProvider
    const before = capabilitiesFor(providerConfigOf(providerConnection(cfg, this.currentProvider), this.currentModel))
    const after = capabilitiesFor(providerConfigOf(providerConnection(cfg, target), to))
    return { lost: lostCapabilities(before, after) }
  }

  /**
   * 自动生成会话标题 —— PRD-M1-006 AC-1 / PRD-M1-005 的 M1 内直接消费方。
   *
   * 失败时降级为首条用户输入前 40 字符。降级路径必须存在且被测到：
   * 标题生成失败不该让一次正常对话看起来「出错了」——
   * 它只是个标题。
   */
  async generateTitle(): Promise<string> {
    const events = await this.view()
    const firstInput = events.find((e) => e.ev.t === 'user.input')
    const fallbackSource = firstInput ? (firstInput.ev as { text: string }).text : ''
    const fallback = fallbackSource.slice(0, 40)

    try {
      const r = await generateStructured(
        { provider: this.provider, capabilities: this.provider.capabilities },
        TitleSchema,
        {
          model: this.currentModel,
          messages: [{ role: 'user', content: `给下面这段对话起一个不超过 20 字的标题：\n${fallbackSource}` }],
        },
      )
      const title = r.title.trim()
      const final = title === '' ? fallback : title
      this.log.sessions.upsert({ id: this.opts.sessionId, cwd: this.opts.cwd, title: final })
      return final
    } catch (e) {
      if (!(e instanceof StructuredOutputError)) throw e
      this.log.sessions.upsert({ id: this.opts.sessionId, cwd: this.opts.cwd, title: fallback })
      return fallback
    }
  }

  /**
   * 第一轮对话结束后自动生成标题 —— PRD-M10-001 AC-1。
   *
   * fire-and-forget：标题生成要调一次真实 LLM，不该拖住 submit 的返回。
   * 判据（SPEC-M10 取舍-1）：本生命周期内没试过 && sessions 里还没有标题 &&
   * 事件流里已有 assistant 事件（第一轮已产出）。
   * 任何错误都不往外抛：标题只是标题；失败下一轮自然再试（daemon 重启后 titleTried 清零）。
   */
  private async maybeAutoTitle(): Promise<void> {
    if (this.titleTried) return
    this.titleTried = true // 先标记：并发多轮也不会重复触发
    try {
      const row = this.log.sessions.get(this.opts.sessionId)
      if (row && row.title.trim() !== '') return // 已有标题（含手动重命名，AC-3）
      const events = await this.view()
      // 事件流里没有 assistant 类型：模型回复由 model.request + model.delta 构成，第一轮已产出 = 已有 model.delta
      if (!events.some((e) => e.ev.t === 'model.delta')) return
      await this.generateTitle()
    } catch {
      // 标题只是标题
    }
  }

  /** 测试与轨迹面板用：读出这个会话的全部事件（不走增量推送） */
  async pumpAll(): Promise<EventEnvelope[]> {
    return this.view()
  }

  /**
   * 会话的**视图**：分支 = 父链到分叉点 + 自己（BUG-M3-010）。
   * 上下文、压缩、指标、标题、订阅全都看这一份；只有追加写的是自己
   */
  private view(): Promise<EventEnvelope[]> {
    return this.offset === 0 ? this.log.read(this.opts.sessionId) : this.log.readLineage(this.opts.sessionId)
  }

  /**
   * LLM 压缩 —— PRD-M2-003 AC-1。
   *
   * 只追加一条 `ctx.compact`，**原始事件一条不动**（INV-12）。
   * 失败时什么都不做：压缩失败不该让一次正常对话看起来出错了——
   * 大不了这一轮上下文长一点。这和标题生成是同一条降级原则。
   */
  async compactNow(trigger: 'threshold' | 'manual' = 'manual'): Promise<{ ok: boolean; detail: string }> {
    const events = await this.view()
    try {
      const r = await compact(events, {
        trigger,
        keepTurns: this.opts.config.context.keepTurns ?? 2,
        summarize: async ({ text }) =>
          generateStructured({ provider: this.provider, capabilities: this.provider.capabilities }, SummarySchema, {
            model: this.currentModel,
            messages: [
              {
                role: 'user',
                content: `把下面这段对话历史压成结构化摘要。只保留后面还用得上的信息，不要复述每一步。\n\n${text}`,
              },
            ],
          }),
      })
      if (r.covered.length === 0) return { ok: false, detail: '轮数还不够，没什么可压的' }
      await this.log.append(this.opts.sessionId, [r.event])
      await this.pump()
      return {
        ok: true,
        detail: `已压缩 seq ${r.event.fromSeq}–${r.event.toSeq}，${r.event.tokensBefore} → ${r.event.tokensAfter} tokens（保留最近 ${r.event.keptTurns} 轮）`,
      }
    } catch (e) {
      // 失败也要留痕，而且走**事件流**而不是侧信道：
      // 只在 UI 里闪一下的状态，事后排查时等于没发生过
      const message = `上下文压缩失败，这一轮照常继续：${e instanceof Error ? e.message : String(e)}`
      await this.log.append(this.opts.sessionId, [{ t: 'error', scope: 'compact', message, recoverable: true }])
      await this.pump()
      return { ok: false, detail: message }
    }
  }

  // ── 给子 agent 与编排用的（M5）─────────────────────────────

  get id(): string {
    return this.opts.sessionId
  }

  /** 建一个子 agent 会话（M5-001）：同一个库、同一份配置，权限在自己的范围上再收窄 */
  createChild(c: { sessionId: string; title: string; tools: readonly string[] | undefined; depth?: number }): {
    child: DomiSession
    childEvents: SessionOptions['childEvents']
  } {
    const o = this.opts
    const scope = c.tools === undefined ? o.scope : scopeOf(c.tools, o.scope)
    // 子 agent 跟父会话同一类、同一个项目（M8-004）
    const parent = this.log.sessions.get(o.sessionId)
    this.log.sessions.upsert({
      id: c.sessionId,
      cwd: o.cwd,
      title: c.title,
      spawnedBy: o.sessionId,
      ...(parent?.kind ? { kind: parent.kind, projectId: parent.projectId } : {}),
    })
    const child = new DomiSession({
      config: o.config,
      dbPath: o.dbPath,
      cwd: o.cwd,
      sessionId: c.sessionId,
      ...(this.injectedProvider ? { provider: this.provider } : {}),
      ...(o.memory ? { memory: o.memory } : {}),
      ...(o.skills ? { skills: o.skills } : {}),
      ...(o.extraTools ? { extraTools: o.extraTools } : {}),
      ...(o.clock ? { clock: o.clock } : {}),
      ...(o.pricing ? { pricing: o.pricing } : {}),
      ...(scope ? { scope } : {}),
      // 自由会话的限制子 agent 也要带着（只能更严）
      ...(o.projectContext === false ? { projectContext: false } : {}),
      ...(o.askAlways ? { askAlways: o.askAlways } : {}),
      ...(o.childEvents ? { childEvents: o.childEvents } : {}),
      spawnDepth: c.depth ?? (o.spawnDepth ?? 0) + 1,
    })
    return { child, childEvents: o.childEvents }
  }

  /** 子会话的询问转给自己的订阅者回答：人在看的是父会话 */
  forwardAsk(ask: PendingAsk | null): void {
    if (ask === null) return
    if (!this.listeners.onAsk) {
      ask.answer(false)
      return
    }
    this.listeners.onAsk({
      ...ask,
      answer: (allowed, content, channel, grant) => {
        this.listeners.onAsk?.(null)
        ask.answer(allowed, content, channel, grant)
      },
    })
  }

  /**
   * 追加任意事件并推给订阅者（编排的运行会话用：task.* 事件由 orchestrator 生成）。
   * 不经 kernel：运行会话里没有模型对话
   */
  async appendEvents(evs: Parameters<SqliteEventLog['append']>[1]): Promise<void> {
    await this.log.append(this.opts.sessionId, evs)
    await this.pump()
  }

  /** 在这个会话里直接跑一个工具（编排的 tool 节点）。调用、权限、结果都落进本会话，和模型发起的一样可审计 */
  async runTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; payload: unknown; reason?: string }> {
    for (const t of this.opts.extraTools?.(this.opts.cwd) ?? []) this.tools.register(t)
    const id = `node-${this.now().toString(36)}`
    await this.appendEvents([{ t: 'tool.call', id, name, args }])
    const t0 = this.now()
    const r = await this.tools.run({ id, name, args }, signal)
    await this.appendEvents([
      ...(r.events ?? []),
      {
        t: 'tool.result',
        id,
        ok: r.ok,
        payload: r.payload,
        ms: Math.max(0, this.now() - t0),
        ...(r.reason === undefined ? {} : { reason: r.reason }),
      },
    ])
    return { ok: r.ok, payload: r.payload, ...(r.reason === undefined ? {} : { reason: r.reason }) }
  }

  /** 问人一个是 / 否（编排的 human-approval 节点）。没人能回答时是「否」 */
  async askApproval(
    message: string,
    detail: Record<string, unknown> = {},
    capabilityId = 'task.approval',
  ): Promise<{ allowed: boolean; channel?: string }> {
    return this.askUser(capabilityId, { message, ...detail })
  }

  /** 事件流里最后一条 mode.switch 决定当前模式（重开会话后仍在计划模式） */
  private async loadMode(): Promise<void> {
    if (this.modeLoaded) return
    this.modeLoaded = true
    const view = await this.view()
    for (let i = view.length - 1; i >= 0; i--) {
      const ev = (view[i] as EventEnvelope).ev as { t: string; to?: 'plan' | 'act'; reason?: string }
      if (ev.t === 'mode.switch' && ev.to) {
        this.applyMode(ev.to)
        this.autoPlanned = ev.reason === AUTO_PLAN_REASON
        break
      }
    }
  }

  private applyMode(to: 'plan' | 'act'): void {
    this.mode = to
    if (to === 'plan') this.tools.register(this.planTool)
    else this.tools.unregister('plan.submit')
  }

  /** 切换计划 / 执行模式（PRD-M7-005）。和当前一样时什么都不写 */
  async setMode(to: 'plan' | 'act', reason?: string): Promise<{ mode: 'plan' | 'act'; changed: boolean }> {
    await this.loadMode()
    if (this.mode === to) return { mode: to, changed: false }
    this.applyMode(to)
    this.autoPlanned = reason === AUTO_PLAN_REASON
    await this.log.append(this.opts.sessionId, [{ t: 'mode.switch', to, ...(reason === undefined ? {} : { reason }) }])
    await this.pump()
    return { mode: to, changed: true }
  }

  getMode(): 'plan' | 'act' {
    return this.mode
  }

  /**
   * 设这个会话的用量上限（PRD-M7-009）。落成 budget.decided（action: raise），重开会话后照样生效
   */
  async setBudget(limits: BudgetLimits): Promise<void> {
    const evs: DomiEvent[] = []
    for (const [kind, limit] of Object.entries(limits) as Array<[keyof BudgetLimits, number | undefined]>) {
      if (limit !== undefined) evs.push({ t: 'budget.decided', action: 'raise', kind, limit })
    }
    if (evs.length === 0) return
    await this.log.append(this.opts.sessionId, evs)
    await this.pump()
  }

  setBusy(busy: boolean): void {
    this.busy = busy
    this.listeners.onBusy?.(busy)
  }

  /** 最近一轮模型的最后一段回答（子 agent 的结论、agent-step 的输出） */
  async lastAnswer(): Promise<string> {
    const view = await this.view()
    let text = ''
    for (const e of view) {
      if (e.ev.t === 'model.request' || e.ev.t === 'user.input') text = ''
      else if (e.ev.t === 'model.delta') text += (e.ev as { text: string }).text
    }
    return text.trim()
  }

  /**
   * 补到最后一个一致点（PRD-M3-002 AC-3）。进程被 kill -9 之后，事件流里可能留着
   * 没结果的工具调用、没结束的一轮——打开会话时先补上，之后的一切才站得住。
   * 已经一致时什么都不写，所以每次打开都调也没关系。**不自动接着跑**：见 kernel/recovery.ts
   * 返回补了几条
   */
  async recover(): Promise<number> {
    const events = await this.view()
    await this.restoreModel(events)
    // 本会话给过的「始终允许」（M8-016）：重开会话照样生效
    this.permissions.restoreGrants(
      events.flatMap((e) => {
        const ev = e.ev as { t: string; source?: string; grant?: { capability: string; scope?: string } }
        return ev.t === 'permission' && ev.source === 'user' && ev.grant !== undefined ? [ev.grant] : []
      }),
    )
    const fix = recoveryEvents(events)
    if (fix.length === 0) return 0
    await this.log.append(this.opts.sessionId, fix)
    await this.pump()
    return fix.length
  }

  /**
   * 重开会话时回到关闭前用的模型（PRD-M9-003 AC-6 · BUG-M9-001）。
   *
   * 以前会话一重开就回到配置里的默认模型——切过的模型只活在内存里。事件流才是真相（INV-01）：回放最后一条 `model.switch`。
   * - 带 provider（v12 起）且那一家还启用 → 用它
   * - v11 及以前的没有 provider：那时的代码除非显式指定，都是在默认那一家下换模型，按默认那一家算
   * - 那一家已停用或删除 → 回到默认模型，并**追加一条** `model.switch` 说明原因：模型确实换了，这是一个事实，
   *   和 recover 补齐中断的工具调用是同一个立场；对话里据此提示一次（之后最后一条就是它，不会重复）
   */
  private async restoreModel(events: readonly EventEnvelope[]): Promise<void> {
    if (this.injectedProvider) return
    let last: { to: string; provider?: string } | undefined
    for (const e of events) if (e.ev.t === 'model.switch') last = e.ev as { to: string; provider?: string }
    if (last === undefined) return
    const cfg = this.opts.config
    const provider = last.provider ?? cfg.model.provider
    const usable = listProviders(cfg).some((p) => p.id === provider && p.enabled)
    if (usable) {
      if (provider === this.currentProvider && last.to === this.currentModel) return
      this.currentModel = last.to
      this.currentProvider = provider
      this.provider = this.buildProvider(provider, last.to)
      return
    }
    const to = cfg.model.name
    const from = last.to
    this.currentModel = to
    this.currentProvider = cfg.model.provider
    this.provider = this.buildProvider(this.currentProvider, to)
    await this.log.append(this.opts.sessionId, [
      {
        t: 'model.switch',
        from,
        to,
        provider: this.currentProvider,
        reason: `供应商「${provider}」已停用或删除，回到默认模型`,
      },
    ])
    this.log.sessions.upsert({ id: this.opts.sessionId, cwd: this.opts.cwd, model: to })
    await this.pump()
  }

  /** 进程级提示落成事件：走事件流而不是侧信道，事后查轨迹时才看得见（与压缩失败同一个立场） */
  private async deliverNotices(): Promise<void> {
    const all = this.opts.notices?.() ?? []
    const fresh = all.slice(this.noticesDelivered)
    if (fresh.length === 0) return
    this.noticesDelivered = all.length
    await this.log.append(
      this.opts.sessionId,
      fresh.map((message) => ({ t: 'error' as const, scope: 'mcp', message, recoverable: true })),
    )
  }

  /**
   * 工作区信任（PRD-M7-002 AC-3）：仓库里有规矩文件或 .domi/ 时，第一轮之前决定能不能加载。
   * 以前答过就沿用；没人能回答就按不信任且**不记住**（下次有人时再问）。每个会话只落一次事件
   */
  private async ensureTrust(): Promise<void> {
    if (this.trusted !== null) return
    if (this.opts.projectContext === false) {
      this.trusted = false
      return
    }
    if (!hasProjectContent(this.repoRoot, this.opts.cwd, dirname(this.opts.dbPath))) {
      this.trusted = false
      return
    }
    const stored = this.trustStore.get(this.repoRoot)
    let source: 'user' | 'stored' | 'default'
    if (stored !== undefined) {
      this.trusted = stored
      source = 'stored'
    } else if (!this.listeners.onAsk) {
      this.trusted = false
      source = 'default'
    } else {
      const files = rulesFiles(this.repoRoot, this.opts.cwd).map((f) => f.slice(this.repoRoot.length + 1))
      const { allowed } = await this.askUser('workspace.trust', {
        root: this.repoRoot,
        message: '要信任这个仓库吗？信任后，它自带的规矩文件与项目级 Skill 会放进提示词（不会执行任何东西）',
        files,
        projectDir: `${this.repoRoot}/.domi`,
      })
      this.trusted = allowed
      source = 'user'
      this.trustStore.set(this.repoRoot, allowed, this.now())
    }
    await this.log.append(this.opts.sessionId, [
      { t: 'workspace.trust', root: this.repoRoot, trusted: this.trusted, source },
    ])
  }

  /** 到窗口 70% 就自动压一次（AC-1）。只在 strategy = 'compact' 时生效 */
  private async maybeAutoCompact(): Promise<void> {
    if (this.opts.config.context.strategy !== 'compact') return
    const events = await this.view()
    const used = aggregate(events, { maxContextTokens: this.opts.config.context.maxTokens }).tokens
    const total = used.input + used.output
    if (!shouldCompact(total, this.opts.config.context.maxTokens, (this.opts.config.context.compactAt ?? 70) / 100))
      return
    await this.compactNow('threshold')
  }

  /**
   * 校验并规整跨会话引用（PRD-M3-005）：会话要存在、起点要在它的范围内；
   * 终点超出就截到末尾——「引用这一轮」时客户端不知道这一轮最后一条的 seq。
   * 规整后的区间就是落进事件的链接，之后不会再变
   */
  async checkRefs(refs: readonly RefLink[]): Promise<RefLink[]> {
    const out: RefLink[] = []
    for (const r of refs) {
      if (!this.log.sessions.get(r.sessionId)) throw new RefError('error.ref.noSession', { sessionId: r.sessionId })
      const head = this.log.viewOffset(r.sessionId) + (await this.log.head(r.sessionId))
      if (r.fromSeq < 1 || r.fromSeq > head) {
        throw new RefError('error.ref.outOfRange', { sessionId: r.sessionId, head, fromSeq: r.fromSeq })
      }
      if (r.toSeq < r.fromSeq) throw new RefError('error.ref.reversed', { fromSeq: r.fromSeq, toSeq: r.toSeq })
      out.push({ sessionId: r.sessionId, fromSeq: r.fromSeq, toSeq: Math.min(r.toSeq, head) })
    }
    return out
  }

  /**
   * 这一轮发给模型的提示词（BUG-M3-015 / BUG-M3-012）：内置层 + 配置里的层，同 id 覆盖。
   * 每轮现拼（便宜），换了模型也跟着变；cache 边界不合法时 assemble 当场抛错
   */
  private prompt(): { system: string; dynamic: string } {
    const extra: PromptLayer[] = []
    const soul = this.opts.memory?.promptText() ?? ''
    // Soul 很少变，放稳定前缀里（ADR-019）；空的时候不放，免得多一段没内容的说明
    if (soul !== '')
      extra.push({ id: 'builtin.soul', role: 'system', priority: 400, cacheable: true, render: () => soul })
    // 仓库自带的规矩（M7-002）：信任之后才放。每轮现读，改了下一轮生效
    const rules = this.trusted ? rulesText(this.repoRoot, this.opts.cwd) : ''
    if (rules !== '') {
      extra.push(projectRulesLayer(rules))
    }
    const catalog = this.skillSource?.catalog() ?? ''
    if (catalog !== '') {
      extra.push({ id: 'builtin.skills', role: 'system', priority: 450, cacheable: true, render: () => catalog })
    }
    const layers = mergeLayers([...BUILTIN_LAYERS, ...extra], layersFromConfig(this.opts.config.prompt.layers))
    const a = assemble(layers, { cwd: this.opts.cwd, model: this.currentModel })
    const text = (role: 'system' | 'user'): string =>
      a.messages
        .filter((m) => m.role === role)
        .map((m) => (m as { content: string }).content)
        .join('\n\n')
    return { system: text('system'), dynamic: text('user') }
  }

  /**
   * 完成前验证（PRD-M7-004 AC-2）：这一轮改了文件、之后没有成功的验证，模型却要结束——追加一条提示再来一轮。
   * 到上限就如实结束，最后一条提示标 final
   */
  private async verifyGate(events: readonly EventEnvelope[]): Promise<{ again: boolean; events: DomiEvent[] }> {
    const v = this.opts.config.verify
    if (!v?.enabled || this.mode === 'plan') return { again: false, events: [] }
    const state = verifyState(events, { command: v.command })
    if (state === 'verified' || state === 'clean' || !changedThisTurn(events)) return { again: false, events: [] }
    const n = verifyNudges(events)
    const how = v.command ? `（${v.command}）` : '（测试 / 类型检查 / lint，看仓库的规矩文件怎么说）'
    if (n >= v.maxNudges) {
      return {
        again: false,
        events: [
          {
            t: 'verify.required',
            attempt: n,
            final: true,
            message: `已经提醒过 ${n} 次，这一轮在没有通过验证的情况下结束。`,
          },
        ],
      }
    }
    const message =
      state === 'unverified'
        ? `你这一轮改了文件，但还没有成功跑过验证。结束前先跑这个项目的验证命令${how}，确认通过；确实没法验证的话，说明原因再结束。`
        : `最近一次验证没有通过。修好再结束；如果失败与这次改动无关，说明原因再结束。`
    return { again: true, events: [{ t: 'verify.required', attempt: n + 1, message }] }
  }

  /** 按链接读出被引用的那一段（对方会话的视图编号） */
  private async readRef(ref: RefLink): Promise<EventEnvelope[]> {
    const all = await this.log.readLineage(ref.sessionId)
    return all.filter((e) => e.seq >= ref.fromSeq && e.seq <= ref.toSeq)
  }

  /** refs 应当先经过 checkRefs；这里不再校验 */
  /**
   * 这一轮带的附件、文件引用、技能（PRD-M8-010）：提交之前校验，接受之后的错误用户看不见。
   * 图片附件而当前模型不支持图片 → 拒绝（UNSUPPORTED_ATTACHMENT），不静默丢掉
   */
  checkInputs(i: SubmitInputs): { uploads: UploadRef[]; files: string[]; skills: string[] } {
    const uploads = (i.uploads ?? []).map((id) => this.attachments.get(this.opts.sessionId, id))
    const images = uploads.filter((u) => isImage(u.mime))
    if (images.length > 0 && !this.provider.capabilities.vision) {
      throw new AttachmentError(
        'error.attachment.noVision',
        { model: this.currentModel, names: images.map((u) => u.name).join(', ') },
        'UNSUPPORTED_ATTACHMENT',
      )
    }
    const files = (i.files ?? []).map((f) => {
      const rel = relative(this.opts.cwd, resolve(this.opts.cwd, f))
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new AttachmentError('error.attachment.fileOutside', { path: f }, 'INVALID')
      }
      if (!existsSync(join(this.opts.cwd, rel)))
        throw new AttachmentError('error.attachment.fileMissing', { path: f }, 'NOT_FOUND')
      return rel.split(sep).join('/')
    })
    const skills = (i.skills ?? []).map((name) => {
      if (!this.skillSource?.get(name)) throw new AttachmentError('error.attachment.noSkill', { name }, 'NOT_FOUND')
      return name
    })
    return { uploads, files, skills }
  }

  /** 可以指定的技能（skill.list） */
  listSkills(): Array<{ name: string; description: string; source: string }> {
    return (this.skillSource?.list() ?? []).map((s) => ({ name: s.name, description: s.description, source: s.source }))
  }

  /** 工作目录下的文件清单（fs.list）：遵守 .gitignore，按 query 模糊匹配 */
  listFiles(query = '', limit = 50): { files: string[]; truncated: boolean } {
    const all = listFiles(this.opts.cwd).files
    const hits = fuzzyFiles(all, query)
    return { files: hits.slice(0, limit), truncated: hits.length > limit }
  }

  async submit(text: string, opts: { refs?: readonly RefLink[] } & SubmitInputs = {}): Promise<TurnResult> {
    this.checkCredential()
    const inputs = this.checkInputs(opts)
    this.busy = true
    this.listeners.onBusy?.(true)
    for (const t of this.opts.extraTools?.(this.opts.cwd) ?? []) this.tools.register(t)
    await this.deliverNotices()
    await this.loadMode()
    await this.ensureTrust()
    await this.maybeAutoCompact()
    const policy: ContextPolicy = {
      maxTokens: this.opts.config.context.maxTokens,
      includeReasoning: this.opts.config.context.includeReasoning,
      strategy: this.opts.config.context.strategy,
    }
    const timer = setInterval(() => {
      void this.pump()
    }, 30)
    try {
      const result = await runTurn(
        {
          sink: this.sink,
          provider: this.provider,
          tools: this.tools,
          clock: this.opts.clock ?? { now: () => Date.now() },
          policy,
          model: this.currentModel,
          refs: { resolve: (ref) => this.readRef(ref) },
          inputs: {
            upload: async (ref) =>
              this.attachments.load(this.opts.sessionId, ref, { vision: this.provider.capabilities.vision }),
            skill: async (name) => this.skillSource?.get(name)?.prompt,
          },
          prompt: this.prompt(),
          beforeComplete: (events) => this.verifyGate(events),
        },
        this.opts.sessionId,
        {
          text,
          ...(opts.refs && opts.refs.length > 0 ? { refs: opts.refs } : {}),
          ...inputs,
        },
      )
      return { ...result, verify: verifyState(await this.view(), { command: this.opts.config.verify?.command }) }
    } finally {
      clearInterval(timer)
      if (!this.hooks.empty) {
        const stopEvents = await this.hooks.stop()
        if (stopEvents.length > 0) await this.log.append(this.opts.sessionId, stopEvents)
      }
      this.busy = false
      await this.pump()
      this.listeners.onBusy?.(false)
      // 第一轮结束后自动生成标题。不等它：LLM 调用不该拖住这一轮的结束（PRD-M10-001 AC-1）
      void this.maybeAutoTitle()
      // 攒够轮数就抽取记忆、更新 Soul。不等它：抽取要调一次模型，不该拖住这一轮的结束
      void this.opts.memory?.afterTurn(this.opts.sessionId)
    }
  }

  /**
   * kernel 看到的事件口：写进自己，读的是视图。
   * 视图 seq = 自己的 seq + offset，所以 head 也要加上，loop 里用 head 算的位置才对得上
   */
  private readonly sink = {
    append: async (id: string, evs: Parameters<SqliteEventLog['append']>[1]) => {
      const r = await this.log.append(id, evs)
      return { from: r.from + this.offset, to: r.to + this.offset }
    },
    read: async (_id: string, o?: { fromSeq?: number; toSeq?: number }): Promise<EventEnvelope[]> => {
      const all = await this.view()
      const from = o?.fromSeq ?? 1
      const to = o?.toSeq ?? Number.MAX_SAFE_INTEGER
      return all.filter((e) => e.seq >= from && e.seq <= to)
    },
    head: async (id: string): Promise<number> => (await this.log.head(id)) + this.offset,
  }

  /**
   * 退出前把事件刷干净（PRD-M0-005 AC-3）。
   * SQLite 的写在事务提交时就落盘了，这里做的是**关闭连接**让 WAL 正确收尾——
   * 不关的话 kill 掉进程，最后一轮虽然在 WAL 里，但下次打开要走恢复流程。
   */
  async flushAndClose(): Promise<void> {
    this.jobs.killAll()
    this.diagnostics.dispose()
    await this.pump()
    this.log.close()
  }
}
