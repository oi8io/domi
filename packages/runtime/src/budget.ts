/**
 * 任务预算 —— PRD-M7-009 · SPEC-M7-009
 *
 * 每次工具调用之前算一次用量（只从事件投影算，INV-13）：过 80% 提醒一次，到顶暂停问人——
 * 继续（上限放宽一半）/ 停止 / 设新上限。决定落 budget.decided，重开会话后照样生效。
 */
import type { ToolGate } from '@domi/capability'
import { aggregate, type PricingTable } from '@domi/kernel'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'

export type BudgetKind = 'tokens' | 'costUsd' | 'toolCalls'
export type BudgetLimits = { [K in BudgetKind]?: number | undefined }

export const BUDGET_KINDS: readonly BudgetKind[] = ['tokens', 'costUsd', 'toolCalls']
export const WARN_RATIO = 0.8

const LABEL: Record<BudgetKind, string> = { tokens: 'token', costUsd: '金额（美元）', toolCalls: '工具调用次数' }

/** 表单：终端里 y = 继续（上限放宽一半） */
export const BUDGET_DECISION_SCHEMA = {
  type: 'object',
  'x-domi-accept-empty': true,
  properties: {
    action: { type: 'string', enum: ['continue', 'raise'], title: '继续（上限放宽一半）/ 设新上限' },
    limit: { type: 'number', title: '新上限（选「设新上限」时填）' },
  },
} as const

/** 当前生效的上限：配置 ← 事件里最后一次设定（session.budget 或到顶时的决定） */
export function effectiveLimits(base: BudgetLimits, events: readonly EventEnvelope[]): BudgetLimits {
  const out: BudgetLimits = { ...base }
  for (const { ev } of events) {
    if (ev.t !== 'budget.decided') continue
    const e = ev as { kind: BudgetKind; limit?: number; action: string }
    if (e.limit !== undefined && e.action !== 'stop') out[e.kind] = e.limit
  }
  return out
}

export function usage(events: readonly EventEnvelope[], pricing: PricingTable): Record<BudgetKind, number | null> {
  const m = aggregate(events, { pricing })
  return { tokens: m.tokens.input + m.tokens.output, costUsd: m.costUsd, toolCalls: m.toolCalls }
}

export interface BudgetDeps {
  base: () => BudgetLimits
  events: () => Promise<readonly EventEnvelope[]>
  pricing: PricingTable
  /** 问人。没人能回答时返回 stop */
  ask: (
    message: string,
    detail: Record<string, unknown>,
  ) => Promise<{ action: 'continue' | 'raise' | 'stop'; limit?: number }>
}

export function makeBudgetGate(deps: BudgetDeps): ToolGate {
  return async () => {
    const base = deps.base()
    if (BUDGET_KINDS.every((k) => base[k] === undefined)) {
      // 配置里没限；会话里可能单独设过
      const evs = await deps.events()
      if (!evs.some((e) => e.ev.t === 'budget.decided')) return { stop: false, events: [] }
    }
    const evs = await deps.events()
    const limits = effectiveLimits(base, evs)
    const used = usage(evs, deps.pricing)
    const warned = new Set(
      evs
        .filter((e) => e.ev.t === 'budget.warn')
        .map((e) => `${(e.ev as { kind: string; limit: number }).kind}@${(e.ev as { limit: number }).limit}`),
    )
    const events: DomiEvent[] = []
    for (const kind of BUDGET_KINDS) {
      const limit = limits[kind]
      const u = used[kind]
      if (limit === undefined || u === null) continue
      // 工具调用：这一次已经记进事件了，超过才算到顶；token / 金额：到了就算
      const over = kind === 'toolCalls' ? u > limit : u >= limit
      if (!over) {
        if (u >= limit * WARN_RATIO && !warned.has(`${kind}@${limit}`)) {
          events.push({ t: 'budget.warn', kind, used: round(u), limit })
        }
        continue
      }
      const answer = await deps.ask(`${LABEL[kind]}到了上限：已用 ${round(u)} / ${limit}。要继续吗？`, {
        kind,
        used: round(u),
        limit,
      })
      if (answer.action === 'stop') {
        events.push({ t: 'budget.decided', action: 'stop', kind })
        return {
          stop: true,
          message: `${LABEL[kind]}到了上限（${round(u)} / ${limit}），用户选择停止。不要再调用工具，总结目前的进展后结束这一轮。`,
          events,
        }
      }
      const next =
        answer.action === 'raise' && answer.limit !== undefined && answer.limit > u
          ? answer.limit
          : Math.max(limit * 1.5, kind === 'toolCalls' ? u + 1 : u * 1.1)
      events.push({ t: 'budget.decided', action: answer.action, kind, limit: round(next) })
    }
    return { stop: false, events }
  }
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000
}
