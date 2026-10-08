/**
 * 前缀稳定性校验器 —— INV-12(b)（TASK-M15-002）。
 *
 * 输入：会话事件流。输出：相邻 model.request 之间「后一次不以先一次为前缀」的违规列表。
 * 白名单：两次请求之间出现了 ctx.compact 或 ctx.refresh（压缩点 / 用户显式刷新 = 预期断裂）。
 *
 * L1 门禁的一部分：不调模型、不联网，只对事件流里的 fingerprint.messages 做纯函数比较。
 */
import type { EventEnvelope } from '@domi/protocol'

export interface PrefixStabilityIssue {
  prevSeq: number
  nextSeq: number
  /** 第一条不一致的消息下标（-1 = 长度变短） */
  at: number
}

export function assertPrefixStability(events: readonly EventEnvelope[]): PrefixStabilityIssue[] {
  const requests = events
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: EventEnvelope; i: number } & { fp: string[] } => {
      const ev = x.e.ev as { t?: string; fingerprint?: { messages?: string[] } }
      return ev.t === 'model.request' && Array.isArray(ev.fingerprint?.messages)
    })
    .map((x) => ({
      seq: x.e.seq,
      i: x.i,
      fp: (x.e.ev as { fingerprint: { messages: string[] } }).fingerprint.messages,
    }))

  const issues: PrefixStabilityIssue[] = []
  for (let k = 1; k < requests.length; k++) {
    const prev = requests[k - 1]!
    const next = requests[k]!
    const gap = events.slice(prev.i + 1, next.i)
    const whitelisted = gap.some((e) => e.ev.t === 'ctx.compact' || e.ev.t === 'ctx.refresh')
    if (whitelisted) continue
    if (next.fp.length < prev.fp.length) {
      issues.push({ prevSeq: prev.seq, nextSeq: next.seq, at: -1 })
      continue
    }
    // 只比较 prev 长度内的部分：超出 prev 长度的消息是合法追加（前缀只增不改），不算违规
    const at = next.fp.findIndex((h, j) => j < prev.fp.length && h !== prev.fp[j])
    if (at >= 0) issues.push({ prevSeq: prev.seq, nextSeq: next.seq, at })
  }
  return issues
}
