/**
 * 状态栏指标 —— PRD-M1-007 · SPEC-M1-007
 *
 * **每一个数字都必须能从事件流算出来。**
 * AC-3 的断言方式（删掉状态栏模块后 kernel 测试仍绿）是这条的机器判据——
 * 如果指标需要状态栏那边埋点，删掉它 kernel 就会红。
 *
 * 花费那条值得单说：未在价目表里的模型显示 `—` 且**不参与累计**。
 * 显示 0 会让人以为免费，比显示「不知道」更糟——
 * 而"不知道成本的工具不敢常用"正是这条需求的由来。
 */
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'

export interface ModelPrice {
  /** 美元 / 百万 token */
  inputPer1M: number
  outputPer1M: number
  /** 缓存读通常便宜一个数量级；没给就按 input 价算 */
  cacheReadPer1M?: number | undefined
}

export type PricingTable = Record<string, ModelPrice>

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
}

export interface Metrics {
  model: string
  provider: string
  tokens: TokenTotals
  /** null 表示没有任何一次用量能定价 —— 显示 `—`，不是 0 */
  costUsd: number | null
  /** 用了但价目表里没有的模型。有它才能在 UI 上说清「为什么是 —」 */
  unpricedModels: string[]
  toolCalls: number
  /** 最近一轮用了多久。传了 now（这一轮还在跑）就算到 now */
  turnMs: number
  contextPercent: number
  /** 用户输入了几次（PRD-M8-008 AC-2） */
  turns: number
  /** 发了几次模型请求 */
  steps: number
  /** 最近一轮的输出速度：这一轮的输出 token ÷ 从这一轮第一次模型请求到最后一条事件的秒数。算不出来是 null */
  tokPerSec: number | null
  /** 缓存命中：cacheRead ÷（input + cacheRead），0–100 取整；没有输入是 null */
  cacheHitPercent: number | null
}

export interface AggregateOptions {
  pricing?: PricingTable
  maxContextTokens?: number
  /** 现在几点从外面传 —— kernel 不读时钟（PRD-M0-006 AC-1） */
  now?: number
}

/** provider 的 usage 字段名各家不同，这里只做**读取**的归一，事件流里存的仍是原文（ADR-004）。
 *
 * AI SDK 的 ai-sdk-provider 把 usage 包在 raw.usage 下（{ usage: {inputTokens,outputTokens}, providerMetadata, response }），
 * 旧形状是平铺在 raw 顶层。两种都认：先看 raw.usage，再回退顶层。 */
export function readUsage(raw: Record<string, unknown>): TokenTotals {
  // ai-sdk-provider 的 finish-step：raw = { usage: {...}, providerMetadata, response }
  const inner = (raw.usage && typeof raw.usage === 'object' ? raw.usage : raw) as Record<string, unknown>
  const pick = (...keys: string[]): number => {
    for (const k of keys) {
      const v = inner[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return 0
  }
  return {
    input: pick('input_tokens', 'inputTokens', 'prompt_tokens'),
    output: pick('output_tokens', 'outputTokens', 'completion_tokens'),
    cacheRead: pick('cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens'),
  }
}

export function costOf(t: TokenTotals, p: ModelPrice): number {
  const cacheRate = p.cacheReadPer1M ?? p.inputPer1M
  return (t.input * p.inputPer1M + t.output * p.outputPer1M + t.cacheRead * cacheRate) / 1_000_000
}

export function aggregate(events: readonly EventEnvelope[], opts: AggregateOptions = {}): Metrics {
  const pricing = opts.pricing ?? {}
  const totals: TokenTotals = { input: 0, output: 0, cacheRead: 0 }
  const unpriced = new Set<string>()

  let model = ''
  let provider = ''
  let toolCalls = 0
  let cost = 0
  let priced = false
  /** 本轮 = 最后一条用户输入开始（BUG-M3-003：以前算的是整个会话的跨度） */
  let turnStart: number | null = null
  let lastTs = 0
  let turns = 0
  let steps = 0
  /** 本轮第一次模型请求的时间、本轮输出 token */
  let turnModelStart: number | null = null
  let turnOutput = 0

  for (const env of events) {
    const ev: AnyEvent = env.ev
    lastTs = Math.max(lastTs, env.ts)
    if (!isKnownEvent(ev)) continue

    switch (ev.t) {
      case 'user.input':
        turnStart = env.ts
        turns += 1
        turnModelStart = null
        turnOutput = 0
        break
      case 'model.request':
        model = ev.model
        provider = ev.provider
        steps += 1
        if (turnModelStart === null) turnModelStart = env.ts
        break
      case 'model.switch':
        model = ev.to
        break
      case 'tool.call':
        toolCalls += 1
        break
      case 'model.usage': {
        const t = readUsage(ev.raw)
        totals.input += t.input
        totals.output += t.output
        totals.cacheRead += t.cacheRead
        turnOutput += t.output
        const price = pricing[model]
        if (price) {
          cost += costOf(t, price)
          priced = true
        } else if (model !== '') {
          unpriced.add(model)
        }
        break
      }
      default:
        break
    }
  }

  const used = totals.input + totals.cacheRead
  const max = opts.maxContextTokens ?? 0
  const end = opts.now ?? lastTs
  const genMs = turnModelStart === null ? 0 : end - turnModelStart
  return {
    model,
    provider,
    tokens: totals,
    costUsd: priced ? cost : null,
    unpricedModels: [...unpriced].sort(),
    toolCalls,
    turnMs: turnStart === null ? 0 : Math.max(0, (opts.now ?? lastTs) - turnStart),
    contextPercent: max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0,
    turns,
    steps,
    tokPerSec: genMs > 0 && turnOutput > 0 ? Math.round((turnOutput / genMs) * 1000) : null,
    cacheHitPercent: used > 0 ? Math.round((totals.cacheRead / used) * 100) : null,
  }
}

export type ContextLevel = 'ok' | 'warn' | 'danger'

/** PRD-M1-007 AC-2 的阈值。写成函数是为了颜色状态可以被快照断言 */
export function contextLevel(percent: number): ContextLevel {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

export function formatCost(m: Metrics): string {
  if (m.costUsd === null) return '—'
  return `$${m.costUsd.toFixed(4)}`
}
