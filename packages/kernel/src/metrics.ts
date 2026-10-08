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
import { type Fingerprint, locateBreak } from './fingerprint.ts'

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
  /**
   * 当前上下文占用（token）：**最近一次请求**的提示词大小（input + cacheRead），不是全会话累计——
   * 每次请求都把整段上下文重发一遍，累计值是「花了多少输入」，不是「窗口里装了多少」（BUG-M13-002）。
   * 压缩之后、下一次请求之前，按压掉的量往下扣；下一次请求回来就以它的真实用量为准
   */
  contextTokens: number
  /** contextTokens ÷ 窗口，0–100 取整 */
  contextPercent: number
  /** 用户输入了几次（PRD-M8-008 AC-2） */
  turns: number
  /** 发了几次模型请求 */
  steps: number
  /**
   * 最近一轮的输出速度：这一轮各步输出 token 之和 ÷ 各步「model.request → model.usage」耗时之和。
   * 不含工具执行与等人确认的时间；含首 token 延迟（端到端速度）。
   * 量不出来（老会话的请求与用量同一个 ts、还没有一步完成）是 null（BUG-M13-004）
   */
  tokPerSec: number | null
  /** 缓存命中（全会话）：cacheRead ÷（input + cacheRead），0–100 取整；没有输入是 null */
  cacheHitPercent: number | null
  /**
   * M15（SPEC-M15-001）：上下文尺子——
   * breakCount：非白名单前缀断裂次数（相邻请求指纹对比定位到差异，SPEC-M15-001 取舍-18）
   * avoidableLoss：这些断裂请求的未命中输入 token 合计（R0 口径：本可命中却重发的输入）
   * maskCount / compactCount：遮蔽批次与压缩次数
   * overflowCount：超窗降级（error scope 'context'）次数
   * memorySuccessRate：记忆抽取成功率（008 接线后非 null；此前为 null）
   */
  breakCount: number
  avoidableLoss: number
  maskCount: number
  compactCount: number
  overflowCount: number
  memorySuccessRate: number | null
}

export interface AggregateOptions {
  pricing?: PricingTable
  maxContextTokens?: number
  /** 现在几点从外面传 —— kernel 不读时钟（PRD-M0-006 AC-1） */
  now?: number
}

/**
 * provider 的 usage 字段名各家不同，这里只做**读取**的归一，事件流里存的仍是原文（ADR-004）。
 *
 * 归一后的口径（BUG-M13-003）：
 * - `cacheRead`：从缓存读的输入
 * - `input`：这次请求里**没走缓存读**的输入（含缓存写——它也是这次的提示词，按输入价计）
 * - 两者之和 = 这次请求的提示词大小
 *
 * 认的形状：
 * - AI SDK 7（ai-sdk-provider 的 finish-step，包在 raw.usage 下）：inputTokens 是**含缓存的总输入**，
 *   缓存读在 inputTokenDetails.cacheReadTokens；openai-compatible 只认 prompt_tokens_details.cached_tokens，
 *   DeepSeek 原生的 prompt_cache_hit_tokens 要从 usage.raw（provider 原文）补
 * - AI SDK 5：inputTokens 含缓存，缓存读在 cachedInputTokens
 * - OpenAI / DeepSeek 原生：prompt_tokens 含缓存（prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens）
 * - Anthropic 原生（含 camelCase 变体）：input_tokens **不含**缓存，读与写另给
 */
