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
import { fsRead, fsWrite, PermissionEngine, shellExec, ToolRegistry } from '@domi/capability'
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
import { capabilitiesFor, createProvider, lostCapabilities, type ModelProvider } from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
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
}

export class DomiSession {
  private readonly log: SqliteEventLog
  private readonly tools: ToolRegistry
  private readonly provider: ModelProvider
  private readonly listeners: Partial<SessionEvents> = {}
  private lastSeq = 0
  private currentModel: string
  private currentProvider: string

  constructor(private readonly opts: SessionOptions) {
    this.log = new SqliteEventLog({ path: opts.dbPath, cwd: opts.cwd })
    this.currentModel = opts.config.model.name
    this.currentProvider = opts.config.model.provider

    const permissions = new PermissionEngine({ rules: opts.config.permissions.rules }, (capabilityId, args) =>
      this.askUser(capabilityId, args),
    )
    this.tools = new ToolRegistry({ cwd: opts.cwd, permissions }).register(fsRead).register(fsWrite).register(shellExec)

    // M1-001：provider 由工厂按配置建。kernel 与本文件都不知道「有哪些 provider」，
    // 那份知识只在 packages/model/src/factory.ts 里（AC-4 的 diff 为 0 靠这个成立）
    this.provider =
      opts.provider ??
      createProvider({
        provider: opts.config.model.provider,
        name: opts.config.model.name,
        apiKey: opts.config.model.apiKey,
        baseUrl: opts.config.model.baseUrl,
      })
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

  /** 测试与轨迹面板用：读出这个会话的全部事件（不走增量推送） */
  async pumpAll(): Promise<EventEnvelope[]> {
    return this.log.read(this.opts.sessionId)
  }

  async submit(text: string): Promise<TurnResult> {
    this.listeners.onBusy?.(true)
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
