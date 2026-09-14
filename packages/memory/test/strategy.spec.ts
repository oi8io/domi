/**
 * 'clean' 上下文策略 —— PRD-M2-002 接进 kernel 的注册点 · ADR-005 · INV-02
 *
 * 判据不是「策略能跑」，是「**加这个策略没碰 kernel**」。
 * 前者随便写写就有，后者才是 PRD-M2-003 AC-6 要的那句话。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContext, listContextStrategies } from '@domi/kernel'
import type { EventEnvelope } from '@domi/protocol'
import { applyCleanup, registerCleanStrategy, STRATEGY_NAME } from '../src/index.ts'

function load(name: string): EventEnvelope[] {
  return readFileSync(join('fixtures', 'contexts', name), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('//'))
    .map((l) => JSON.parse(l) as EventEnvelope)
}

const POLICY = { maxTokens: 150_000, includeReasoning: false }

beforeAll(() => {
  registerCleanStrategy()
})

describe('注册与切换', () => {
  test("注册后 'clean' 出现在可用策略里", () => {
    expect(listContextStrategies()).toContain(STRATEGY_NAME)
  })

  test('注册是幂等的 —— 调两次不会多出一份', () => {
    registerCleanStrategy()
    expect(listContextStrategies().filter((s) => s === STRATEGY_NAME)).toHaveLength(1)
  })

  test('kernel 不认识「清理」这回事 —— 源码里搜不到', () => {
    const src = readFileSync(join('packages', 'kernel', 'src', 'build-context.ts'), 'utf8')
    expect(src).not.toContain('cleanup')
    expect(src).not.toContain(STRATEGY_NAME)
    expect(src).not.toContain('@domi/memory')
  })
})

describe('clean 与 full 的差别只在长度，不在形状', () => {
  const FILES = ['01-repeated-reads.jsonl', '02-verbose-test-output.jsonl', '10-long-session.jsonl']

  for (const f of FILES) {
    test(`${f}：消息条数与 role 序列完全一致`, () => {
      const events = load(f)
      const full = buildContext(events, { ...POLICY, strategy: 'full' })
      const clean = buildContext(events, { ...POLICY, strategy: STRATEGY_NAME })
      expect(clean.map((m) => m.role)).toEqual(full.map((m) => m.role))
      expect(clean).toHaveLength(full.length)
    })

    test(`${f}：clean 更短`, () => {
      const events = load(f)
      const full = JSON.stringify(buildContext(events, { ...POLICY, strategy: 'full' }))
      const clean = JSON.stringify(buildContext(events, { ...POLICY, strategy: STRATEGY_NAME }))
      expect(clean.length).toBeLessThan(full.length)
    })
  }

  test('工具消息的 toolCallId 一一对应 —— 配对乱了模型就读不懂了', () => {
    const events = load('10-long-session.jsonl')
    const full = buildContext(events, { ...POLICY, strategy: 'full' })
    const clean = buildContext(events, { ...POLICY, strategy: STRATEGY_NAME })
    const ids = (ms: typeof full): string[] =>
      ms.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId)
    expect(ids(clean)).toEqual(ids(full))
  })
})

describe('applyCleanup 不改事件流本身（INV-12）', () => {
  test('返回的是新数组，原数组一个字节没动', () => {
    const events = load('01-repeated-reads.jsonl')
    const before = JSON.stringify(events)
    const after = applyCleanup(events)
    expect(JSON.stringify(events)).toBe(before)
    expect(after).not.toBe(events)
    expect(after).toHaveLength(events.length)
    expect(after.map((e) => e.seq)).toEqual(events.map((e) => e.seq))
  })

  test('没被清理动过的事件是同一个对象引用 —— 不做无谓的拷贝', () => {
    const events = load('08-mixed-short.jsonl')
    const after = applyCleanup(events)
    for (const [i, e] of after.entries()) expect(e).toBe(events[i] as (typeof after)[number])
  })
})

describe('配错策略名不静默降级（PRD-M0-006 AC-4 仍然成立）', () => {
  test("拼错成 'cleen' 会抛错并列出可用策略", () => {
    expect(() => buildContext(load('08-mixed-short.jsonl'), { ...POLICY, strategy: 'cleen' })).toThrow(/cleen/)
  })
})
