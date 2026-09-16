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

import { dirname, join } from 'node:path'
import {
  fsEdit,
  fsGlob,
  fsGrep,
  fsRead,
  fsWrite,
  JobTable,
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
import type { DomiConfig } from '@domi/config'
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
  StructuredOutputError,
} from '@domi/model'
import { assemble, BUILTIN_LAYERS, layersFromConfig, mergeLayers, type PromptLayer } from '@domi/prompt'
import type { DomiEvent, EventEnvelope, RefLink } from '@domi/protocol'
import { z } from 'zod'

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
import { memorySearchPlugin } from './builtin-plugins.ts'
import { HookRunner } from './hooks.ts'
import { type MemoryService, makeMemoryRecallTool } from './memory-service.ts'
import { makePlanSubmitTool } from './plan.ts'
import { findRepoRoot, hasProjectContent, projectSkillsDir, rulesFiles, rulesText, TrustStore } from './project.ts'
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
export class RefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefError'
  }
}

export interface PendingAsk {
  capabilityId: string
  args: unknown
  form?: { message: string; schema: unknown }
  /** channel：用户在哪个端上回答的（tui / web / telegram），进 permission 事件（M5-007） */
  answer(allowed: boolean, content?: Record<string, unknown>, channel?: string): void
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
  /** 计划批准后转长任务（M7-005）。daemon 里接 TaskService；不给就不能转 */
  startTask?: (spec: unknown, cwd: string) => Promise<string>
  /** 子 agent 会话的事件往哪推（daemon 里是这个子会话的订阅者） */
  childEvents?: (sessionId: string, envs: EventEnvelope[]) => void
}

export class DomiSession {
  private readonly log: SqliteEventLog
  private readonly tools: ToolRegistry
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
        rules: opts.config.permissions.rules,
        ...(opts.scope ? { scope: opts.scope } : {}),
        mode: () => this.mode,
      },
      (capabilityId, args) => this.askUser(capabilityId, args),
    )
    const outputDir = join(dirname(opts.dbPath), 'outputs', opts.sessionId)
    this.hooks = new HookRunner(opts.config.hooks ?? [], { sessionId: opts.sessionId, cwd: opts.cwd })
    this.jobs = new JobTable({ outputDir })
    this.tools = new ToolRegistry({
      cwd: opts.cwd,
      permissions,
      elicit: (tool, req) => this.askInput(tool.capability, req),
      jobs: this.jobs,
      outputDir,
      ...(this.hooks.empty ? {} : { hooks: this.hooks.toolHooks() }),
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
    const m = this.opts.config.model
    return createProvider({
      provider,
      name,
      apiKey: m.apiKey,
      baseUrl: m.baseUrl,
      // 能力覆盖是为配置里那个 provider 写的，换了 provider 就不再适用
      capabilities: provider === m.provider ? m.capabilities : undefined,
    })
  }

  /** 当前在用的 provider 与模型（会话中途可能被 switchModel 换掉） */
  modelInfo(): { provider: string; model: string } {
    return { provider: this.currentProvider, model: this.currentModel }
  }

  on<K extends keyof SessionEvents>(k: K, fn: SessionEvents[K]): this {
    this.listeners[k] = fn
    return this
  }

  private askUser(capabilityId: string, args: unknown): Promise<{ allowed: boolean; channel?: string }> {
    return new Promise((resolve) => {
      const ask: PendingAsk = {
        capabilityId,
        args,
        answer: (allowed, _content, channel) => {
          this.listeners.onAsk?.(null)
          resolve({ allowed, ...(channel === undefined ? {} : { channel }) })
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
  ): Promise<{ action: 'accept' | 'decline'; content?: Record<string, unknown> }> {
    const capabilityId = `${capability.split('.').slice(0, -1).join('.') || capability}.input`
    return new Promise((resolve) => {
      if (!this.listeners.onAsk) {
        resolve({ action: 'decline' })
        return
      }
      this.listeners.onAsk({
        capabilityId,
        args: { message: req.message },
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
    // 跨 provider 时沿用同一套 key / base_url——配置里只有一套凭据（多凭据见缺陷登记）
    if (!this.injectedProvider) this.provider = this.buildProvider(toProvider, to)
    await this.log.append(this.opts.sessionId, [
      {
        t: 'model.switch',
        from,
        to,
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
    const before = capabilitiesFor({ provider: this.currentProvider, name: this.currentModel })
    const after = capabilitiesFor({ provider: toProvider ?? this.currentProvider, name: to })
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
    this.log.sessions.upsert({ id: c.sessionId, cwd: o.cwd, title: c.title, spawnedBy: o.sessionId })
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
      answer: (allowed, content, channel) => {
        this.listeners.onAsk?.(null)
        ask.answer(allowed, content, channel)
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
      const ev = (view[i] as EventEnvelope).ev as { t: string; to?: 'plan' | 'act' }
      if (ev.t === 'mode.switch' && ev.to) {
        this.applyMode(ev.to)
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
    await this.log.append(this.opts.sessionId, [{ t: 'mode.switch', to, ...(reason === undefined ? {} : { reason }) }])
    await this.pump()
    return { mode: to, changed: true }
  }

  getMode(): 'plan' | 'act' {
    return this.mode
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
    const fix = recoveryEvents(await this.view())
    if (fix.length === 0) return 0
    await this.log.append(this.opts.sessionId, fix)
    await this.pump()
    return fix.length
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
    if (!shouldCompact(total, this.opts.config.context.maxTokens)) return
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
      if (!this.log.sessions.get(r.sessionId)) throw new RefError(`引用的会话不存在：${r.sessionId}`)
      const head = this.log.viewOffset(r.sessionId) + (await this.log.head(r.sessionId))
      if (r.fromSeq < 1 || r.fromSeq > head) {
        throw new RefError(`引用越界：会话 ${r.sessionId} 只有 ${head} 条，没有第 ${r.fromSeq} 条`)
      }
      if (r.toSeq < r.fromSeq) throw new RefError(`引用的区间反了：${r.fromSeq}–${r.toSeq}`)
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
      extra.push({ id: 'project.rules', role: 'system', priority: 320, cacheable: true, render: () => rules })
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
  async submit(text: string, opts: { refs?: readonly RefLink[] } = {}): Promise<TurnResult> {
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
          prompt: this.prompt(),
          beforeComplete: (events) => this.verifyGate(events),
        },
        this.opts.sessionId,
        opts.refs && opts.refs.length > 0 ? { text, refs: opts.refs } : text,
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
    await this.pump()
    this.log.close()
  }
}