export function readUsage(raw: Record<string, unknown>): TokenTotals {
  const inner = (isObj(raw.usage) ? raw.usage : raw) as Record<string, unknown>
  const providerRaw = isObj(inner.raw) ? inner.raw : {}
  const output = num(inner, 'output_tokens', 'outputTokens', 'completion_tokens') ?? 0

  // 提示词总数里已经含缓存的几种形状
  const details = isObj(inner.inputTokenDetails) ? inner.inputTokenDetails : null
  const openaiDetails = isObj(inner.prompt_tokens_details) ? inner.prompt_tokens_details : null
  const inclusiveTotal =
    details !== null || inner.cachedInputTokens !== undefined ? num(inner, 'inputTokens') : num(inner, 'prompt_tokens')
  if (inclusiveTotal !== null) {
    const cacheRead = Math.min(
      inclusiveTotal,
      positive(details === null ? null : num(details, 'cacheReadTokens')) ??
        positive(num(inner, 'cachedInputTokens', 'prompt_cache_hit_tokens')) ??
        positive(openaiDetails === null ? null : num(openaiDetails, 'cached_tokens')) ??
        positive(num(providerRaw, 'prompt_cache_hit_tokens')) ??
        positive(
          isObj(providerRaw.prompt_tokens_details) ? num(providerRaw.prompt_tokens_details, 'cached_tokens') : null,
        ) ??
        0,
    )
    return { input: inclusiveTotal - cacheRead, output, cacheRead }
  }

  // Anthropic 式：input 不含缓存
  const base = num(inner, 'input_tokens', 'inputTokens') ?? 0
  const write = num(inner, 'cache_creation_input_tokens', 'cacheCreationInputTokens') ?? 0
  const cacheRead = num(inner, 'cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens') ?? 0
  return { input: base + write, output, cacheRead }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null)

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
  /** 本轮：已完成各步的输出 token 与生成耗时；进行中那一步的请求时间（BUG-M13-004） */
  let turnOutput = 0
  let turnGenMs = 0
  let stepStart: number | null = null
  /** 当前上下文占用（BUG-M13-002） */
  let contextTokens = 0
  // M15（SPEC-M15-001）：相邻请求指纹对比——白名单（压缩 / 刷新之后的第一个请求）不判断裂
  const requests: Array<{ seq: number; fp: Fingerprint | null; whiteListed: boolean; input: number }> = []
  let whiteListedNext = false
  let maskCount = 0
  let compactCount = 0
  let overflowCount = 0

  for (const env of events) {
    const ev: AnyEvent = env.ev
    lastTs = Math.max(lastTs, env.ts)
    if (!isKnownEvent(ev)) continue

    switch (ev.t) {
      case 'user.input':
        turnStart = env.ts
        turns += 1
        turnOutput = 0
        turnGenMs = 0
        stepStart = null
        break
      case 'model.request':
        model = ev.model
        provider = ev.provider
        steps += 1
        stepStart = env.ts
        requests.push({
          seq: env.seq,
          fp: ev.fingerprint ?? null,
          whiteListed: whiteListedNext,
          input: 0,
        })
        whiteListedNext = false
        break
      case 'model.switch':
        model = ev.to
        break
      case 'tool.call':
        toolCalls += 1
        break
      case 'ctx.compact':
        // 压缩后、下一次请求前：按压掉的量往下扣。下一次 model.usage 回来就以真实用量为准
        contextTokens = Math.max(0, contextTokens - Math.max(0, ev.tokensBefore - ev.tokensAfter))
        compactCount += 1
        // M15：压缩是**预期内**断裂，它之后的第一个请求不判断裂（白名单）
        whiteListedNext = true
        break
      case 'ctx.mask':
        maskCount += 1
        whiteListedNext = true
        break
      case 'ctx.refresh':
        whiteListedNext = true
        break
      case 'model.usage': {
        const t = readUsage(ev.raw)
        totals.input += t.input
        totals.output += t.output
        totals.cacheRead += t.cacheRead
        contextTokens = t.input + t.cacheRead
        const lastReq = requests.at(-1)
        if (lastReq !== undefined) lastReq.input = t.input
        if (stepStart !== null) {
          turnOutput += t.output
          turnGenMs += env.ts - stepStart
          stepStart = null
        }
        const price = pricing[model]
        if (price) {
          cost += costOf(t, price)
          priced = true
        } else if (model !== '') {
          unpriced.add(model)
        }
        break
      }
      case 'error':
        if (ev.scope === 'context' && ev.recoverable === true) overflowCount += 1
        break
      default:
        break
    }
  }

  const used = totals.input + totals.cacheRead
  const max = opts.maxContextTokens ?? 0
  // M15：相邻请求断裂——白名单（压缩 / 刷新之后的第一个请求）跳过
  let breakCount = 0
  let avoidableLoss = 0
  for (let i = 1; i < requests.length; i++) {
    const prev = requests[i - 1]
    const cur = requests[i]
    if (prev === undefined || cur === undefined) continue
    if (prev.fp === null || cur.fp === null || cur.whiteListed) continue
    if (locateBreak(prev.fp, cur.fp) !== null) {
      breakCount += 1
      avoidableLoss += cur.input
    }
  }
  return {
    model,
    provider,
    tokens: totals,
    costUsd: priced ? cost : null,
    unpricedModels: [...unpriced].sort(),
    toolCalls,
    turnMs: turnStart === null ? 0 : Math.max(0, (opts.now ?? lastTs) - turnStart),
    contextTokens,
    contextPercent: max > 0 ? Math.min(100, Math.round((contextTokens / max) * 100)) : 0,
    turns,
    steps,
    tokPerSec: turnGenMs > 0 && turnOutput > 0 ? Math.round((turnOutput / turnGenMs) * 1000) : null,
    cacheHitPercent: used > 0 ? Math.round((totals.cacheRead / used) * 100) : null,
    breakCount,
    avoidableLoss,
    maskCount,
    compactCount,
    overflowCount,
    memorySuccessRate: null,
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
