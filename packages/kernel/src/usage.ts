/**
 * 用量汇总 —— PRD-M8-013 · SPEC-M8-013
 *
 * 纯投影：给一批会话的事件，按时间窗口、按模型汇总 tokens / 花费 / 工具调用 / 权限询问（INV-13）。
 * 花费沿用 metrics 的口径：价目表里没有的模型显示 `—` 而不是 0，也不参与累计（PRD-M1-007 AC-4）。
 * 不读时钟、不碰 IO：窗口与「今天是几号」都由调用方传进来。
 */
import { type EventEnvelope, isKnownEvent } from '@domi/protocol'
import { costOf, type ModelPrice, type PricingTable, readUsage, type TokenTotals } from './metrics.ts'

export interface UsageTotals {
  tokens: TokenTotals
  /** null = 这一格里没有任何一次用量能定价 */
  costUsd: number | null
  /** 用了但价目表里没有的模型 */
  unpricedModels: string[]
  sessions: number
  turns: number
  toolCalls: number
  /** 问过人的权限（source: user） */
  asks: number
  /** cacheRead ÷（input + cacheRead），0–100；没有输入是 null */
  cacheHitPercent: number | null
}

export interface UsageSummary extends UsageTotals {
  from: number
  to: number
  /** 按模型，花得多的在前 */
  byModel: Array<UsageTotals & { model: string; provider: string }>
  /** 按月（会话的事件落在哪个月算哪个月），新的在前 */
  byMonth: Array<UsageTotals & { month: string }>
}

/** 一个会话的事件；调用方按 updated_at 先粗筛，这里按事件 ts 精筛 */
export interface UsageInput {
  id: string
  events: readonly EventEnvelope[]
}

interface Bucket {
  tokens: TokenTotals
  cost: number
  priced: boolean
  unpriced: Set<string>
  sessions: Set<string>
  turns: number
  toolCalls: number
  asks: number
  provider: string
}

const newBucket = (): Bucket => ({
  tokens: { input: 0, output: 0, cacheRead: 0 },
  cost: 0,
  priced: false,
  unpriced: new Set(),
  sessions: new Set(),
  turns: 0,
  toolCalls: 0,
  asks: 0,
  provider: '',
})

function finish(b: Bucket): UsageTotals {
  const used = b.tokens.input + b.tokens.cacheRead
  return {
    tokens: { ...b.tokens },
    costUsd: b.priced ? b.cost : null,
    unpricedModels: [...b.unpriced].sort(),
    sessions: b.sessions.size,
    turns: b.turns,
    toolCalls: b.toolCalls,
    asks: b.asks,
    cacheHitPercent: used > 0 ? Math.round((b.tokens.cacheRead / used) * 100) : null,
  }
}

/** 毫秒 → `YYYY-MM`（UTC：不读本地时区，纯函数） */
export function monthOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function summarizeUsage(
  sessions: Iterable<UsageInput>,
  opts: { from: number; to: number; pricing?: PricingTable },
): UsageSummary {
  const pricing = opts.pricing ?? {}
  const all = newBucket()
  const byModel = new Map<string, Bucket>()
  const byMonth = new Map<string, Bucket>()

  for (const s of sessions) {
    // 模型跟着事件流走：一个会话里可能换过模型（M1-002）
    let model = ''
    let provider = ''
    for (const env of s.events) {
      const ev = env.ev
      if (!isKnownEvent(ev)) continue
      if (ev.t === 'model.request') {
        model = ev.model
        provider = ev.provider
      }
      // v12 起 model.switch 带 provider；更早的没有，紧随其后的 model.request 会把它补上（换模型总要再发一次请求）
      if (ev.t === 'model.switch') {
        model = ev.to
        if (ev.provider !== undefined) provider = ev.provider
      }
      if (env.ts < opts.from || env.ts >= opts.to) continue
      const month = monthOf(env.ts)
      const m = byModel.get(model) ?? newBucket()
      const mo = byMonth.get(month) ?? newBucket()
      m.provider = provider
      byModel.set(model, m)
      byMonth.set(month, mo)
      const hit = [all, m, mo]
      for (const b of hit) b.sessions.add(s.id)
      switch (ev.t) {
        case 'user.input':
          for (const b of hit) b.turns += 1
          break
        case 'tool.call':
          for (const b of hit) b.toolCalls += 1
          break
        case 'permission':
          if (ev.source === 'user') for (const b of hit) b.asks += 1
          break
        case 'model.usage': {
          const t = readUsage(ev.raw)
          const price: ModelPrice | undefined = pricing[model]
          for (const b of hit) {
            b.tokens.input += t.input
            b.tokens.output += t.output
            b.tokens.cacheRead += t.cacheRead
            if (price) {
              b.cost += costOf(t, price)
              b.priced = true
            } else if (model !== '') b.unpriced.add(model)
          }
          break
        }
        default:
          break
      }
    }
  }

  const models = [...byModel.entries()]
    .filter(([name]) => name !== '')
    .map(([name, b]) => ({ ...finish(b), model: name, provider: b.provider }))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens.output - a.tokens.output)
  const months = [...byMonth.entries()]
    .map(([month, b]) => ({ ...finish(b), month }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
  return { ...finish(all), from: opts.from, to: opts.to, byModel: models, byMonth: months }
}
