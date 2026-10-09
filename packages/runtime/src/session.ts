/**
 * DomiSession —— 一个会话的接线层（kernel + store + capability + 记忆的装配点）。
 *
 * **为什么要有这一层**：M0 还没拆 daemon，但 INV-02 要求三端零业务逻辑。
 * 如果当时让 `apps/tui` 自己去 new SqliteEventLog、装配 loop，TUI 里就有了业务逻辑，
 * M3 拆 daemon 时得一个个抠出来。所以装配从一开始就集中在这里。
 *
 * M3 拆完之后：DomiSession 跑在 domid 里（`packages/daemon` 的 runtime-host），
 * 客户端经 Domi Protocol 访问它；门面的方法签名当初就是按协议形状设计的，TUI 没有因此改写。
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
  type PermissionsMode,
  SkillOverlay,
  type SkillRegistry,
  scopeOf,
  shellExec,
  type Tool,
  ToolRegistry,
} from '@domi/capability'
import type { FileChange } from '@domi/checkpoint'
import { DiagnosticsService, makeDiagnosticsTool, makeOutlineTool } from '@domi/codeintel'
import {
  credentialEnvNames,
  type DomiConfig,
  listProviders,
  MissingCredentialError,
  modelWindow,
  providerConnection,
  VENDORS,
} from '@domi/config'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import type { PromptParts } from '@domi/kernel'
import {
  aggregate,
  buildContext,
  type ContextPolicy,
  contextLevel,
  effectiveWindow,
  estimateIncrement,
  evaluate,
  type Fingerprint,
  formatCost,
  type NoteSource,
  type PricingTable,
  paginateByTurns,
  recoveryEvents,
  runTurn,
  type ToolRunner,
  type TurnResult,
  type VerifyState,
  verifyNudges,
  verifyState,
  withPrompt,
} from '@domi/kernel'
import {
  compactSteps,
  computeMask,
  refillData,
  registerCleanStrategy,
  registerCompactStrategy,
  registerMaskStrategy,
  SummarySchemaV2,
  summarizeInstruction,
} from '@domi/memory'
import {
  capabilitiesFor,
  createProvider,
  generateStructured,
  lostCapabilities,
  type ModelProvider,
  providerConfigOf,
  renderProviderOptions,
  StructuredOutputError,
} from '@domi/model'
import type { PromptEnv } from '@domi/prompt'
import { assemble, BUILTIN_LAYERS, layersFromConfig, mergeLayers, type PromptLayer } from '@domi/prompt'
import {
  type DomiEvent,
  type EventEnvelope,
  isKnownEvent,
  type RefLink,
  type ResultOf,
  type SubmitRef,
  type UploadRef,
} from '@domi/protocol'
import { z } from 'zod'
import { ASK_USER_CAPABILITY, makeAskUserTool } from './ask-user.ts'
import { AttachmentError, AttachmentStore, DEFAULT_ATTACHMENT_MAX_BYTES, isImage } from './attachments.ts'
import { type CheckpointController, CheckpointError, resolveSnapshots, stepStartSnapshot } from './checkpoints.ts'
import { degrade } from './degrade.ts'
import { collectEnv, envDynamicText } from './env.ts'
import {
  makePlanGate,
  makePlanUpdateTool,
  PLAN_CAPABILITY,
  type PlanPolicy,
  type PlanProgress,
  PlanTracker,
  planProgress,
  planPromptText,
} from './plan.ts'

/**
 * 在**组合根**注册确定性清理策略（PRD-M2-002）。
 * kernel 只提供注册点，永远不知道有这回事——这就是 PRD-M2-003 AC-6
 * 「切换压缩策略实现，packages/kernel diff 为 0」的兑现处。
 * 注册是幂等的，放在模块顶层是为了「配置里写了 strategy = "clean" 就直接能用」。
 */
registerCleanStrategy()
registerCompactStrategy()
// M15（取舍-2）：均衡 / 节省两档——遮蔽 + 确定性清理（只动冷区）。'balanced' 是配置默认
registerMaskStrategy()

const TitleSchema = z.object({ title: z.string() })

import { SqliteEventLog } from '@domi/store'
import { BUDGET_DECISION_SCHEMA, type BudgetLimits, makeBudgetGate } from './budget.ts'
import { memorySearchPlugin } from './builtin-plugins.ts'
import { HookRunner } from './hooks.ts'
import { type MemoryService, makeMemoryRecallTool } from './memory-service.ts'
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

/**
 * 内置放行（SPEC-M12-004 第二轮 取舍-2）：和用户说话的工具不碰外部世界，不该靠用户在配置里写 allow
 * （按需档下没规则的能力会被拒）。排在用户规则**后面**：用户对同一个能力写的精确规则（比如 deny）先匹配到
 */
export const INTRINSIC_RULES: ReadonlyArray<{ name: string; capability: string; decision: 'allow' }> = [
  { name: 'builtin.ask-user', capability: ASK_USER_CAPABILITY, decision: 'allow' },
  { name: 'builtin.plan', capability: PLAN_CAPABILITY, decision: 'allow' },
]

function planField(events: readonly EventEnvelope[]): { plan?: PlanProgress } {
  const p = planProgress(events)
  return p === null ? {} : { plan: p }
}

/** 计划闸门先于预算闸门：没计划 / 没批准的调用直接拦下（不结束这一轮），不去算用量 */
function withPlanGate(
  plan: ReturnType<typeof makePlanGate>,
  budget: NonNullable<ConstructorParameters<typeof ToolRegistry>[0]['gate']>,
): NonNullable<ConstructorParameters<typeof ToolRegistry>[0]['gate']> {
  return async (info) => {
    const reject = plan(info)
    if (reject) return { stop: false, reject, events: [] }
    return budget(info)
  }
}

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
  /** PRD-M12-002：会话确认模式 */
  permissionsMode?: 'always-ask' | 'on-demand' | 'allow-all'
  /** PRD-M12-004 AC-10：计划进度（端上「计划还剩 N 步 · 继续」）。没有计划就不带 */
  plan?: PlanProgress
  turns?: number
  steps?: number
  tokPerSec?: number | null
  cacheHitPercent?: number | null
  /** BUG-M13-002：当前占用（最近一次请求的提示词 token）与窗口；contextPercent = 两者之比 */
  contextTokens?: number
  contextMaxTokens?: number
  /** BUG-M13-005：全会话工具调用次数，与 steps 同源 */
  toolCalls?: number
  /** M15（SPEC-M15-001）：上下文尺子——缓存断裂观测与投影计数（老 daemon 不推） */
  breakCount?: number
  avoidableLoss?: number
  maskCount?: number
  compactCount?: number
  overflowCount?: number
  memorySuccessRate?: number | null
}

