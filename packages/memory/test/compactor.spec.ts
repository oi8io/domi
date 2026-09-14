/**
 * PRD-M2-003 · LLM 压缩（保边压中 + 结构化摘要）· 守 INV-12
 *
 * 用例名与 AC 一一对应（PRD 验收方式原文指定）：
 *   triggers-at-threshold(AC-1) / preserves-edges-bytewise(AC-2) / summary-schema-valid(AC-3)
 *   / events-immutable(AC-4) / replay-equivalence(AC-5) / strategy-pluggable(AC-6)
 *
 * **AC-5 是核心断言。**
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { buildContext, listContextStrategies } from '@domi/kernel'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import {
  COMPACT_STRATEGY_NAME,
  compact,
  registerCompactStrategy,
  renderSummary,
  SummarySchema,
  SummaryShapeError,
  shouldCompact,
  TRIGGER_HIGH,
  TRIGGER_LOW,
  turnStarts,
} from '../src/index.ts'

const POLICY = { maxTokens: 150_000, includeReasoning: false }

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq++
  return {
    seq,
    sessionId: 's1',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 5,
    ev,
  }
}

/** 四轮对话：前两轮是背景，后两轮是正在做的事 */
function conversation(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '这个仓库是干什么的' }),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'README.md' } }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: 'domi 是一个本地优先的 agent 运行时', ms: 3 }),
    env({ t: 'model.delta', text: '这是一个 agent 运行时。' }),

    env({ t: 'user.input', text: '它的事件流为什么是 append-only' }),
    env({ t: 'model.delta', text: '因为要能重放。' }),

    env({ t: 'user.input', text: '把 sum.js 的减号改成加号' }),
    env({ t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'sum.js', content: 'a + b' } }),
    env({ t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 5 }, ms: 2 }),

    env({ t: 'user.input', text: '跑一下测试' }),
    env({ t: 'tool.call', id: 'c3', name: 'shell.exec', args: { cmd: 'bun test' } }),
    env({ t: 'tool.result', id: 'c3', ok: true, payload: '1 pass', ms: 900 }),
    env({ t: 'model.delta', text: '通过了。' }),
  ]
}

const GOOD_SUMMARY = {
  intent: '把 sum.js 的减号改成加号并让测试通过',
  filesModified: ['sum.js'],
  keyDecisions: ['先读再改，不凭记忆'],
  openQuestions: [],
  nextSteps: ['跑完整测试'],
}

const stubSummarizer = async (): Promise<unknown> => GOOD_SUMMARY

beforeAll(() => {
  registerCompactStrategy()
})

describe('triggers-at-threshold (AC-1)', () => {
  test('到窗口 70% 就该压；阈值区间的上限是 75%', () => {
    expect(TRIGGER_LOW).toBe(0.7)
    expect(TRIGGER_HIGH).toBe(0.75)
    expect(shouldCompact(69_999, 100_000)).toBe(false)
    expect(shouldCompact(70_000, 100_000)).toBe(true)
    expect(shouldCompact(80_000, 100_000)).toBe(true)
  })

  test('maxTokens 为 0 或负数时不触发，不是除零', () => {
    expect(shouldCompact(100, 0)).toBe(false)
    expect(shouldCompact(100, -1)).toBe(false)
  })

  test('手动触发（/compact）走同一条路径，只是 trigger 字段不同', async () => {
    const r = await compact(conversation(), { summarize: stubSummarizer, trigger: 'manual' })
    expect(r.event.trigger).toBe('manual')
    const auto = await compact(conversation(), { summarize: stubSummarizer })
    expect(auto.event.trigger).toBe('threshold')
    // 除了 trigger，两者产出完全一致 —— 手动不是另一套实现
    expect({ ...r.event, trigger: 'x' }).toEqual({ ...auto.event, trigger: 'x' })
  })
})

