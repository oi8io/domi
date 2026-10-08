/**
 * 把确定性清理接成一个上下文拼装策略 —— PRD-M2-002 · 守 ADR-005 / INV-02
 *
 * **注册发生在 kernel 外面。** kernel 只提供 `registerContextStrategy` 这个注册点，
 * 它永远不知道有「清理」这回事——这正是 PRD-M2-003 AC-6 那句
 * 「切换压缩策略实现，`packages/kernel` diff 为 0」的兑现方式。
 *
 * 清理的结果是**投影**：事件流一条没动（INV-12），变的只是这一轮送给模型的 messages。
 */
import { buildContext, type ContextPolicy, type ContextStrategy, registerContextStrategy } from '@domi/kernel'
import type { AnyEvent, EventEnvelope, ModelMessages } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import { type CleanupOptions, cleanup } from './cleanup.ts'
import {
  type CompactEvent,
  lastCompactEvent,
  refillData,
  renderSummary,
  renderSummaryV2,
  type Summary,
  type SummaryV2,
} from './compact.ts'
import { applyMask, collectMasked, partitionHotCold } from './mask.ts'

export const STRATEGY_NAME = 'clean'

/**
 * 用清理后的文本替回事件里对应的字段，再交给 kernel 的 full 策略拼装。
 *
 * 为什么是「替回去再拼」而不是「自己拼一套」：
 * 上下文的**形状**（哪些事件进、role 怎么分、tool 消息怎么配对）是 kernel 的知识，
 * 在这里复制一份，两边就会慢慢长歪。清理只负责**内容变短**，形状照旧。
 */
export function applyCleanup(events: readonly EventEnvelope[], opts?: CleanupOptions): EventEnvelope[] {
  const r = cleanup(events, opts)
  const textBySeq = new Map(r.items.map((i) => [i.seq, i]))

  return events.map((env) => {
    const item = textBySeq.get(env.seq)
    if (!item || item.appliedRules.length === 0) return env
    const ev = env.ev
    if (!isKnownEvent(ev)) return env

    let next: AnyEvent = ev
    if (ev.t === 'tool.result') next = { ...ev, payload: item.text }
    else if (ev.t === 'model.delta' || ev.t === 'model.reason' || ev.t === 'user.input' || ev.t === 'user.note')
      next = { ...ev, text: item.text }
    else if (ev.t === 'error') next = { ...ev, message: item.text }
    return { ...env, ev: next }
  })
}

/**
 * 清理完之后**原样交给 kernel 的 full 策略**。
 * 注意这里调的是 `buildContext` 而不是某个内部函数——
 * 也就是说 kernel 一行都不用改就能多一种策略（PRD-M2-003 AC-6 的判据）。
 * 顺带：token 上限检查落在**清理之后**的 messages 上，这正是想要的顺序。
 */
export function makeCleanStrategy(opts?: CleanupOptions): ContextStrategy {
  return (events: readonly EventEnvelope[], policy: ContextPolicy): ModelMessages =>
    buildContext(applyCleanup(events, opts), { ...policy, strategy: 'full' })
}

let registered = false

/**
 * 注册 'clean' 策略。调用方是 runtime（组合根），不是 kernel。
 * 幂等——注册两次不是错误，但也不会注册两份。
 */
export function registerCleanStrategy(opts?: CleanupOptions): void {
  if (registered) return
  registerContextStrategy(STRATEGY_NAME, makeCleanStrategy(opts))
  registered = true
}

/**
 * 'compact' 上下文策略 —— PRD-M2-003 AC-2 / AC-6
 *
 * 保边压中：system prompt 与最近 N 轮**逐字**保留，中间换成摘要消息。
 * 和 'clean' 一样，清理完把事情交回 kernel 的 full 策略——kernel 一行不用改（AC-6）。
 *
 * 摘要从哪来：**事件流里最后一条 `ctx.compact`**。
 * 也就是说策略本身不调用模型、不做任何 IO，它只是把已经发生过的那次压缩**投影**出来。
 * 什么时候真去调模型压缩，是 runtime 的事（AC-1 的阈值触发）。
 * 这条分工让上下文拼装保持纯函数，L1 回放才能确定性地重放它。
 */
export const COMPACT_STRATEGY_NAME = 'compact'

export function makeCompactStrategy(): ContextStrategy {
  return (events: readonly EventEnvelope[], policy: ContextPolicy): ModelMessages => {
    // 最后一条 ctx.compact 说了算：它覆盖的区间换成摘要，区间之外逐字保留
    let latest: { fromSeq: number; toSeq: number; summary: CompactEvent['summary'] } | null = null
    for (const env of events) {
      const ev = env.ev
      if (isKnownEvent(ev) && ev.t === 'ctx.compact') {
        latest = { fromSeq: ev.fromSeq, toSeq: ev.toSeq, summary: ev.summary }
      }
    }
    if (!latest) return buildContext(events, { ...policy, strategy: 'full' })

    const { fromSeq, toSeq, summary } = latest
    const kept = events.filter((e) => e.seq < fromSeq || e.seq > toSeq)
    // 摘要作为一条 user.input 事件插在最前面：它要经过和别的内容一样的拼装路径，
    // 不走特例。特例是将来出 bug 的地方（M15 起主路径走 applyCompact 的 ctx.note 边界块）
    const summaryEvent: EventEnvelope = {
      seq: fromSeq,
      sessionId: events[0]?.sessionId ?? '',
      parentSeq: null,
      ts: events[0]?.ts ?? 0,
      schemaVersion: events[0]?.schemaVersion ?? 0,
      ev: { t: 'user.input', text: renderSummary(summary as Summary) },
    }
    return buildContext([summaryEvent, ...kept], { ...policy, strategy: 'full' })
  }
}

