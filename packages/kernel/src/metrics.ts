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
  cacheReadPer1M?: number
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
  turnMs: number
  contextPercent: number
}

export interface AggregateOptions {
  pricing?: PricingTable
  maxContextTokens?: number
  /** 现在几点从外面传 —— kernel 不读时钟（PRD-M0-006 AC-1） */
  now?: number
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** provider 的 usage 字段名各家不同，这里只做**读取**的归一，事件流里存的仍是原文（ADR-004） */
function readUsage(raw: Record<string, unknown>): TokenTotals {
  const pick = (...keys: string[]): number => {
    for (const k of keys) {
      const v = raw[k]
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

function costOf(t: TokenTotals, p: ModelPrice): number {
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
  let firstTs: number | null = null
  let lastTs = 0

  for (const env of events) {
    const ev: AnyEvent = env.ev
    firstTs ??= env.ts
    lastTs = Math.max(lastTs, env.ts)
    if (!isKnownEvent(ev)) continue

    switch (ev.t) {
      case 'model.request':
        model = ev.model
        provider = ev.provider
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
  return {
    model,
    provider,
    tokens: totals,
    costUsd: priced ? cost : null,
    unpricedModels: [...unpriced].sort(),
    toolCalls,
    turnMs: firstTs === null ? 0 : Math.max(0, (opts.now ?? lastTs) - firstTs),
    contextPercent: max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0,
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
