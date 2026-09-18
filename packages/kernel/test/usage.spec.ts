/**
 * 用量汇总 —— PRD-M8-013 AC-1（按月、按模型聚合，只从事件投影）
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { monthOf, summarizeUsage } from '../src/index.ts'

const AUG = Date.UTC(2026, 7, 15, 9)
const SEP = Date.UTC(2026, 8, 10, 9)
let seq = 0
const ev = (ts: number, e: DomiEvent): EventEnvelope => {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts, schemaVersion: 11, ev: e }
}

const pricing = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75 },
}

function sessions() {
  seq = 0
  return [
    {
      id: 's1',
      events: [
        ev(AUG, { t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 1 }),
        ev(AUG, { t: 'user.input', text: '你好' }),
        ev(AUG, { t: 'tool.call', id: 'c', name: 'fs.read', args: {} }),
        ev(AUG, { t: 'permission', capabilityId: 'fs.write', decision: 'allow', source: 'user', matchedRule: null }),
        ev(AUG, { t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'config', matchedRule: 'r' }),
        ev(AUG, { t: 'model.usage', raw: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000 } }),
      ],
    },
    {
      id: 's2',
      events: [
        ev(SEP, { t: 'model.request', provider: 'openai-compatible', model: 'qwen3', tokensIn: 1 }),
        ev(SEP, { t: 'user.input', text: '再来' }),
        ev(SEP, { t: 'model.usage', raw: { input_tokens: 500, output_tokens: 100 } }),
      ],
    },
  ]
}

describe('PRD-M8-013 AC-1 · 只从事件投影，按模型与按月聚合', () => {
  const all = summarizeUsage(sessions(), { from: 0, to: Date.UTC(2026, 9, 1), pricing })

  test('合计：tokens、花费、会话数、轮数、工具调用、权限询问、cache 命中率', () => {
    expect(all.tokens).toEqual({ input: 1500, output: 300, cacheRead: 4000 })
    expect(all.sessions).toBe(2)
    expect(all.turns).toBe(2)
    expect(all.toolCalls).toBe(1)
    // 只数「问过人」的那次
    expect(all.asks).toBe(1)
    expect(all.cacheHitPercent).toBe(73)
    expect(all.costUsd).toBeCloseTo((1000 * 3 + 200 * 15 + 4000 * 0.3) / 1_000_000, 10)
  })

  test('价目表里没有的模型不计入花费，但点名出来', () => {
    expect(all.unpricedModels).toEqual(['qwen3'])
    const qwen = all.byModel.find((m) => m.model === 'qwen3')
    expect(qwen?.costUsd).toBeNull()
    expect(qwen?.provider).toBe('openai-compatible')
  })

  test('按月分桶，新的在前', () => {
    expect(all.byMonth.map((m) => m.month)).toEqual(['2026-09', '2026-08'])
    expect(all.byMonth[1]?.tokens.output).toBe(200)
    expect(monthOf(AUG)).toBe('2026-08')
  })

  test('窗口是左闭右开：只查 9 月就看不到 8 月的', () => {
    const sep = summarizeUsage(sessions(), { from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 9, 1), pricing })
    expect(sep.sessions).toBe(1)
    expect(sep.tokens.output).toBe(100)
    expect(sep.costUsd).toBeNull()
    expect(sep.asks).toBe(0)
  })

  test('空窗口是零，不是报错', () => {
    const none = summarizeUsage(sessions(), { from: 0, to: 1000, pricing })
    expect(none.sessions).toBe(0)
    expect(none.costUsd).toBeNull()
    expect(none.cacheHitPercent).toBeNull()
    expect(none.byModel).toEqual([])
  })

  test('会话中途换模型：换之后的用量算到新模型头上', () => {
    seq = 0
    const mixed = [
      {
        id: 's3',
        events: [
          ev(SEP, { t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 1 }),
          ev(SEP, { t: 'model.usage', raw: { input_tokens: 100, output_tokens: 10 } }),
          ev(SEP, { t: 'model.switch', from: 'claude-sonnet-4-5', to: 'claude-opus-4-1' }),
          ev(SEP, { t: 'model.usage', raw: { input_tokens: 200, output_tokens: 20 } }),
        ],
      },
    ]
    const r = summarizeUsage(mixed, { from: 0, to: Date.UTC(2026, 9, 1), pricing })
    expect(r.byModel.find((m) => m.model === 'claude-sonnet-4-5')?.tokens.output).toBe(10)
    expect(r.byModel.find((m) => m.model === 'claude-opus-4-1')?.tokens.output).toBe(20)
  })
})
