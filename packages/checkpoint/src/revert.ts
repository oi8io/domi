/**
 * 回滚的事件语义 —— PRD-M1-011 AC-3 · INV-01 / INV-12
 *
 * 回滚**不删除任何事件**。它追加一条 `revert`，声明「从 toSeq 之后的那一段作废」。
 * 于是轨迹里能看到「用户在第 N 步回滚到了第 M 步」——这是可审计的一部分，
 * 而删掉事件会让这件事彻底消失。
 */
import type { AnyEvent, EventEnvelope } from '@domi/protocol'

export type RevertScope = 'files' | 'conversation' | 'both'

export interface DeadRange {
  fromSeq: number
  toSeq: number
}

/**
 * 算出哪些 seq 区间被回滚掉了。
 * 后来的 revert 覆盖先前的：连续两次回滚要能回到初始状态（AC-4）。
 */
export function deadRanges(events: readonly EventEnvelope[]): DeadRange[] {
  const ranges: DeadRange[] = []
  for (const env of events) {
    const ev = env.ev as AnyEvent & { toSeq?: number; scope?: RevertScope }
    if (ev.t !== 'revert' || typeof ev.toSeq !== 'number') continue
    if (ev.scope === 'files') continue // 只回滚文件时对话不作废
    ranges.push({ fromSeq: ev.toSeq + 1, toSeq: env.seq - 1 })
  }
  return ranges
}

export function isDead(seq: number, ranges: readonly DeadRange[]): boolean {
  return ranges.some((r) => seq >= r.fromSeq && seq <= r.toSeq)
}

/**
 * 投影：把被回滚掉的事件标出来但**保留**（INV-12 的同一立场——
 * 压缩不销毁原始事件，回滚也不）。
 */
export function projectAfterReverts(
  events: readonly EventEnvelope[],
): Array<EventEnvelope & { dead: boolean }> {
  const ranges = deadRanges(events)
  return events.map((e) => ({ ...e, dead: isDead(e.seq, ranges) }))
}

/** 喂给模型的上下文里不含作废段 —— 但事件流里它们还在 */
export function liveEvents(events: readonly EventEnvelope[]): EventEnvelope[] {
  const ranges = deadRanges(events)
  return events.filter((e) => !isDead(e.seq, ranges) && e.ev.t !== 'revert')
}

/** 回滚确认框的文案。AC-6 要求明示快照**不覆盖**的副作用范围 */
export const REVERT_SIDE_EFFECT_NOTICE =
  '注意：回滚只还原文件。已执行的 shell 命令、已发出的网络请求、已 push 的 commit 都不会被撤销。'