export interface SessionEvents {
  onEvents(envelopes: EventEnvelope[]): void
  /** 指标由 runtime 算好推过来 —— 三端共用 kernel 的同一份 aggregate（PRD-M1-007 AC-3） */
  onMetrics(metrics: MetricsSnapshot): void
  onAsk(ask: PendingAsk | null): void
  onBusy(busy: boolean): void
}

/**
 * M15（SPEC-M15-003）：会话开始定格快照。
 * 只存文本与 mtime——prompt() 在 turn 内只读这份，不碰源（INV-12(b)）
 */
interface FrozenContext {
  soul: string
  rules: string
  catalog: string
  /** 计划文本（session.plan 层）——turn 内定格；变化走 ctx.note 追加，下一 turn 生效 */
  planText: string
  cwd: string
  /** M15（SPEC-M15-010 AC-2）：环境定格快照（会话生命周期内采集一次） */
  env: PromptEnv | null
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
  /**
   * 计划必须（PRD-M12-004 AC-8）：true = 动手（只读之外的工具）前必须先用 plan.update 写计划。
   * daemon 给任务会话的顶层会话打开；子 agent、长任务节点、自由会话不强制
   */
  planRequired?: boolean
  /** 即使规则放行也要问人的能力（PRD-M8-004：自由会话里的 shell.exec）。只收紧不放松 */
  askAlways?: readonly string[]
  /** 这个会话自己的用量上限（M7-009，长任务节点用）。覆盖配置里的 budget */
  budget?: BudgetLimits
  /** 计划转长任务（plan.update 工具的选项，PRD-M12-004）。daemon 里接 TaskService；不给就不能转 */
  startTask?: (spec: unknown, cwd: string) => Promise<string>
  /** 子 agent 会话的事件往哪推（daemon 里是这个子会话的订阅者） */
  childEvents?: (sessionId: string, envs: EventEnvelope[]) => void
  /**
   * 步级快照（SPEC-M14-003，PRD-M14-003）：给上就接线——每轮第一个改文件工具前取基线、
   * 之后每次成功返回后取快照，fs.checkpoint 事件落进事件流。不给 = 没有快照（checkpoint.diff 降级）
   */
  checkpoints?: CheckpointController
  /**
   * M15（SPEC-M15-010 AC-1）：身份分段模式。不传就按会话 kind 推（task→task，其余 chat）。
   * 子 agent 必须显式传 'subagent'（createChild 里做）
   */
  mode?: 'chat' | 'task' | 'subagent' | undefined
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

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/toml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/javascript',
  tsx: 'application/javascript',
  jsx: 'application/javascript',
  py: 'text/x-python',
  go: 'text/x-go',
  rs: 'text/x-rust',
  sh: 'text/x-sh',
  tsq: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}
