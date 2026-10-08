/**
 * 状态栏的数要说真话 —— BUG-M13-002 / 002 / 003（PRD-M1-007 AC-1 / AC-2 · PRD-M8-008 AC-2）
 *
 * 现场：`s-1791118898468-cw7bg1`（deepseek-v4-pro，2 轮 53 步）状态栏显示
 * `2572.9k/47.1k tok · Cache hit 0% · ctx 100%`——
 * 2572.9k 是 53 次请求的输入累加，被当成了「当前上下文」；缓存一个都没读到；tok/s 的分母含工具时间。
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { aggregate, readUsage } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent, ts = 1_000): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts, schemaVersion: 15, ev }
}
const req = (ts: number): EventEnvelope =>
  env({ t: 'model.request', provider: 'deepseek', model: 'deepseek-v4-pro', tokensIn: 1 }, ts)

/** AI SDK 7 的 finish-step 透传形状（ai-sdk-provider.ts）：usage 里 inputTokens 是**含缓存的总输入** */
function aiSdk7(prompt: number, cached: number, output: number, providerRaw: Record<string, unknown> = {}) {
  return {
    usage: {
      inputTokens: prompt,
      inputTokenDetails: { noCacheTokens: prompt - cached, cacheReadTokens: cached },
      outputTokens: output,
      outputTokenDetails: { textTokens: output, reasoningTokens: 0 },
      totalTokens: prompt + output,
      raw: { prompt_tokens: prompt, completion_tokens: output, ...providerRaw },
    },
    providerMetadata: {},
    response: { id: 'r', modelId: 'deepseek-v4-pro' },
  }
}

describe('BUG-M13-003 · 各家 usage 归一：input = 没走缓存的输入，cacheRead = 缓存读，两者之和 = 这次请求的提示词', () => {
  test('AI SDK 7：inputTokens 含缓存，缓存读在 inputTokenDetails.cacheReadTokens', () => {
    expect(readUsage(aiSdk7(50_000, 48_000, 800))).toEqual({ input: 2_000, output: 800, cacheRead: 48_000 })
  })

  test('AI SDK 7 + DeepSeek：openai-compatible 只认 prompt_tokens_details，DeepSeek 原生的 prompt_cache_hit_tokens 要从 usage.raw 补', () => {
    const raw = aiSdk7(50_000, 0, 800, { prompt_cache_hit_tokens: 48_000, prompt_cache_miss_tokens: 2_000 })
    expect(readUsage(raw)).toEqual({ input: 2_000, output: 800, cacheRead: 48_000 })
  })

  test('AI SDK 5：cachedInputTokens，同样含在 inputTokens 里', () => {
    expect(readUsage({ usage: { inputTokens: 1_000, outputTokens: 10, cachedInputTokens: 600 } })).toEqual({
      input: 400,
      output: 10,
      cacheRead: 600,
    })
  })

  test('OpenAI 原生：prompt_tokens 含 prompt_tokens_details.cached_tokens', () => {
    expect(
      readUsage({ prompt_tokens: 1_000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 600 } }),
    ).toEqual({ input: 400, output: 10, cacheRead: 600 })
  })

  test('DeepSeek 原生：hit / miss 两个数', () => {
    expect(
      readUsage({
        prompt_tokens: 1_000,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 700,
        prompt_cache_miss_tokens: 300,
      }),
    ).toEqual({ input: 300, output: 10, cacheRead: 700 })
  })

  test('Anthropic 原生：input_tokens 不含缓存；缓存写也是这次的提示词，算进 input', () => {
    expect(
      readUsage({
        input_tokens: 100,
        cache_creation_input_tokens: 900,
        cache_read_input_tokens: 5_000,
        output_tokens: 10,
      }),
    ).toEqual({ input: 1_000, output: 10, cacheRead: 5_000 })
  })

  test('缓存命中率与花费跟着变真：缓存读按缓存价算，不再按全价', () => {
    seq = 0
    const evs = [req(1_000), env({ t: 'model.usage', raw: aiSdk7(1_000_000, 900_000, 0) }, 2_000)]
    const m = aggregate(evs, {
      pricing: { 'deepseek-v4-pro': { inputPer1M: 1, outputPer1M: 2, cacheReadPer1M: 0.1 } },
    })
    expect(m.cacheHitPercent).toBe(90)
    // 100k × $1 + 900k × $0.1 = $0.19；读错的时候是 1M × $1 = $1
    expect(m.costUsd).toBeCloseTo(0.19, 6)
  })
})