describe('preserves-edges-bytewise (AC-2)', () => {
  test('最近 N 轮逐字保留 —— byte 级未变', async () => {
    const events = conversation()
    const r = await compact(events, { summarize: stubSummarizer, keepTurns: 2 })
    // 四轮里保留后两轮：从第三个 user.input 开始
    const starts = turnStarts(events)
    const cut = starts[starts.length - 2] as number
    expect(JSON.stringify(r.kept)).toBe(JSON.stringify(events.slice(cut)))
  })

  test('system prompt 逐字保留 —— 它是 prompt cache 的前缀，动一下全场失效', async () => {
    const events = conversation()
    const r = await compact(events, { summarize: stubSummarizer, keepTurns: 2 })
    const withCompact = [...events, { ...env(r.event), seq: 99 }]
    const msgs = buildContext(withCompact, { ...POLICY, strategy: COMPACT_STRATEGY_NAME })
    // 拼装层不碰 system —— 提示词层在 @domi/prompt，压缩策略只处理事件
    expect(msgs.every((m) => m.role !== 'system')).toBe(true)
  })

  test('轮数不够时一条都不压 —— 压了也省不下什么，反而把正在做的事变模糊', async () => {
    seq = 0
    const short = [env({ t: 'user.input', text: '你好' }), env({ t: 'model.delta', text: '你好。' })]
    const r = await compact(short, { summarize: stubSummarizer, keepTurns: 2 })
    expect(r.covered).toHaveLength(0)
    expect(r.kept).toHaveLength(2)
  })

  test('中间历史确实被替换掉了，不是又塞了一遍', async () => {
    const events = conversation()
    const r = await compact(events, { summarize: stubSummarizer, keepTurns: 2 })
    const msgs = buildContext([...events, { ...env(r.event), seq: 99 }], {
      ...POLICY,
      strategy: COMPACT_STRATEGY_NAME,
    })
    const all = JSON.stringify(msgs)
    expect(all).toContain('结构化摘要')
    expect(all).not.toContain('这个仓库是干什么的') // 第一轮被摘要覆盖了
    expect(all).toContain('跑一下测试') // 最近两轮还在
  })
})

describe('summary-schema-valid (AC-3)', () => {
  test('五个固定字段齐全，经 zod 校验', () => {
    expect(SummarySchema.safeParse(GOOD_SUMMARY).success).toBe(true)
    expect(Object.keys(SummarySchema.shape).sort()).toEqual([
      'filesModified',
      'intent',
      'keyDecisions',
      'nextSteps',
      'openQuestions',
    ])
  })

  test('自由文本摘要被拒绝，不是"尽量解析"', async () => {
    await expect(compact(conversation(), { summarize: async () => '我们改了 sum.js' })).rejects.toThrow(
      SummaryShapeError,
    )
  })

  test('缺字段时报错说清楚缺哪个 —— 只说"格式不对"等于没说', async () => {
    try {
      await compact(conversation(), { summarize: async () => ({ intent: 'x' }) })
      throw new Error('本该抛错')
    } catch (e) {
      expect(e).toBeInstanceOf(SummaryShapeError)
      expect((e as SummaryShapeError).issues.join(' ')).toContain('filesModified')
    }
  })

  test('渲染出来的摘要自带"这不是新指令"的说明 —— 与注入防护同一条思路', () => {
    const text = renderSummary(GOOD_SUMMARY)
    expect(text).toContain('不是用户的新指令')
    expect(text).toContain('sum.js')
  })
})

describe('events-immutable (AC-4)', () => {
  test('压缩只产生一条 ctx.compact，原事件一条不少、内容哈希不变', async () => {
    const events = conversation()
    const hashBefore = events.map((e) => createHash('sha256').update(JSON.stringify(e)).digest('hex'))

    const r = await compact(events, { summarize: stubSummarizer })

    const hashAfter = events.map((e) => createHash('sha256').update(JSON.stringify(e)).digest('hex'))
    expect(hashAfter).toEqual(hashBefore) // 逐条哈希相同 —— 这是 INV-12 的判据
    expect(r.event.t).toBe('ctx.compact')

    // 事件表只增不减：压缩后的流 = 原流 + 1
    const after = [...events, { ...env(r.event), seq: 99 }]
    expect(after).toHaveLength(events.length + 1)
    expect(after.slice(0, events.length)).toEqual(events)
  })

  test('ctx.compact 能被当前 schema 解析 —— 它得进得了事件流', async () => {
    const { parseEvent, isKnownEvent } = await import('@domi/protocol')
    const r = await compact(conversation(), { summarize: stubSummarizer })
    const parsed = parseEvent(r.event)
    expect(isKnownEvent(parsed)).toBe(true)
    expect(parsed.t).toBe('ctx.compact')
  })

  test('在真实体量的会话上确实省下 token，且数字自洽', async () => {
    seq = 0
    // 前两轮塞进真实体量的工具输出——压缩本来就是给长会话用的
    const long = [
      env({ t: 'user.input', text: '看看测试为什么挂' }),
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'bun test' } }),
      env({ t: 'tool.result', id: 'c1', ok: false, payload: 'x'.repeat(4000), ms: 3000 }),
      env({ t: 'user.input', text: '那修一下' }),
      env({ t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'a.ts', content: 'y'.repeat(2000) } }),
      env({ t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 2000 }, ms: 4 }),
      env({ t: 'user.input', text: '再跑' }),
      env({ t: 'tool.result', id: 'c3', ok: true, payload: '1 pass', ms: 900 }),
      env({ t: 'user.input', text: '好了' }),
    ]
    const r = await compact(long, { summarize: stubSummarizer, keepTurns: 2 })
    expect(r.event.tokensAfter).toBeLessThan(r.event.tokensBefore)
    expect(r.event.fromSeq).toBeLessThanOrEqual(r.event.toSeq)
  })

  test('短会话压了反而更大 —— 这不是 bug，是为什么要有阈值门', async () => {
    // 摘要本身也要花 token。会话短到一定程度，摘要比被摘的内容还长。
    // 拦住这种情况的是 AC-1 的阈值（到窗口 70% 才压），不是压缩函数自己。
    // 把它写成测试，是为了让"看起来数字不对"的那天有人能读到这段话
    const r = await compact(conversation(), { summarize: stubSummarizer })
    expect(r.event.tokensAfter).toBeGreaterThan(r.event.tokensBefore)
    expect(shouldCompact(r.event.tokensBefore, 150_000)).toBe(false)
  })
})

