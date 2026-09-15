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
import { fsRead, fsWrite, PermissionEngine, shellExec, type Tool, ToolRegistry } from '@domi/capability'
import type { DomiConfig } from '@domi/config'
import {
  aggregate,
  type ContextPolicy,
  contextLevel,
  formatCost,
  type PricingTable,
  runTurn,
  type TurnResult,
} from '@domi/kernel'
import {
  compact,
  makeMemorySearchTool,
  registerCleanStrategy,
  registerCompactStrategy,
  SummarySchema,
  shouldCompact,
} from '@domi/memory'
import {
  capabilitiesFor,
  createProvider,
  generateStructured,
  lostCapabilities,
  type ModelProvider,
  StructuredOutputError,
} from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
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

/** 一次权限询问。TUI 渲染它，用户回答后 resolve */
export interface PendingAsk {
  capabilityId: string
  args: unknown
  answer(allowed: boolean): void
}

export interface MetricsSnapshot {
  tokens: { input: number; output: number; cacheRead: number }
  cost: string
  contextPercent: number
  contextLevel: 'ok' | 'warn' | 'danger'
  unpricedModels: string[]
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
  extraTools?: () => readonly Tool[]
  /** 进程级的提示（比如某个 MCP server 连不上）。每条只在本会话落一次 error 事件 */
  notices?: () => readonly string[]
}

export class DomiSession {
  private readonly log: SqliteEventLog
  private readonly tools: ToolRegistry
  private provider: ModelProvider
  /** 注入的替身不随切换重建——测试要的就是同一个实例 */
  private readonly injectedProvider: boolean
  private readonly listeners: Partial<SessionEvents> = {}
  private lastSeq = 0
  private noticesDelivered = 0
  private currentModel: string
  private currentProvider: string

  constructor(private readonly opts: SessionOptions) {
    this.log = new SqliteEventLog({ path: opts.dbPath, cwd: opts.cwd })
    this.currentModel = opts.config.model.name
    this.currentProvider = opts.config.model.provider

    const permissions = new PermissionEngine({ rules: opts.config.permissions.rules }, (capabilityId, args) =>
      this.askUser(capabilityId, args),
    )
    this.tools = new ToolRegistry({ cwd: opts.cwd, permissions })
      .register(fsRead)
      .register(fsWrite)
      .register(shellExec)
      // PRD-M2-004 AC-2：检索是工具，由模型决定何时调用
      .register(makeMemorySearchTool(this.log.search))

    // M1-001：provider 由工厂按配置建。kernel 与本文件都不知道「有哪些 provider」，
    // 那份知识只在 packages/model/src/factory.ts 里（AC-4 的 diff 为 0 靠这个成立）
    this.injectedProvider = opts.provider !== undefined
    this.provider = opts.provider ?? this.buildProvider(opts.config.model.provider, opts.config.model.name)
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

  private askUser(capabilityId: string, args: unknown): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const ask: PendingAsk = {
        capabilityId,
        args,
        answer: (allowed) => {
          this.listeners.onAsk?.(null)
          resolve(allowed)
        },
      }
      if (!this.listeners.onAsk) {
        // 没有人能回答（非交互环境）→ 拒绝。与 PermissionEngine 的兜底同一个立场
        resolve(false)
        return
      }
      this.listeners.onAsk(ask)
    })
  }

  /** 把自上次以来的新事件推给订阅者。轮询而非推送是 M0 的简化，M3 换成协议推送 */
  async pump(): Promise<void> {
    const fresh = await this.log.read(this.opts.sessionId, { fromSeq: this.lastSeq + 1 })
    if (fresh.length === 0) return
    this.lastSeq = fresh[fresh.length - 1]!.seq
    this.listeners.onEvents?.(fresh)

    if (this.listeners.onMetrics) {
      const all = await this.log.read(this.opts.sessionId)
      const m = aggregate(all, {
        pricing: this.opts.pricing ?? {},
        maxContextTokens: this.opts.config.context.maxTokens,
      })
      this.listeners.onMetrics({
        tokens: m.tokens,
        cost: formatCost(m),
        contextPercent: m.contextPercent,
        contextLevel: contextLevel(m.contextPercent),
        unpricedModels: m.unpricedModels,
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
    const events = await this.log.read(this.opts.sessionId)
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
    return this.log.read(this.opts.sessionId)
  }

  /**
   * LLM 压缩 —— PRD-M2-003 AC-1。
   *
   * 只追加一条 `ctx.compact`，**原始事件一条不动**（INV-12）。
   * 失败时什么都不做：压缩失败不该让一次正常对话看起来出错了——
   * 大不了这一轮上下文长一点。这和标题生成是同一条降级原则。
   */
  async compactNow(trigger: 'threshold' | 'manual' = 'manual'): Promise<{ ok: boolean; detail: string }> {
    const events = await this.log.read(this.opts.sessionId)
    try {
      const r = await compact(events, {
        trigger,
        summarize: async ({ text }) =>
          generateStructured({ provider: this.provider, capabilities: this.provider.capabilities }, SummarySchema, {
            model: this.currentModel,
            messages: [
              {
                role: 'user',
                content: '把下面这段对话历史压成结构化摘要。只保留后面还用得上的信息，' + '不要复述每一步。\n\n' + text,
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

  /** 到窗口 70% 就自动压一次（AC-1）。只在 strategy = 'compact' 时生效 */
  private async maybeAutoCompact(): Promise<void> {
    if (this.opts.config.context.strategy !== 'compact') return
    const events = await this.log.read(this.opts.sessionId)
    const used = aggregate(events, { maxContextTokens: this.opts.config.context.maxTokens }).tokens
    const total = used.input + used.output
    if (!shouldCompact(total, this.opts.config.context.maxTokens)) return
    await this.compactNow('threshold')
  }

  async submit(text: string): Promise<TurnResult> {
    this.listeners.onBusy?.(true)
    for (const t of this.opts.extraTools?.() ?? []) this.tools.register(t)
    await this.deliverNotices()
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
      return await runTurn(
        {
          sink: this.log,
          provider: this.provider,
          tools: this.tools,
          clock: this.opts.clock ?? { now: () => Date.now() },
          policy,
          model: this.currentModel,
        },
        this.opts.sessionId,
        text,
      )
    } finally {
      clearInterval(timer)
      await this.pump()
      this.listeners.onBusy?.(false)
    }
  }

  /**
   * 退出前把事件刷干净（PRD-M0-005 AC-3）。
   * SQLite 的写在事务提交时就落盘了，这里做的是**关闭连接**让 WAL 正确收尾——
   * 不关的话 kill 掉进程，最后一轮虽然在 WAL 里，但下次打开要走恢复流程。
   */
  async flushAndClose(): Promise<void> {
    await this.pump()
    this.log.close()
  }
}