describe('BUG-M13-002 · ctx% = 最近一次请求的提示词 ÷ 窗口，不是全会话累计（PRD-M1-007 AC-2「占用」）', () => {
  function steps(): EventEnvelope[] {
    seq = 0
    return [
      env({ t: 'user.input', text: '改' }, 1_000),
      req(1_100),
      env({ t: 'model.usage', raw: aiSdk7(40_000, 30_000, 500) }, 2_000),
      req(2_100),
      env({ t: 'model.usage', raw: aiSdk7(50_000, 40_000, 500) }, 3_000),
      req(3_100),
      env({ t: 'model.usage', raw: aiSdk7(60_000, 50_000, 500) }, 4_000),
    ]
  }

  test('三步 40k / 50k / 60k：累计 150k 照常显示，占用只看最后一步的 60k', () => {
    const m = aggregate(steps(), { maxContextTokens: 150_000 })
    expect(m.tokens.input + m.tokens.cacheRead).toBe(150_000)
    expect(m.contextTokens).toBe(60_000)
    expect(m.contextPercent).toBe(40)
  })

  test('累计远超窗口（现场 2572.9k / 150k）也不会把占用顶成 100%', () => {
    seq = 0
    const evs: EventEnvelope[] = [env({ t: 'user.input', text: '改' }, 1_000)]
    for (let i = 0; i < 53; i++) {
      evs.push(req(2_000 + i * 10), env({ t: 'model.usage', raw: aiSdk7(48_000, 0, 900) }, 2_005 + i * 10))
    }
    const m = aggregate(evs, { maxContextTokens: 150_000 })
    expect(m.tokens.input).toBe(53 * 48_000)
    expect(m.contextPercent).toBe(32)
  })

  test('压缩之后、下一次请求之前：按压掉的量往下扣；下一次请求回来就以它为准', () => {
    const evs = steps()
    evs.push(
      env(
        {
          t: 'ctx.compact',
          fromSeq: 1,
          toSeq: 5,
          keptTurns: 1,
          tokensBefore: 45_000,
          tokensAfter: 5_000,
          trigger: 'manual',
          summary: {
            goal: '',
            userQuotes: [],
            files: [],
            errors: [],
            currentStep: '',
            intent: 'x',
            filesModified: [],
            keyDecisions: [],
            openQuestions: [],
            nextSteps: [],
          },
        } as DomiEvent,
        5_000,
      ),
    )
    expect(aggregate(evs, { maxContextTokens: 150_000 }).contextTokens).toBe(20_000)
    evs.push(req(6_000), env({ t: 'model.usage', raw: aiSdk7(22_000, 0, 10) }, 7_000))
    expect(aggregate(evs, { maxContextTokens: 150_000 }).contextTokens).toBe(22_000)
  })

  test('还没有任何用量：占用 0', () => {
    seq = 0
    expect(aggregate([env({ t: 'user.input', text: 'hi' })], { maxContextTokens: 150_000 }).contextTokens).toBe(0)
  })
})

describe('BUG-M13-004 · tok/s = 本轮输出 ÷ 本轮各步「请求发出 → 用量回来」之和，不含工具时间', () => {
  test('两步各 2s 生成、中间工具跑了 5s：400 tok ÷ 4s = 100，不是 ÷ 9s', () => {
    seq = 0
    const evs = [
      env({ t: 'user.input', text: '改' }, 500),
      req(1_000),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 200) }, 3_000),
      env({ t: 'tool.call', id: 'c', name: 'shell.exec', args: {} }, 3_000),
      env({ t: 'tool.result', id: 'c', ok: true, payload: {}, ms: 5_000 }, 8_000),
      req(8_000),
      env({ t: 'model.usage', raw: aiSdk7(1_200, 0, 200) }, 10_000),
    ]
    expect(aggregate(evs).tokPerSec).toBe(100)
  })

  test('单步的一轮也有速度（原来分母是 0，显示不出来）', () => {
    seq = 0
    const evs = [
      env({ t: 'user.input', text: 'hi' }, 0),
      req(1_000),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 300) }, 4_000),
    ]
    expect(aggregate(evs).tokPerSec).toBe(100)
  })

  test('只算最后一轮；进行中那一步还没有用量，不进分母', () => {
    seq = 0
    const evs = [
      env({ t: 'user.input', text: '一' }, 0),
      req(100),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 9_999) }, 200),
      env({ t: 'user.input', text: '二' }, 10_000),
      req(11_000),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 500) }, 16_000),
      req(16_100),
    ]
    expect(aggregate(evs, { now: 30_000 }).tokPerSec).toBe(100)
  })

  test('老会话：一步的事件同一批落盘、请求与用量同一个 ts —— 量不出来就是 null，不编一个数', () => {
    seq = 0
    const evs = [
      env({ t: 'user.input', text: 'hi' }, 0),
      req(5_000),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 300) }, 5_000),
      req(9_000),
      env({ t: 'model.usage', raw: aiSdk7(1_000, 0, 300) }, 9_000),
    ]
    expect(aggregate(evs).tokPerSec).toBeNull()
  })
})
