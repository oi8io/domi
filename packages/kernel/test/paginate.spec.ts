/**
 * PRD-M11-009 · 会话窗口化加载（AC-1/2/3/4）· SPEC-M11-009
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { paginateByTurns, splitIntoTurns } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent, ts = 1_000): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts, schemaVersion: 3, ev }
}

/** 造 N 轮，每轮 user.input 文本长 textLen（≈ ceil(textLen/80) 行） */
function makeTurns(n: number, textLen: number): EventEnvelope[] {
  seq = 0
  const out: EventEnvelope[] = []
  for (let i = 0; i < n; i++) {
    out.push(env({ t: 'user.input', text: 'x'.repeat(textLen) }, 1_000 + i * 100))
    out.push(env({ t: 'model.request', provider: 'p', model: 'm', tokensIn: 1 }, 1_100 + i * 100))
    out.push(env({ t: 'model.delta', text: 'y'.repeat(textLen) }, 1_200 + i * 100))
  }
  return out
}

describe('splitIntoTurns', () => {
  test('按 user.input 切段；最老段允许没有 user.input', () => {
    const evs = [
      env({ t: 'session.kind', kind: 'task', cwd: '/x' }),
      env({ t: 'user.input', text: 'hi' }),
      env({ t: 'model.delta', text: 'yo' }),
      env({ t: 'user.input', text: 'again' }),
      env({ t: 'model.delta', text: 'yo2' }),
    ]
    const turns = splitIntoTurns(evs)
    expect(turns).toHaveLength(3)
    expect(turns[0]!.map((e) => e.ev.t)).toEqual(['session.kind'])
    expect(turns[1]!.map((e) => e.ev.t)).toEqual(['user.input', 'model.delta'])
    expect(turns[2]!.map((e) => e.ev.t)).toEqual(['user.input', 'model.delta'])
  })
})

describe('paginateByTurns', () => {
  test('AC-1：短会话总权重 < 预算 → 全量返回，hasOlder=false', () => {
    const evs = makeTurns(3, 80) // 每轮 2 行（user 1 + model 1），总 6 行
    const page = paginateByTurns(evs, { budget: { maxLines: 100 } })
    expect(page.events.length).toBe(evs.length)
    expect(page.fromSeq).toBe(1)
    expect(page.toSeq).toBe(evs.length)
    expect(page.hasOlder).toBe(false)
  })

  test('AC-1/3：长会话从尾部累加，到预算就停；不拆轮', () => {
    const evs = makeTurns(10, 80) // 每轮 2 行（user 1 + model 1）
    // 预算 3 行：尾部一轮 2 行 < 3，再加前一轮 2 行 = 4 > 3 → 只拿尾部 1 轮
    const page = paginateByTurns(evs, { budget: { maxLines: 3 } })
    // 尾部一轮 = 最后 3 个事件（user.input, model.request, model.delta）
    expect(page.events.length).toBe(3)
    expect(page.events[0]!.ev.t).toBe('user.input')
    expect(page.events[0]!.seq).toBe(evs.length - 2) // 第 9 轮的 user.input
    expect(page.hasOlder).toBe(true)
  })

  test('AC-4：最少 1 轮不白页——预算极小也至少返回最老的那轮', () => {
    const evs = makeTurns(5, 80)
    const page = paginateByTurns(evs, { budget: { maxLines: 0 } })
    expect(page.events.length).toBeGreaterThan(0)
    // 预算 0 → 循环条件 picked.length>0 不成立（第一次 picked 空），所以只拿最后一轮
    expect(page.events[0]!.ev.t).toBe('user.input')
  })

  test('AC-2：beforeSeq 锚点向上翻页——只取 seq < beforeSeq 的事件', () => {
    const evs = makeTurns(10, 80)
    // 首次窗口：尾部 2 轮（预算 4 行）
    const first = paginateByTurns(evs, { budget: { maxLines: 4 } })
    expect(first.events.length).toBe(6) // 2 轮 × 3 事件
    // 向上翻：beforeSeq = first.fromSeq - 1
    // 向上翻：beforeSeq = first.fromSeq（pool = seq < first.fromSeq，不含 first 的最老事件）
    const older = paginateByTurns(evs, { beforeSeq: first.fromSeq, budget: { maxLines: 4 } })
    expect(older.toSeq).toBeLessThan(first.fromSeq)
    // older 窗口和 first 窗口连续（中间不缺、不重叠）
    expect(older.toSeq + 1).toBe(first.fromSeq)
    // 还有更早的
    expect(older.hasOlder).toBe(true)
  })

  test('AC-2：翻到顶 hasOlder=false', () => {
    const evs = makeTurns(2, 80)
    const first = paginateByTurns(evs, { budget: { maxLines: 100 } })
    expect(first.hasOlder).toBe(false)
  })

  test('AC-3：budget.maxEvents 兜底——单轮超大也不超事件数', () => {
    const evs = makeTurns(3, 10_000) // 每轮约 250 行
    const page = paginateByTurns(evs, { budget: { maxLines: 100, maxEvents: 2 } })
    // maxEvents=2：尾部一轮有 3 事件，第一次 picked 空 → 塞进去 3 个（不拆轮），下一轮 3>2 停
    expect(page.events.length).toBe(3)
  })

  test('空会话：返回空页', () => {
    const page = paginateByTurns([], { budget: { maxLines: 100 } })
    expect(page.events).toEqual([])
    expect(page.hasOlder).toBe(false)
  })

  test('model.usage / model.request 不占行数（折叠类）', () => {
    const evs = [
      env({ t: 'user.input', text: 'hi' }),
      env({ t: 'model.request', provider: 'p', model: 'm', tokensIn: 1 }),
      env({ t: 'model.usage', raw: {} }),
      env({ t: 'fs.snapshot', path: '/x', phase: 'before', sha256: null, bytes: 0 }),
    ]
    // 预算 1 行：user.input 1 行就够了
    const page = paginateByTurns(evs, { budget: { maxLines: 1 } })
    // 整轮不拆：上面所有事件都是一轮
    expect(page.events.length).toBe(4)
  })
})
