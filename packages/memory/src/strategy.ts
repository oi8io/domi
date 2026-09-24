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
import { renderSummary, type Summary } from './compact.ts'

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
    let latest: { fromSeq: number; toSeq: number; summary: Summary } | null = null
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
    // 不走特例。特例是将来出 bug 的地方
    const summaryEvent: EventEnvelope = {
      seq: fromSeq,
      sessionId: events[0]?.sessionId ?? '',
      parentSeq: null,
      ts: events[0]?.ts ?? 0,
      schemaVersion: events[0]?.schemaVersion ?? 0,
      ev: { t: 'user.input', text: renderSummary(summary) },
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