let compactRegistered = false

export function registerCompactStrategy(): void {
  if (compactRegistered) return
  registerContextStrategy(COMPACT_STRATEGY_NAME, makeCompactStrategy())
  compactRegistered = true
}

/**
 * M15：遮蔽 + 确定性清理投影 —— PRD-M15-004（SPEC-M15-004，取舍-2）
 *
 * **均衡（balanced）**：遮蔽 → 确定性规则（只动冷区）→ 交给 full。
 * 投影 = 「遮蔽 → 压缩 → 交给 full」里的前两档；'clean' 是它的前身，
 * 现在加上了热区保护（AC-1）与「规则只动冷区」（AC-4）。
 *
 * 与老策略同一纪律：注册发生在 kernel 外面，kernel 不认识「遮蔽」；
 * 结果只改投影，事件流一条不动（INV-12）。
 */
export const BALANCED_STRATEGY_NAME = 'balanced'
export const ECONOMICAL_STRATEGY_NAME = 'economical'

export interface MaskStrategyOptions {
  clean?: CleanupOptions
  /** 遮蔽单批最少腾出 token（默认 8000，clear_at_least 同理） */
  maskMinFreed?: number
}

/**
 * 压缩投影（PRD-M15-005 取舍-7 / AC-6）：读最近 ctx.compact，把被覆盖的区间换成摘要块。
 *
 * 摘要以 **ctx.note** 身份插入（X1——不再以 user.input 身份冒充用户说的话），
 * 正文是 U+E002/U+E003 边界块 + guardrail「摘要是数据」。
 * 事件流一条不动（INV-12），这里只改投影。
 */
export function applyCompact(events: readonly EventEnvelope[]): EventEnvelope[] {
  const latest = lastCompactEvent(events)
  if (latest === null) return [...events]
  const { fromSeq, toSeq, summary } = latest
  const kept = events.filter((e) => e.seq < fromSeq || e.seq > toSeq)
  const note: EventEnvelope = {
    seq: fromSeq,
    sessionId: events[0]?.sessionId ?? '',
    parentSeq: null,
    ts: events[0]?.ts ?? 0,
    schemaVersion: events[0]?.schemaVersion ?? 0,
    ev: { t: 'ctx.note', text: renderSummaryV2(summary as SummaryV2), reason: 'supplement' },
  }
  return [note, ...kept]
}

/**
 * 补水投影（取舍-9 / AC-5）：压缩之后（存在最近 ctx.compact 时）的下一请求，
 * 附最近读/改文件路径 +「需要时重读」提示 + 当前计划。
 * skill 正文在压缩请求的指令模板里带（session 侧有 skillSource），这里只做事件流可得的。
 */
export function applyRefill(events: readonly EventEnvelope[]): EventEnvelope[] {
  const latest = lastCompactEvent(events)
  if (latest === null) return [...events]
  const refill = refillData(events)
  if (refill.files.length === 0 && refill.plan === null) return [...events]
  const lines: string[] = []
  if (refill.files.length > 0) {
    lines.push(
      `最近读/改的文件（被压缩过内容，需要时重读；改动前必须重读原始内容）：\n${refill.files.map((f) => `  - ${f}`).join('\n')}`,
    )
  }
  if (refill.plan !== null) lines.push(`当前计划：\n${refill.plan}`)
  const last = events[events.length - 1]
  const note: EventEnvelope = {
    seq: (last?.seq ?? 0) + 1,
    sessionId: events[0]?.sessionId ?? '',
    parentSeq: null,
    ts: last?.ts ?? 0,
    schemaVersion: events[0]?.schemaVersion ?? 0,
    ev: { t: 'ctx.note', text: lines.join('\n\n'), reason: 'supplement' },
  }
  return [...events, note]
}

/**
 * 遮蔽 → 确定性清理（只动冷区）→ 压缩 → 补水 → 原样交 kernel full 拼装。
 * 纯函数：computeMask / applyMask / cleanup / applyCompact / applyRefill 都不碰 IO，L1 回放照常确定。
 *
 * **投影按已落盘的 ctx.mask 决定（INV-12(b)「已遮蔽不再变」）**——
 * computeMask 是「决策」用的（超阈值预检时决定一批），拼装时直接读事件流里
 * 已落盘的遮蔽记录来替换指针；重新计算会把同一批遮蔽两次或漏掉已遮蔽的。
 * 压缩同理：只读最近已落盘的 ctx.compact（SPEC-M15 3.3 投影链）。
 */
export function maskAndClean(events: readonly EventEnvelope[], opts: MaskStrategyOptions = {}): EventEnvelope[] {
  const masked = applyMask(events, [...collectMasked(events)])
  const { cold } = partitionHotCold(masked)
  return applyCleanup(masked, { ...opts.clean, coldSeqs: cold })
}

export function makeMaskStrategy(opts?: MaskStrategyOptions): ContextStrategy {
  return (events: readonly EventEnvelope[], policy: ContextPolicy): ModelMessages => {
    // 投影链（SPEC-M15 3.3）：遮蔽 → 压缩 → 补水 → full
    let proj = maskAndClean(events, opts)
    proj = applyCompact(proj)
    proj = applyRefill(proj)
    return buildContext(proj, { ...policy, strategy: 'full' })
  }
}

let maskRegistered = false

/** 注册 'balanced' / 'economical' 两档。幂等。economical 与 balanced 同一实现（阈值差异在预算器 45/70） */
export function registerMaskStrategy(opts?: MaskStrategyOptions): void {
  if (maskRegistered) return
  registerContextStrategy(BALANCED_STRATEGY_NAME, makeMaskStrategy(opts))
  registerContextStrategy(ECONOMICAL_STRATEGY_NAME, makeMaskStrategy(opts))
  maskRegistered = true
}