describe('replay-equivalence (AC-5) —— 核心断言', () => {
  test('压缩后从原始事件流重放，与压缩前深比较相等', async () => {
    const events = conversation()
    const before = buildContext(events, { ...POLICY, strategy: 'full' })

    const r = await compact(events, { summarize: stubSummarizer })
    const withCompact = [...events, { ...env(r.event), seq: 99 }]

    // 关键：用 **full** 策略从**原始事件流**重放。ctx.compact 不进上下文（它是轨迹事件），
    // 所以结果必须和压缩前一模一样。压缩没有改写任何历史，这是免费得到的
    const after = buildContext(withCompact, { ...POLICY, strategy: 'full' })
    expect(after).toEqual(before)
  })

  test('压缩两次也一样 —— 重放永远回到同一个原始状态', async () => {
    const events = conversation()
    const before = buildContext(events, { ...POLICY, strategy: 'full' })
    const r1 = await compact(events, { summarize: stubSummarizer })
    const r2 = await compact(events, { summarize: stubSummarizer })
    const withBoth = [...events, { ...env(r1.event), seq: 98 }, { ...env(r2.event), seq: 99 }]
    expect(buildContext(withBoth, { ...POLICY, strategy: 'full' })).toEqual(before)
  })

  test('压缩视图与重放视图是两个东西，不该相等 —— 否则压缩没生效', async () => {
    const events = conversation()
    const r = await compact(events, { summarize: stubSummarizer })
    const withCompact = [...events, { ...env(r.event), seq: 99 }]
    const replayed = buildContext(withCompact, { ...POLICY, strategy: 'full' })
    const compacted = buildContext(withCompact, { ...POLICY, strategy: COMPACT_STRATEGY_NAME })
    expect(compacted).not.toEqual(replayed)
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(replayed).length)
  })
})

describe('strategy-pluggable (AC-6)', () => {
  test("注册后 'compact' 出现在可用策略里", () => {
    expect(listContextStrategies()).toContain(COMPACT_STRATEGY_NAME)
  })

  test('加这个策略，packages/kernel 一行没改 —— 源码里搜不到它', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join('packages', 'kernel', 'src', 'build-context.ts'), 'utf8')
    expect(src).not.toContain('compact')
    expect(src).not.toContain('@domi/memory')
  })

  test('没有 ctx.compact 事件时，compact 策略等同于 full —— 退化要干净', () => {
    const events = conversation()
    expect(buildContext(events, { ...POLICY, strategy: COMPACT_STRATEGY_NAME })).toEqual(
      buildContext(events, { ...POLICY, strategy: 'full' }),
    )
  })

  test('压缩策略本身不调用模型、不联网 —— 它只是把已发生的压缩投影出来', () => {
    const original = globalThis.fetch
    let called = 0
    globalThis.fetch = (() => {
      called++
      throw new Error('拼装上下文不许联网')
    }) as unknown as typeof globalThis.fetch
    try {
      buildContext(conversation(), { ...POLICY, strategy: COMPACT_STRATEGY_NAME })
      expect(called).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})
