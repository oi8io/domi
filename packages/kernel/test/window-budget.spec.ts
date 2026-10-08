/**
 * PRD-M15-002 AC-2 · 窗口预算器（SPEC-M15-002 取舍-16）
 * - 有效窗口 = 窗口 − maxOutput − 13k 安全余量
 * - 占用 = 最近真实 usage 基准 + 增量估算（system / 工具定义 / 新事件）
 * - 阈值：均衡 60% 遮蔽 / 80% 压缩 / 92% 硬顶（任何档不降）
 */
import { describe, expect, test } from 'bun:test'
import { estimateTextTokens } from '@domi/protocol'
import {
  type BudgetLevel,
  COMPACT_AT,
  ContextLimitError,
  effectiveWindow,
  estimateIncrement,
  evaluate,
  HARD_CAP,
  MASK_AT,
  SAFETY_MARGIN,
} from '../src/index.ts'

describe('PRD-M15-002 AC-2 · 有效窗口', () => {
  test('有效窗口 = 窗口 − maxOutput − 13k 安全余量', () => {
    expect(effectiveWindow(128_000, 8_000)).toBe(128_000 - 8_000 - SAFETY_MARGIN)
    expect(effectiveWindow(200_000, 32_000)).toBe(200_000 - 32_000 - SAFETY_MARGIN)
    expect(SAFETY_MARGIN).toBe(13_000)
  })

  test('极小窗口防御：有效窗口不低于 4096', () => {
    expect(effectiveWindow(8_000, 8_000)).toBeGreaterThanOrEqual(4096)
  })
})

describe('PRD-M15-002 AC-2 · 阈值档位', () => {
  test('阈值常量：60% 遮蔽 / 80% 压缩 / 92% 硬顶', () => {
    expect(MASK_AT).toBe(0.6)
    expect(COMPACT_AT).toBe(0.8)
    expect(HARD_CAP).toBe(0.92)
  })

  test('档位判定：ok → mask → compact → hard', () => {
    expect(evaluate(0.5, 1)).toBe('ok' as BudgetLevel)
    expect(evaluate(0.6, 1)).toBe('mask' as BudgetLevel)
    expect(evaluate(0.75, 1)).toBe('mask' as BudgetLevel)
    expect(evaluate(0.8, 1)).toBe('compact' as BudgetLevel)
    expect(evaluate(0.9, 1)).toBe('compact' as BudgetLevel)
    expect(evaluate(0.92, 1)).toBe('hard' as BudgetLevel)
    expect(evaluate(1.0, 1)).toBe('hard' as BudgetLevel)
  })

  test('硬顶任何档不降：超过 92% 一律 hard', () => {
    expect(evaluate(0.93, 1)).toBe('hard' as BudgetLevel)
    expect(evaluate(2.0, 1)).toBe('hard' as BudgetLevel)
  })
})

describe('PRD-M15-002 AC-2 · 增量估算', () => {
  test('system / 工具定义 / 新事件按 estimateTextTokens 口径', () => {
    const system = '你是 domi，一个编码助手。'
    const tools = [{ name: 'fs.read', description: '读文件' }]
    const added = [{ role: 'user', content: '继续' }]
    const got = estimateIncrement(system, tools, added)
    const want =
      estimateTextTokens(system) + estimateTextTokens(JSON.stringify(tools)) + estimateTextTokens(JSON.stringify(added))
    expect(got).toBe(want)
  })

  test('空 system → 只算空数组的 JSON 开销（口径一致）', () => {
    expect(estimateIncrement('', [], [])).toBe(estimateTextTokens('[]') * 2)
  })
})

describe('PRD-M15-002 AC-4 · ContextLimitError', () => {
  test('可恢复、scope=context', () => {
    const e = new ContextLimitError('超窗')
    expect(e.recoverable).toBe(true)
    expect(e.scope).toBe('context')
    expect(e.message).toBe('超窗')
  })
})