function mimeOf(ext: string): string {
  return MIME_BY_EXT[ext.replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream'
}

/** 压缩连续失败熔断上限（SPEC-M15-002 compactFailMax: 2）——之后不再每轮自动重试，手动仍可用 */
export const COMPACT_FAIL_MAX = 2

export class DomiSession {
  private readonly log: SqliteEventLog
  private readonly tools: ToolRegistry
  /** 压缩连续失败计数（AC-6 熔断）；成功清零 */
  private compactFailCount = 0
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
  /** M15（PRD-M15-007 AC-3）：子 agent 结论超限写文件的落盘目录（~/.domi/outputs/<会话>） */
  readonly outputDir: string
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
  /** PRD-M12-002：会话级确认模式（always-ask/on-demand/allow-all），默认 on-demand */
  private permissionsMode: PermissionsMode = 'on-demand'
  private permissionsModeLoaded = false
  /** 计划（PRD-M12-004 AC-8）。重开会话时从事件流恢复一次（loadPlan） */
  private readonly plan = new PlanTracker()
  private planLoaded = false
  private readonly planPolicy: PlanPolicy
  private titleTried = false
  /**
   * M15（SPEC-M15-006）：按厂商渲染缓存参数。
   * - anthropic：顶层 cache_control，TTL 按会话档位（task 3600 / chat 300），config.context.cacheTtlOverride 兜底
   * - openai 兼容网关（非官方端点）：prompt_cache_key = 会话 id
   * - deepseek 等自动缓存厂商：无参数（能力表已按实际修正）
   */
  private renderProviderOptions(): Record<string, unknown> | undefined {
    const vendor = VENDORS[this.currentProvider as keyof typeof VENDORS]
    if (!vendor) return undefined
    const baseUrl = this.opts.config.model.baseUrl ?? vendor.defaultBaseUrl
    return renderProviderOptions(
      // 数据驱动（SPEC-M15-006 取舍-13）：接入方式存 VENDORS 表，runtime 不硬编码厂商名
      { cacheMode: vendor.cacheMode, baseUrl, official: baseUrl === vendor.defaultBaseUrl },
      {
        sessionId: this.opts.sessionId,
        kind: this.log.sessions.get(this.opts.sessionId)?.kind ?? 'chat',
        ttlOverride: this.opts.config.context.cacheTtlOverride,
      },
    )
  }

  private currentModel: string
  private currentProvider: string
  /**
   * M15（SPEC-M15-003 · INV-12(b)）：会话开始定格快照。
   * turn（一次 submit）开始时 freeze() 一次；turn 内 soul/rules/catalog/计划/环境都不再现读，
   * 来源变化不打扰当前请求；必须送达的动态内容（计划更新）走 ctx.note 追加。
   * 显式刷新（refreshContext）落 ctx.refresh 并重定格。
   */
  private frozen: FrozenContext | null = null
  /**
   * M15（SPEC-M15-010 AC-2）：环境定格快照。会话生命周期内采集一次（首次 freeze 时惰性初始化）——
   * git 探测是子进程 IO，不该每轮 freeze 都跑
   */
  private frozenEnv: PromptEnv | null = null
  /** M15（SPEC-M15-010 AC-2）：会变一半（日期/分支/改动数）上次送达的文本，变了才追加 */
  private lastEnvNote: string | null = null

  /** 定格快照的内容 */
  private readFrozen(): FrozenContext {
    const soul = this.opts.memory?.promptText() ?? ''
    const rules = this.trusted ? rulesText(this.repoRoot, this.opts.cwd) : ''
    const catalog = this.skillSource?.catalog() ?? ''
    return {
      soul,
      rules,
      catalog,
      planText: planPromptText(this.planPolicy),
      cwd: this.opts.cwd,
      env: this.frozenEnv,
    }
  }

  private frozenSkills = 0

  /** 重定格：turn 开始 / 显式刷新时调用 */
  private freeze(): void {
    if (this.frozenEnv === null) this.frozenEnv = collectEnv(this.opts.cwd)
    this.frozen = this.readFrozen()
    this.frozenSkills = this.skillSource?.list().length ?? 0
  }

  /** 待生效计数：来源相对定格快照是否已变化（端上提示「点刷新」用）。plan 不走这里（变化即 ctx.note 追加） */
  pendingContextChanges(): { soul: boolean; rules: boolean; catalog: boolean; skills: boolean } {
    const cur = this.readFrozen()
    const f = this.frozen
    if (f === null) return { soul: false, rules: false, catalog: false, skills: false }
    return {
      soul: cur.soul !== f.soul,
      rules: cur.rules !== f.rules,
      catalog: cur.catalog !== f.catalog,
      skills: (this.skillSource?.list().length ?? 0) !== (this.frozenSkills ?? 0),
    }
  }

  /** 显式刷新（PRD-M15-003 AC-4）：落 ctx.refresh + 重定格。刷新不做预检弹窗 */
  async refreshContext(): Promise<{ ok: true }> {
    await this.log.append(this.opts.sessionId, [{ t: 'ctx.refresh', reason: 'manual' }])
    this.freeze()
    await this.pump()
    return { ok: true }
  }

  constructor(private readonly opts: SessionOptions) {
    this.log = new SqliteEventLog({ path: opts.dbPath, cwd: opts.cwd })
    this.offset = this.log.viewOffset(opts.sessionId)
    this.currentModel = opts.config.model.name
    this.currentProvider = opts.config.model.provider

    const permissions = new PermissionEngine(
      {
        rules: [...(opts.extraRules ?? []), ...opts.config.permissions.rules, ...INTRINSIC_RULES],
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.askAlways && opts.askAlways.length > 0
          ? { askAlways: (c: string) => (opts.askAlways as readonly string[]).includes(c) }
          : {}),
        cwd: opts.cwd,
        permissionsMode: () => this.permissionsMode,
      },
      (capabilityId, args, o) => this.askUser(capabilityId, args, o?.grantable === true),
    )
    this.permissions = permissions
    this.planPolicy = {
      tracker: this.plan,
      required: () => opts.planRequired === true,
      mode: () => this.permissionsMode,
    }
    const planGate = makePlanGate(this.planPolicy)
    this.outputDir = join(dirname(opts.dbPath), 'outputs', opts.sessionId)
    this.attachments = new AttachmentStore(
      dirname(opts.dbPath),
      (opts.config.attachments?.maxMB ?? DEFAULT_ATTACHMENT_MAX_BYTES / 1024 / 1024) * 1024 * 1024,
    )
    this.hooks = new HookRunner(opts.config.hooks ?? [], { sessionId: opts.sessionId, cwd: opts.cwd })
    this.jobs = new JobTable({ outputDir: this.outputDir })
    this.tools = new ToolRegistry({
      cwd: opts.cwd,
      permissions,
      elicit: (tool, req) => this.askInput(tool.capability, req),
      jobs: this.jobs,
      outputDir: this.outputDir,
      inlineMaxTokens: opts.config.context.inlineMaxTokens,
      ...(this.hooks.empty ? {} : { hooks: this.hooks.toolHooks() }),
      // 闸门：先看计划（PRD-M12-004 AC-8 / AC-9，拦下不结束这一轮），再看预算（M7-009，到顶问人）
      gate: withPlanGate(
        planGate,
        makeBudgetGate({
          base: () => ({ ...(opts.config.budget ?? {}), ...(opts.budget ?? {}) }),
          events: () => this.view(),
          pricing: opts.pricing ?? {},
          ask: async (message, detail) => {
            const r = await this.askInput(
              'budget.exceeded',
              { message, requestedSchema: BUDGET_DECISION_SCHEMA },
              detail,
            )
            if (r.action !== 'accept') return { action: 'stop' }
            const limit =
              typeof r.content?.limit === 'number' && Number.isFinite(r.content.limit) ? r.content.limit : undefined
            return r.content?.action === 'raise' && limit !== undefined
              ? { action: 'raise', limit }
              : { action: 'continue' }
          },
        }),
      ),
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
      // PRD-M12-004 AC-7：问用户（和用户说话，内置放行）
      .register(makeAskUserTool())
      // PRD-M12-004 AC-8：计划（内置放行）；审批时可转长任务（AC-5）
      .register(
        makePlanUpdateTool({
          ...this.planPolicy,
          ...(opts.startTask
            ? { startTask: (spec: unknown) => (opts.startTask as NonNullable<typeof opts.startTask>)(spec, opts.cwd) }
            : {}),
        }),
      )
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
    throw new MissingCredentialError(credentialEnvNames(this.currentProvider), this.currentProvider)
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
    // 运行时自己问的（预算到顶）与问题框（ask.user）用原名；工具要输入时显示为「同组.input」
    const capabilityId =
      detail !== undefined || capability === ASK_USER_CAPABILITY || capability === PLAN_CAPABILITY
        ? capability
        : `${capability.split('.').slice(0, -1).join('.') || capability}.input`
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

  /**
   * 把自上次以来的新事件推给订阅者：每次落盘后调，从库里读增量（库是唯一真相，内存里不另存一份）。
   * 在 domid 里订阅者就是协议推送（M3），客户端不轮询
   */
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
    await this.emitMetricsNow()
  }

  /**
   * 重新聚合全量事件流并推一次 metrics。
   * pump() 只在「有新事件」时调；readEvents（打开已有会话补历史）走 pumpAll=view() 不调 pump，
   * 必须单独推一次，否则打开旧会话时状态栏一直空（PRD-M1-007 / bug：token 与 context 百分比不显示）。
   */
  async emitMetricsNow(): Promise<void> {
    if (!this.listeners.onMetrics) return
    const all = await this.view()
    const m = aggregate(all, {
      pricing: this.opts.pricing ?? {},
      maxContextTokens: this.opts.config.context.maxTokens,
      ...(this.busy ? { now: this.now() } : {}),
    })
    this.listeners.onMetrics({
      tokens: m.tokens,
      cost: formatCost(m),
      turnMs: m.turnMs,
      contextPercent: m.contextPercent,
      contextLevel: contextLevel(m.contextPercent),
      contextTokens: m.contextTokens,
      contextMaxTokens: this.opts.config.context.maxTokens,
      toolCalls: m.toolCalls,
      unpricedModels: m.unpricedModels,
      verify: verifyState(all, { command: this.opts.config.verify?.command }),
      permissionsMode: this.permissionsMode,
      ...planField(all),
      turns: m.turns,
      steps: m.steps,
      tokPerSec: m.tokPerSec,
      cacheHitPercent: m.cacheHitPercent,
      // M15（SPEC-M15-001）：上下文尺子——缓存断裂观测与投影计数
      breakCount: m.breakCount,
      avoidableLoss: m.avoidableLoss,
      maskCount: m.maskCount,
      compactCount: m.compactCount,
      overflowCount: m.overflowCount,
      memorySuccessRate: m.memorySuccessRate,
    })
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
    // PRD-M15-002 AC-5：切到更小窗口的模型时，切换前预检——放不下就先压缩再切，并在 model.switch 旁落说明
    const toWindow = modelWindow(to, {
      contextWindow: this.opts.config.model.contextWindow,
      maxOutput: this.opts.config.model.maxOutput,
    })
    const toEffective = effectiveWindow(toWindow.contextWindow, toWindow.maxOutput)
    const all = await this.view()
    const m = aggregate(all, { pricing: this.opts.pricing ?? {} })
    if (evaluate(m.contextTokens, toEffective) !== 'ok') {
      const c = await this.compactNow('threshold')
      opts.reason = opts.reason ?? (c.ok ? '切换前已自动压缩' : '切换前压缩失败，可能放不下')
    }
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
   * PRD-M11-009：尾部窗口（首连用）。按轮 + 屏预算从尾部选一段事件。
   * 返回 EventPage：events 升序 + fromSeq/toSeq/hasOlder。
   */
  async tailWindow(maxLines: number): Promise<import('@domi/kernel').EventPage> {
    const all = await this.pumpAll()
    return paginateByTurns(all, { budget: { maxLines } })
  }

  /** PRD-M11-009：向上翻页——取 view seq < beforeSeq 的一个尾部窗口。 */
  async history(beforeSeq: number, maxLines: number): Promise<import('@domi/kernel').EventPage> {
    const all = await this.pumpAll()
    return paginateByTurns(all, { beforeSeq, budget: { maxLines } })
  }

  /**
   * 会话的**视图**：分支 = 父链到分叉点 + 自己（BUG-M3-010）。
   * 上下文、压缩、指标、标题、订阅全都看这一份；只有追加写的是自己
   */
  private view(): Promise<EventEnvelope[]> {
    return this.offset === 0 ? this.log.read(this.opts.sessionId) : this.log.readLineage(this.opts.sessionId)
  }

  /**
   * M15（SPEC-M15-001）：上一次请求的前缀指纹（跨轮断裂观测）。
   * 从事件流读最后一次 model.request 的 fingerprint 与 seq；
   * 没有（空会话 / 旧事件无指纹）就返回空对象，loop 本轮第一条请求不判断裂。
   */
  private async lastRequestFingerprint(): Promise<{
    prevFingerprint?: Fingerprint
    prevFingerprintSeq?: number
  }> {
    const events = await this.view()
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e === undefined || e.ev.t !== 'model.request') continue
      const fp = (e.ev as { fingerprint?: Fingerprint }).fingerprint
      return fp === undefined ? {} : { prevFingerprint: fp, prevFingerprintSeq: e.seq }
    }
    return {}
  }

  /**
   * LLM 压缩 v2 —— PRD-M2-003 AC-1 + PRD-M15-005（按步、增量、可轮中、保真）。
   *
   * 只追加一条 `ctx.compact`，**原始事件一条不动**（INV-12）。
   * 摘要请求 = 主会话投影后 messages + 末尾摘要指令（取舍-10，吃主前缀缓存 E7）；
   * 输入是增量（上一份摘要 + 压缩点后事件，取舍-6）。
   * 失败时什么都不做：压缩失败不该让一次正常对话看起来出错了——
   * 大不了这一轮上下文长一点。熔断 COMPACT_FAIL_MAX 后自动不再触发，手动仍可用。
   */
  async compactNow(
    trigger: 'threshold' | 'manual' = 'manual',
    focus?: string,
  ): Promise<{ ok: boolean; detail: string; freed?: number }> {
    const events = await this.view()
    try {
      const r = await compactSteps(events, {
        trigger,
        ...(focus !== undefined ? { focus } : {}),
        keepSteps: this.opts.config.context.compactKeepSteps,
        keepTokens: this.opts.config.context.compactKeepTokens,
        refill: {
          ...refillData(events),
          skills: this.loadedSkillBodies(),
        },
        summarize: async ({ focus: f, refill: rf }) => {
          // 主前缀：同一套策略链投影（遮蔽 → 压缩 → 补水 → full，SPEC-M15 3.3）
          // + prompt 层（system / 稳定 user 块）——与主会话请求同一前缀，吃主前缀缓存（E7）
          const history = buildContext(events, {
            maxTokens: this.opts.config.context.maxTokens,
            includeReasoning: this.opts.config.context.includeReasoning,
            strategy: this.opts.config.context.strategy,
          })
          const prompt = this.prompt()
          const msgs = prompt ? withPrompt(history, prompt) : history
          const instruction = summarizeInstruction({
            ...(f !== undefined ? { focus: f } : {}),
            refill: rf,
          })
          return generateStructured(
            { provider: this.provider, capabilities: this.provider.capabilities },
            SummarySchemaV2,
            {
              model: this.currentModel,
              messages: [...msgs, { role: 'user', content: instruction }],
            },
          )
        },
      })
      if (r.covered.length === 0) return { ok: false, detail: '步数还不够，没什么可压的' }
      await this.log.append(this.opts.sessionId, [r.event])
      await this.pump()
      this.compactFailCount = 0
      // PRD-M15-005 AC-5：编辑守卫失效——模型现在只见过摘要，改文件前必须重读
      this.tools.stamps.clearAll()
      return {
        ok: true,
        detail: `已压缩 seq ${r.event.fromSeq}–${r.event.toSeq}，${r.event.tokensBefore} → ${r.event.tokensAfter} tokens（保留最近 ${r.event.keptTurns} 步）`,
        freed: Math.max(0, r.event.tokensBefore - r.event.tokensAfter),
      }
    } catch (e) {
      // 失败也要留痕，而且走**事件流**而不是侧信道：
      // 只在 UI 里闪一下的状态，事后排查时等于没发生过
      const message = `上下文压缩失败，这一轮照常继续：${e instanceof Error ? e.message : String(e)}`
      await this.log.append(this.opts.sessionId, [{ t: 'error', scope: 'compact', message, recoverable: true }])
      await this.pump()
      // AC-6 熔断：连续失败计数，成功清零
      this.compactFailCount += 1
      return { ok: false, detail: message }
    }
  }

  /** 补水用的已加载技能正文（取舍-9：skill.load 的技能正文） */
  private loadedSkillBodies(): Array<{ name: string; text: string }> {
    const out: Array<{ name: string; text: string }> = []
    for (const s of this.skillSource?.list() ?? []) {
      const body = this.skillSource?.get(s.name)
      if (body !== undefined) out.push({ name: s.name, text: body.prompt })
    }
    return out
  }

  /**
   * 钉住 / 解钉某条事件（PRD-M15-004 AC-5，SPEC-M15-004 取舍-19）。
   * 被钉住的 seq：遮蔽与压缩均跳过；解钉恢复。钉 / 解钉均落 ctx.pin 事件。
   */
  async pin(seq: number, pinned: boolean): Promise<{ ok: boolean }> {
    const events = await this.view()
    if (!events.some((e) => e.seq === seq)) return { ok: false }
    await this.log.append(this.opts.sessionId, [{ t: 'ctx.pin', seq, pinned }])
    await this.pump()
    return { ok: true }
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
      mode: 'subagent',
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

  /** 计划从事件流恢复（PRD-M12-004 AC-8）。只做一次；之后由 plan.update 工具与 submit 维护 */
  private async loadPlan(): Promise<void> {
    if (this.planLoaded) return
    this.planLoaded = true
    this.plan.restore(await this.view())
  }

  /** 当前计划（client 续跑条之外的地方要看，比如测试与桥接） */
  planSnapshot(): { steps: PlanTracker['steps']; remaining: number; approved: boolean } {
    return { steps: this.plan.steps, remaining: this.plan.remaining, approved: this.plan.approved() }
  }

  /** 事件流里最后一条 permissions.mode.switch 恢复确认模式（M12-002） */
  private async loadMode(): Promise<void> {
    if (this.permissionsModeLoaded) return
    this.permissionsModeLoaded = true
    const view = await this.view()
    for (let i = view.length - 1; i >= 0; i--) {
      const ev = (view[i] as EventEnvelope).ev as { t: string; mode?: PermissionsMode }
      if (ev.t === 'permissions.mode.switch' && ev.mode) {
        this.permissionsMode = ev.mode
        break
      }
    }
  }

  /** PRD-M12-002：切会话确认模式（写事件流，重开恢复） */
  async setPermissionsMode(mode: PermissionsMode): Promise<{ mode: PermissionsMode; changed: boolean }> {
    await this.loadMode()
    if (this.permissionsMode === mode) return { mode, changed: false }
    this.permissionsMode = mode
    await this.log.append(this.opts.sessionId, [{ t: 'permissions.mode.switch', mode }])
    await this.pump()
    return { mode, changed: true }
  }

  getPermissionsMode(): PermissionsMode {
    return this.permissionsMode
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

  /**
   * 请求前预检（PRD-M15-002 AC-3 · SPEC-M15-002 取舍-17）：按窗口预算器走降级链。
   * 占用 = 最近真实 usage 基准（aggregate.contextTokens）+ 本步增量估算（system / 工具定义）；
   * 档位 → 遮蔽（确定性清理，005 精化为热区遮蔽）→ 压缩（可轮中）→ 硬顶停 + error{scope:'context'}。
   * 熔断（AC-6）：压缩连续失败 ≥ COMPACT_FAIL_MAX 后不再自动触发，手动 /compact 仍可用。
   */
  private async preflight(): Promise<{ stop: boolean }> {
    if (this.compactFailCount >= COMPACT_FAIL_MAX) return { stop: false }
    const events = await this.view()
    const m = aggregate(events, { pricing: this.opts.pricing ?? {} })
    const sys = this.prompt()
    const increment = estimateIncrement(sys.system, this.tools.schemas(), [])
    const w = modelWindow(this.currentModel, {
      contextWindow: this.opts.config.model.contextWindow,
      maxOutput: this.opts.config.model.maxOutput,
    })
    const effective = effectiveWindow(w.contextWindow, w.maxOutput)
    const r = await degrade(m.contextTokens + increment, effective, {
      mask: async () => {
        // M15（PRD-M15-004）：冷区一次决定、热区不动；被钉住的 seq 跳过；已遮蔽的不再变
        const d = computeMask(events)
        if (d.seqs.length === 0) return { freed: 0 }
        return {
          freed: d.freedTokens,
          ev: { t: 'ctx.mask', seqs: d.seqs, reason: d.reason, freedTokens: d.freedTokens },
        }
      },
      compact: async () => {
        const r = await this.compactNow('threshold')
        return { ok: r.ok, freed: r.freed ?? 0 }
      },
    })
    if (r.events.length > 0) {
      await this.log.append(this.opts.sessionId, r.events)
      await this.pump()
    }
    return { stop: r.action === 'stop' }
  }

  /**
   * 校验并规整跨会话引用（PRD-M3-005）：会话要存在、起点要在它的范围内；
   * 终点超出就截到末尾——「引用这一轮」时客户端不知道这一轮最后一条的 seq。
   * 规整后的区间就是落进事件的链接，之后不会再变
   */
  async checkRefs(refs: readonly SubmitRef[]): Promise<SubmitRef[]> {
    const out: SubmitRef[] = []
    for (const r of refs) {
      if (!('kind' in r)) {
        // RefLink：校验会话存在与区间（PRD-M3-005）
        if (!this.log.sessions.get(r.sessionId)) throw new RefError('error.ref.noSession', { sessionId: r.sessionId })
        const head = this.log.viewOffset(r.sessionId) + (await this.log.head(r.sessionId))
        if (r.fromSeq < 1 || r.fromSeq > head) {
          throw new RefError('error.ref.outOfRange', { sessionId: r.sessionId, head, fromSeq: r.fromSeq })
        }
        if (r.toSeq < r.fromSeq) throw new RefError('error.ref.reversed', { fromSeq: r.fromSeq, toSeq: r.toSeq })
        out.push({ sessionId: r.sessionId, fromSeq: r.fromSeq, toSeq: Math.min(r.toSeq, head) })
        continue
      }
      // M14-008：文件行引用只校验形状（schema 已 refine lineEnd≥lineStart）；路径是模型要看的线索，不落文件系统
      out.push(r)
    }
    return out
  }

  /**
   * 这一轮发给模型的提示词（BUG-M3-015 / BUG-M3-012）：内置层 + 配置里的层，同 id 覆盖。
   * 每轮现拼（便宜），换了模型也跟着变；cache 边界不合法时 assemble 当场抛错
   */
  /**
   * session.artifact RPC（PRD-M14-007 AC-3，SPEC-M14-007 取舍-2）：产物 tab 预览的文件内容。
   * 只读会话 cwd 内的文件（resolve 后必须落在 cwd 内，防路径穿越）；文本 ≤ 512KB / 二进制 ≤ 4MB，
   * 超出标 truncated 不给内容（端上走打开方式）
   */
  async artifact(path: string): Promise<ResultOf<'session.artifact'>> {
    const { extname, isAbsolute, relative, resolve } = await import('node:path')
    const { readFileSync, statSync } = await import('node:fs')
    const cwd = this.opts.cwd
    const abs = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
    const rel = relative(cwd, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new CheckpointError('error.artifact.out_of_workspace')
    const st = statSync(abs)
    if (!st.isFile()) throw new CheckpointError('error.artifact.not_file')
    const mime = mimeOf(extname(abs))
    const size = st.size
    if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml' ||
      mime === 'application/javascript'
    ) {
      const MAX = 512 * 1024
      const truncated = size > MAX
      const buf = readFileSync(abs)
      const text = truncated ? buf.subarray(0, MAX).toString('utf8') : buf.toString('utf8')
      return { ok: true, mime, size, ...(text === undefined ? {} : { text }), truncated }
    }
    if (mime.startsWith('image/') || mime === 'application/pdf') {
      const MAX = 4 * 1024 * 1024
      const truncated = size > MAX
      const buf = readFileSync(abs)
      const base64 = truncated ? undefined : buf.toString('base64')
      return { ok: true, mime, size, ...(base64 === undefined ? {} : { base64 }), truncated }
    }
    return { ok: true, mime, size, truncated: size > 0 && size > 4 * 1024 * 1024 }
  }

  /**
   * session.context RPC（PRD-M14-006 AC-5，SPEC-M14-006 取舍-3）：上下文 tab 的静态项。
   * 动态项（skill.load 过的 / ctx.ref / 附件 / 读过的）在事件流里，client-core 投影
   */
  context(): ResultOf<'session.context'> {
    const cfg = this.opts.config.context
    const toolNames = this.tools.schemas().map((t) => t.name)
    const byServer = new Map<string, string[]>()
    for (const name of toolNames) {
      if (!name.startsWith('mcp.')) continue
      const dot = name.indexOf('.', 4)
      const server = dot < 0 ? name.slice(4) : name.slice(4, dot)
      const arr = byServer.get(server)
      if (arr === undefined) byServer.set(server, [name])
      else arr.push(name)
    }
    const mcp = [...byServer.entries()]
      .map(([server, tools]) => ({ server, tools }))
      .sort((a, b) => a.server.localeCompare(b.server))
    return {
      trusted: this.trusted,
      // 未信任 → 空表，端上显示「未信任，未加载」
      rules: this.trusted ? rulesFiles(this.repoRoot, this.opts.cwd).map((f) => f.slice(this.repoRoot.length + 1)) : [],
      skillsTotal: this.opts.skills?.list().length ?? 0,
      mcp,
      context: {
        strategy: cfg.strategy,
        // M15（取舍-16）：预算器第一档（遮蔽阈值）随策略档位走：均衡 60% / 节省 45%。
        // 压缩阈值不单列——守卫 / 状态栏 / 上下文 tab 全读预算器，端上提示「达到遮蔽阈值」即可
        thresholdPercent: cfg.strategy === 'economical' ? 45 : 60,
      },
      // M15（SPEC-M15-003）：相对定格快照的待生效变化（端上提示「点刷新」）
      pending: this.pendingContextChanges(),
    }
  }

  /** M15（SPEC-M15-010 AC-1）：身份分段模式——显式给的就用，否则按会话 kind 推 */
  private promptMode(): 'chat' | 'task' | 'subagent' {
    if (this.opts.mode !== undefined) return this.opts.mode
    return this.log.sessions.get(this.opts.sessionId)?.kind === 'task' ? 'task' : 'chat'
  }

  private prompt(): PromptParts {
    // M15（SPEC-M15-003 · INV-12(b)）：定格快照。turn 内 soul/rules/catalog/计划/环境只读这份——
    // 来源变化不打扰当前请求（下一 turn 或显式刷新才生效）
    const f = this.frozen ?? this.readFrozen()
    const extra: PromptLayer[] = []
    // Soul 很少变，放稳定前缀里（ADR-019）；空的时候不放，免得多一段没内容的说明
    if (f.soul !== '')
      extra.push({ id: 'builtin.soul', role: 'system', priority: 400, cacheable: true, render: () => f.soul })
    // 仓库自带的规矩（M7-002）：信任之后才放。**turn 内定格**，来源变化待生效（pendingContextChanges）
    if (f.rules !== '') {
      extra.push(projectRulesLayer(f.rules))
    }
    if (f.catalog !== '') {
      extra.push({ id: 'builtin.skills', role: 'system', priority: 450, cacheable: true, render: () => f.catalog })
    }
    // 计划常驻上下文（PRD-M12-004 AC-8）：**turn 内定格**。计划变化不重写本 turn 已发出的层——
    // 检测到变化时落 notes（追加送达，ctx.note 事件由 loop 落盘），下一 turn 生效
    const notes: PromptParts['notes'] = []
    if (f.planText !== '') {
      extra.push({ id: 'session.plan', role: 'user', priority: 900, cacheable: false, render: () => f.planText })
    }
    // 计划提示（无计划时是「先写计划」，有计划时是推进指引）。它不在定格快照里：
    // 与快照计划文本不一致（含「还没有计划」的状态）时走 notes 追加送达（SPEC-M15-003），当轮模型即见
    const live = planPromptText(this.planPolicy)
    if (live !== '' && live !== f.planText) {
      notes.push({ reason: 'plan', text: live })
    }
    // 环境会变一半（日期/git 分支/改动文件数）：变了才追加（SPEC-M15-010 AC-2）
    const envText = envDynamicText(this.opts.cwd)
    if (envText !== this.lastEnvNote) {
      this.lastEnvNote = envText
      notes.push({ reason: 'env', text: envText })
    }
    const layers = mergeLayers([...BUILTIN_LAYERS, ...extra], layersFromConfig(this.opts.config.prompt.layers))
    const a = assemble(layers, {
      cwd: f.cwd,
      model: this.currentModel,
      mode: this.promptMode(),
      env: f.env ?? undefined,
    })
    const text = (role: 'system' | 'user'): string =>
      a.messages
        .filter((m) => m.role === role)
        .map((m) => (m as { content: string }).content)
        .join('\n\n')
    const userText = text('user')
    return {
      system: text('system'),
      // M15：user 段不再是「动态尾巴」——withPrompt 不再把它拼进最后一条 user（前缀稳定）
      dynamic: '',
      // M15：user 层的稳定内容（工作区等 cacheable:false 但会话内不变的层）固定插入，不污染 system 前缀
      ...(userText !== '' ? { user: userText } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      // M14（SPEC-M14-006 取舍-1）：层清单（id / role / cacheable / 字符估算）随请求落盘，供上下文 tab 分段
      layers: a.layers.map((l) => ({ id: l.id, role: l.role, cacheable: l.cacheable, approxTokens: l.approxTokens })),
      // M15（SPEC-M15-001）：层渲染文本哈希，只用于前缀指纹，不进 ctx.layers / 不落盘
      layerHashes: a.layerFingerprints,
    }
  }

  /**
   * 完成前验证（PRD-M7-004 AC-2）：这一轮改了文件、之后没有成功的验证，模型却要结束——追加一条提示再来一轮。
   * 到上限就如实结束，最后一条提示标 final
   */
  private async verifyGate(events: readonly EventEnvelope[]): Promise<{ again: boolean; events: DomiEvent[] }> {
    const v = this.opts.config.verify
    if (!v?.enabled) return { again: false, events: [] }
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

  // ── 步级快照（SPEC-M14-003 · PRD-M14-003）─────────────────────────────

  /** 包一层 ToolRunner：快照的 before / after 事件并入 outcome.events（顺序：基线 → 原有 → 快照） */
  private wrapCheckpointTools(tools: ToolRunner): ToolRunner {
    const c = this.opts.checkpoints
    if (!c) return tools
    return {
      schemas: () => tools.schemas(),
      run: async (call, signal) => {
        const before = await c.beforeTool(call)
        const outcome = await tools.run(call, signal)
        const after = await c.afterTool(call, outcome.ok)
        if (before.length > 0 || after.length > 0) {
          outcome.events = [...before, ...(outcome.events ?? []), ...after]
        }
        return outcome
      },
    }
  }

  /**
   * checkpoint.diff（PRD-M14-003 AC-3）：事件区间 → 快照之间的文件改动。
   * diff 在 daemon 算；快照选择走 resolveSnapshots 的区间规则（SPEC 取舍-6）
   */
  async checkpointDiff(
    fromSeq?: number,
    toSeq?: number,
    path?: string,
  ): Promise<{ available: boolean; reason?: string; files: FileChange[] }> {
    const c = this.opts.checkpoints
    if (!c) return { available: false, reason: '这个会话没有接步级快照', files: [] }
    const events = await this.view()
    const range = resolveSnapshots(events, fromSeq ?? 1, toSeq ?? events.length)
    if (range === null) {
      return { available: false, reason: '该范围没有可用的快照（git 可能没装，或这一段没触发过快照）', files: [] }
    }
    return { available: true, files: await c.repo.diffFiles(range.from, range.to, path) }
  }

  /**
   * checkpoint.discard（PRD-M14-005 AC-7，非隔离会话）：把文件恢复到所选范围起点的快照内容。
   * 丢弃前自动打快照（可撤销），落 fs.discard 事件（INV-03）。隔离任务请走 worktree.discard
   */
  /**
   * 回到这一步之前（PRD-M14-010 / SPEC-M14-010 取舍-2）：toSeq 是对话截止的视图 seq，
   * files / both 先把文件恢复到该时点快照（restore 内部先打 undo 快照，可回滚），
   * conversation 只追加 revert 事件（INV-01 / INV-12：不删事件，声明作废区间）。
   * busy 守卫在 daemon core（INV-03）。
   */
  async revertTo(
    toSeq: number,
    scope: 'files' | 'conversation' | 'both',
  ): Promise<{ snapshotId: string | null; undoSnapshotId: string | null }> {
    const c = this.opts.checkpoints
    let snapshotId: string | null = null
    let undoSnapshotId: string | null = null
    if (scope !== 'conversation') {
      if (!c) throw new CheckpointError('error.checkpoint.not_wired')
      const events = await this.view()
      // 目标快照 = 该步起点的 from 快照（SPEC-M14-010 取舍-1：步起点状态 = 该轮第一个 checkpoint）
      const start = stepStartSnapshot(events, toSeq)
      if (start === null) throw new CheckpointError('error.checkpoint.no_snapshots')
      snapshotId = start
      const undo = await c.repo.restore(start)
      undoSnapshotId = undo.undoSnapshotId
    }
    await this.appendEvents([{ t: 'revert', toSeq, scope, snapshotId, undoSnapshotId }])
    return { snapshotId, undoSnapshotId }
  }

  async checkpointDiscard(path: string, fromSeq: number, toSeq: number): Promise<{ eventSeq: number }> {
    const c = this.opts.checkpoints
    if (!c) throw new CheckpointError('error.checkpoint.not_wired')
    const events = await this.view()
    const range = resolveSnapshots(events, fromSeq, toSeq)
    if (range === null) throw new CheckpointError('error.checkpoint.no_snapshots')
    const undo = await c.repo.snapshot('丢弃前的自动快照')
    await c.repo.restorePath(range.from, path)
    const { to } = await this.log.append(this.opts.sessionId, [
      { t: 'fs.discard', path, rangeStart: range.from, undoSnapshotId: undo.id },
    ])
    await this.pump()
    return { eventSeq: to + this.offset }
  }

  /** checkpoint.discard.undo：按 fs.discard 事件的 undoSnapshotId 恢复该文件 */
  async checkpointDiscardUndo(eventSeq: number): Promise<{ path: string }> {
    const c = this.opts.checkpoints
    if (!c) throw new CheckpointError('error.checkpoint.not_wired')
    const events = await this.view()
    const found = events.find((e) => e.seq === eventSeq)
    if (!found) throw new CheckpointError('error.checkpoint.discard_not_found')
    const ev = found.ev
    if (!isKnownEvent(ev) || ev.t !== 'fs.discard') throw new CheckpointError('error.checkpoint.discard_not_found')
    await c.repo.restorePath(ev.undoSnapshotId, ev.path)
    return { path: ev.path }
  }

  async submit(
    text: string,
    opts: {
      refs?: readonly SubmitRef[]
      /** 运行中补充的队列（PRD-M13-001）：daemon 持有，loop 在安全点来取 */
      notes?: NoteSource
      /** 中断信号（PRD-M13-002）：reason = { by: 端名 } */
      signal?: AbortSignal
      /** 这句话由哪些补充拼成（SPEC-M13-001 取舍-4） */
      noteIds?: readonly string[]
    } & SubmitInputs = {},
  ): Promise<TurnResult> {
    this.checkCredential()
    const inputs = this.checkInputs(opts)
    this.busy = true
    this.listeners.onBusy?.(true)
    // 步级快照（SPEC-M14-003）：每一轮（user.input）重置基线标记与降级闩
    this.opts.checkpoints?.resetTurn()
    for (const t of this.opts.extraTools?.(this.opts.cwd) ?? []) this.tools.register(t)
    await this.deliverNotices()
    await this.loadMode()
    // 计划（PRD-M12-004 AC-8 / AC-9）：先从事件流恢复（不含这一句），再记下这一句有没有「先别动」
    await this.loadPlan()
    this.plan.onUserInput(text)
    await this.ensureTrust()
    // M15（SPEC-M15-003 · INV-12(b)）：会话（turn）开始定格——soul/rules/catalog/计划/环境
    this.freeze()
    const pre = await this.preflight()
    if (pre.stop) {
      // AC-3：仍超硬顶 → 本轮停。error{scope:'context'} 已在 preflight 落盘
      return { stopReason: 'context', counters: { toolCalls: 0, argParseRetries: 0, elapsedMs: 0 } }
    }
    const policy: ContextPolicy = {
      maxTokens: this.opts.config.context.maxTokens,
      includeReasoning: this.opts.config.context.includeReasoning,
      strategy: this.opts.config.context.strategy,
    }
    // M15（SPEC-M15-006）：按厂商渲染缓存参数（anthropic cache_control TTL / openai 网关 prompt_cache_key）
    const providerOptions = this.renderProviderOptions()
    const timer = setInterval(() => {
      void this.pump()
    }, 30)
    // M15（SPEC-M15-001）：上一次请求的指纹在进 loop 前先读好（deps 构造是同步的）
    const prevFingerprint = await this.lastRequestFingerprint()
    try {
      const result = await runTurn(
        {
          sink: this.sink,
          provider: this.provider,
          tools: this.opts.checkpoints ? this.wrapCheckpointTools(this.tools) : this.tools,
          clock: this.opts.clock ?? { now: () => Date.now() },
          policy,
          model: this.currentModel,
          // M15（SPEC-M15-002 AC-4）：模型窗口给 loop 做 buildContext 硬顶兜底
          window: modelWindow(this.currentModel, {
            contextWindow: this.opts.config.model.contextWindow,
            maxOutput: this.opts.config.model.maxOutput,
          }),
          // 运行时护栏（PRD-M10-003 AC-3）：kernel 不读配置，只收 LoopLimits；缺省与 DEFAULT_LIMITS 一致
          limits: {
            maxToolCalls: this.opts.config.loop.maxToolCalls,
            maxArgParseRetries: this.opts.config.loop.maxArgParseRetries,
            maxWallClockMs: this.opts.config.loop.maxWallClockMs,
          },
          refs: { resolve: (ref) => this.readRef(ref) },
          inputs: {
            upload: async (ref) =>
              this.attachments.load(this.opts.sessionId, ref, { vision: this.provider.capabilities.vision }),
            skill: async (name) => this.skillSource?.get(name)?.prompt,
          },
          // 每次请求模型前现拼：一轮里计划更新了，下一次请求就带上（PRD-M12-004 AC-8）
          prompt: () => this.prompt(),
          // M15（SPEC-M15-006 AC-1/AC-2）：厂商缓存参数由 runtime 按会话档位算好，loop 原样透传
          ...(providerOptions ? { providerOptions } : {}),
          // M15（SPEC-M15-001）：上一次请求的前缀指纹——跨轮缓存断裂观测
          ...prevFingerprint,
          beforeComplete: (events) => this.verifyGate(events),
          ...(opts.notes === undefined ? {} : { notes: opts.notes }),
        },
        this.opts.sessionId,
        {
          text,
          ...(opts.refs && opts.refs.length > 0 ? { refs: opts.refs } : {}),
          ...inputs,
          ...(opts.noteIds && opts.noteIds.length > 0 ? { noteIds: opts.noteIds } : {}),
        },
        opts.signal,
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
