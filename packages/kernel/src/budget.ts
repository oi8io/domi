/**
 * 窗口预算器 —— PRD-M15-002 AC-2（SPEC-M15-002 取舍-16）
 *
 * 统一口径：有效窗口 = 窗口 − maxOutput − 13k 安全余量；
 * 占用 = 最近真实 usage 基准 + 本步增量估算（system / 工具定义 / 新事件）。
 * 守卫、阈值、状态栏、上下文 tab 全部读这份（RECON C3）——不再各算各的。
 *
 * 档位（均衡）：≥60% 遮蔽 / ≥80% 压缩 / ≥92% 硬顶（任何档不降）。
 * 阈值是「预算器」与「降级链」（runtime/degrade.ts）的接缝：预算器只回答
 * 现在在第几档，链负责把占用打下来。
 */
import { estimateTextTokens } from '@domi/protocol'

/** 安全余量（Claude Code 同款口径）：有效窗口 = 窗口 − maxOutput − 13k */
export const SAFETY_MARGIN = 13_000

/** 均衡档阈值：遮蔽 / 压缩 / 硬顶 */
export const MASK_AT = 0.6
export const COMPACT_AT = 0.8
export const HARD_CAP = 0.92

export type BudgetLevel = 'ok' | 'mask' | 'compact' | 'hard'

export interface EffectiveWindowInput {
  contextWindow: number
  maxOutput: number
}

/** 有效窗口 = 窗口 − maxOutput − 13k；极小窗口防御：不低于 4096 */
export function effectiveWindow(contextWindow: number, maxOutput: number): number {
  return Math.max(4096, contextWindow - maxOutput - SAFETY_MARGIN)
}

/** 占用档位：0.6 遮蔽 / 0.8 压缩 / 0.92 硬顶（任何档不降） */
export function evaluate(used: number, effective: number): BudgetLevel {
  const ratio = used / effective
  if (ratio >= HARD_CAP) return 'hard'
  if (ratio >= COMPACT_AT) return 'compact'
  if (ratio >= MASK_AT) return 'mask'
  return 'ok'
}

/**
 * 本步增量估算：system 固定 + 工具定义固定 + 新事件，全部走 estimateTextTokens 口径
 * （CJK 每字 1、其余每 4 字符 1 · BUG-M14-001）。空输入 → 0。
 */
export function estimateIncrement(system: string, tools: unknown, added: unknown): number {
  return (
    estimateTextTokens(system) + estimateTextTokens(JSON.stringify(tools)) + estimateTextTokens(JSON.stringify(added))
  )
}

/**
 * 拼装阶段超限的可恢复异常 —— PRD-M15-002 AC-4。
 * runTurn 捕获后转成 `error{scope:'context', recoverable:true}` 落盘，
 * 不穿出（会话不会进入「每次 submit 都失败」的状态）。
 */
export class ContextLimitError extends Error {
  readonly recoverable = true
  readonly scope = 'context' as const
  constructor(message: string) {
    super(message)
    this.name = 'ContextLimitError'
  }
}
