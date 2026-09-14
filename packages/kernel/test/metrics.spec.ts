/**
 * PRD-M1-007 · 实时状态栏（AC-1/3/4）· SPEC-M1-007
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { aggregate, type ContextLevel, contextLevel, formatCost, type PricingTable } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent, ts = 1_000): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts, schemaVersion: 3, ev }
}

const PRICING: PricingTable = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
}

function session(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: 'hi' }, 1_000),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 3 }, 1_100),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: {} }, 1_200),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: {}, ms: 5 }, 1_300),
    env(
      { t: 'model.usage', raw: { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 500_000 } },
      1_400,
    ),
  ]
}

describe('AC-1 · 聚合结果', () => {
  test('token / 花费 / 工具次数 / 本轮耗时都从事件流算出来', () => {
    const m = aggregate(session(), { pricing: PRICING, maxContextTokens: 200_000 })
    expect(m.model).toBe('claude-sonnet-4-5')
    expect(m.provider).toBe('anthropic')
    expect(m.tokens).toEqual({ input: 1_000_000, output: 100_000, cacheRead: 500_000 })
    // 3 + 1.5 + 0.15
    expect(m.costUsd).toBeCloseTo(4.65, 6)
    expect(m.toolCalls).toBe(1)
    expect(m.turnMs).toBe(400)
  })

  test('各家 usage 字段名不同，读取时归一；事件流里存的仍是原文（ADR-004）', () => {
    seq = 0
    const camel = [
      env({ t: 'model.request', provider: 'p', model: 'claude-sonnet-4-5', tokensIn: 1 }),
      env({ t: 'model.usage', raw: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 50 } }),
    ]
    expect(aggregate(camel, { pricing: PRICING }).tokens).toEqual({ input: 100, output: 10, cacheRead: 50 })
  })

  test('model.switch 之后的用量算在新模型头上', () => {
    seq = 0
    const evs = [
      env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 1 }),
      env({ t: 'model.usage', raw: { input_tokens: 1_000_000 } }),
      env({ t: 'model.switch', from: 'claude-sonnet-4-5', to: '未知模型' }),
      env({ t: 'model.usage', raw: { input_tokens: 1_000_000 } }),
    ]
    const m = aggregate(evs, { pricing: PRICING })
    expect(m.model).toBe('未知模型')
    expect(m.tokens.input).toBe(2_000_000)
    // 只有切换前那一半能定价
    expect(m.costUsd).toBeCloseTo(3, 6)
    expect(m.unpricedModels).toEqual(['未知模型'])
  })
})

describe('AC-4 · 未知模型显示 —，且不参与累计', () => {
  test('完全没有可定价的用量时 costUsd 是 null，不是 0 也不是 NaN', () => {
    seq = 0
    const evs = [
      env({ t: 'model.request', provider: 'x', model: 'qwen-local', tokensIn: 1 }),
      env({ t: 'model.usage', raw: { input_tokens: 999 } }),
    ]
    const m = aggregate(evs, { pricing: PRICING })
    expect(m.costUsd).toBeNull()
    expect(Number.isNaN(m.costUsd as unknown as number)).toBe(false)
    expect(formatCost(m)).toBe('—')
    // token 照样统计 —— 不知道价钱不等于不知道用量
    expect(m.tokens.input).toBe(999)
    expect(m.unpricedModels).toEqual(['qwen-local'])
  })

  test('显示 0 会让人以为免费，比显示「不知道」更糟 —— 所以 formatCost 不返回 $0.0000', () => {
    seq = 0
    const m = aggregate([env({ t: 'model.usage', raw: { input_tokens: 1 } })], { pricing: PRICING })
    expect(formatCost(m)).not.toBe('$0.0000')
  })
})

describe('AC-2 · 上下文占用阈值', () => {
  test.each<[number, ContextLevel]>([
    [0, 'ok'],
    [69, 'ok'],
    [70, 'warn'],
    [89, 'warn'],
    [90, 'danger'],
    [100, 'danger'],
  ])('%i%% → %s', (pct, level) => {
    expect(contextLevel(pct)).toBe(level)
  })

  test('占用百分比按 input + cacheRead 算（输出不占下一轮的窗口）', () => {
    const m = aggregate(session(), { pricing: PRICING, maxContextTokens: 2_000_000 })
    expect(m.contextPercent).toBe(75)
    expect(contextLevel(m.contextPercent)).toBe('warn')
  })

  test('没给窗口大小时占用为 0，不瞎猜', () => {
    expect(aggregate(session()).contextPercent).toBe(0)
  })
})

describe('纯度', () => {
  test('同一输入两次调用结果 byte 级相同（不读时钟、不读随机）', () => {
    const evs = session()
    expect(JSON.stringify(aggregate(evs, { pricing: PRICING }))).toBe(
      JSON.stringify(aggregate(evs, { pricing: PRICING })),
    )
  })

  test('未知事件被跳过，不影响聚合（INV-01 的下游行为）', () => {
    const evs = [
      ...session(),
      {
        seq: 99,
        sessionId: 's',
        parentSeq: null,
        ts: 1_500,
        schemaVersion: 9,
        ev: { t: 'soul.evolve', __unparsed: {}, __schemaVersion: 9 },
      },
    ]
    expect(aggregate(evs, { pricing: PRICING }).tokens.input).toBe(1_000_000)
  })
})
