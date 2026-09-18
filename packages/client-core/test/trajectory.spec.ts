/**
 * 轨迹投影 —— PRD-M8-008 AC-3（六类标签、按轮分组、时间线、过滤与搜索）
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { createSessionStore, filterTurns, trajectory } from '../src/index.ts'

let seq = 0
const T0 = 1_700_000_000_000
const env = (offsetMs: number, ev: DomiEvent): EventEnvelope => {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts: T0 + offsetMs, schemaVersion: 11, ev }
}

function sample() {
  seq = 0
  const s = createSessionStore()
  s.applyEvents([
    env(0, { t: 'mode.switch', to: 'plan', reason: '新任务先规划' }),
    env(100, { t: 'user.input', text: '帮我看看 dod 测试' }),
    env(2000, { t: 'model.reason', text: '先看' }),
    env(2600, { t: 'model.reason', text: '测试文件' }),
    env(3000, { t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'a.ts' } }),
    env(4200, { t: 'tool.result', id: 'c1', ok: true, payload: '内容', ms: 1200 }),
    env(4300, { t: 'permission', capabilityId: 'fs.write', decision: 'allow', source: 'user', matchedRule: null }),
    env(4400, { t: 'model.delta', text: '找到' }),
    env(5000, { t: 'model.delta', text: '原因了' }),
    env(5200, { t: 'user.input', text: '那就改吧' }),
    env(5300, { t: 'error', scope: 'loop', message: '模型超时', recoverable: true }),
  ])
  return s
}

describe('PRD-M8-008 AC-3 · 按轮分组、六类标签', () => {
  const { turns } = trajectory(sample().$items.get())

  test('按用户输入切轮；第一句话之前的运行时事件自成一组', () => {
    expect(turns).toHaveLength(3)
    expect(turns[0]?.rows.map((r) => r.tag)).toEqual(['context'])
    expect(turns[1]?.rows[0]?.tag).toBe('user')
    expect(turns[2]?.rows.map((r) => r.tag)).toEqual(['user', 'system'])
  })

  test('标签是六类里的：思考与回答都是 assistant，上下文事件是 context，错误是 system', () => {
    const tags = turns.flatMap((t) => t.rows.map((r) => r.tag))
    expect(new Set(tags)).toEqual(new Set(['context', 'user', 'assistant', 'tool', 'permission', 'system']))
  })

  test('工具结果并进调用那一行，带上耗时', () => {
    const tool = turns[1]?.rows.find((r) => r.tag === 'tool')
    expect(tool?.text).toContain('fs.read')
    expect(tool?.text).toContain('→')
    expect(tool?.ms).toBe(1200)
  })

  test('思考段带耗时（这一段流式增量的跨度）', () => {
    const think = turns[1]?.rows.find((r) => r.tag === 'assistant')
    expect(think?.text).toBe('先看测试文件')
    expect(think?.ms).toBe(600)
  })
})

describe('PRD-M8-008 AC-3 · Turns / Calls 过滤与搜索', () => {
  const { turns } = trajectory(sample().$items.get())

  test('Calls 只留工具行，空轮不出现', () => {
    const calls = filterTurns(turns, 'calls', '')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.rows.every((r) => r.tag === 'tool')).toBe(true)
  })

  test('搜索是包含匹配，不区分大小写', () => {
    expect(filterTurns(turns, 'turns', 'FS.read').flatMap((t) => t.rows)).toHaveLength(1)
    expect(filterTurns(turns, 'turns', '超时').flatMap((t) => t.rows)).toHaveLength(1)
    expect(filterTurns(turns, 'turns', '没有这个')).toEqual([])
  })
})

describe('PRD-M8-008 AC-3 · 时间线（输入 / 模型 / 工具三行）', () => {
  const { timeline } = trajectory(sample().$items.get())

  test('三行都有段，位置按时间戳落在 0–100 之间', () => {
    expect(timeline).not.toBeNull()
    const tl = timeline as NonNullable<typeof timeline>
    expect(tl.input.length).toBe(2)
    expect(tl.model.length).toBe(2)
    expect(tl.tools.length).toBe(1)
    for (const s of [...tl.input, ...tl.model, ...tl.tools]) {
      expect(s.left).toBeGreaterThanOrEqual(0)
      expect(s.left + s.width).toBeLessThanOrEqual(101)
      expect(s.width).toBeGreaterThan(0)
    }
  })

  test('工具那一段的宽度用结果里的耗时（1.2s ÷ 总跨度）', () => {
    const tl = timeline as NonNullable<typeof timeline>
    const total = tl.end - tl.start
    expect(tl.tools[0]?.width).toBeCloseTo((1200 / total) * 100, 5)
  })

  test('没有时间戳（老会话）就没有时间线，界面把 Duration 置灰', () => {
    expect(trajectory([{ seq: 1, kind: 'user', text: '你好' }]).timeline).toBeNull()
  })
})
