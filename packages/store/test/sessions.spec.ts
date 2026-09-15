/**
 * PRD-M1-006 · 会话管理（AC-2~5）· SPEC-M1-006
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent } from '@domi/protocol'
import { formatRelative, SqliteEventLog } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function log(now = 1_756_000_000_000): SqliteEventLog {
  const d = mkdtempSync(join(tmpdir(), 'domi-sess-'))
  dirs.push(d)
  let t = now
  return new SqliteEventLog({ path: join(d, 'e.db'), cwd: '/tmp/work', clock: { now: () => (t += 1000) } })
}

const turn = (n: number): DomiEvent[] => [
  { t: 'user.input', text: `第 ${n} 轮` },
  { t: 'model.delta', text: `回答 ${n}` },
]

describe('AC-2 · 恢复会话', () => {
  test('重开后读出的事件流与离开时深比较相等', async () => {
    const l = log()
    await l.append('a', turn(1))
    await l.append('a', turn(2))
    const before = await l.read('a')
    const path = (l as unknown as { db: { filename: string } }).db.filename

    l.close()
    const reopened = new SqliteEventLog({ path })
    expect(JSON.parse(JSON.stringify(await reopened.read('a')))).toEqual(JSON.parse(JSON.stringify(before)))
    reopened.close()
  })

  test('列表带上消息数与事件数', async () => {
    const l = log()
    await l.append('a', turn(1))
    await l.append('a', turn(2))
    l.sessions.setTitle('a', '修 sum.js')

    const [row] = l.sessions.list()
    expect(row?.title).toBe('修 sum.js')
    expect(row?.messageCount).toBe(2) // 两条 user.input
    expect(row?.eventCount).toBe(4)
    l.close()
  })

  test('按标题过滤（M1 只有列表与标题过滤，内容检索是 M2-004）', async () => {
    const l = log()
    await l.append('a', turn(1))
    await l.append('b', turn(1))
    l.sessions.setTitle('a', '修 sum.js')
    l.sessions.setTitle('b', '写文档')
    expect(l.sessions.list({ titleLike: 'sum' }).map((s) => s.id)).toEqual(['a'])
    l.close()
  })
})

describe('AC-3 · 分支', () => {
  test('从 seq 分叉后，向任一分支追加都不影响另一分支的事件集合', async () => {
    const l = log()
    await l.append('base', turn(1)) // seq 1,2
    await l.append('base', turn(2)) // seq 3,4

    await l.fork('base', 2, 'branch')
    await l.append('branch', [{ t: 'user.input', text: '分支上的新一轮' }])
    await l.append('base', [{ t: 'user.input', text: '主线上的新一轮' }])

    const baseEvents = await l.read('base')
    const branchEvents = await l.read('branch')

    // 分支自己只有它自己的事件 —— **没有复制**
    expect(branchEvents).toHaveLength(1)
    expect(baseEvents).toHaveLength(5)
    expect(JSON.stringify(baseEvents)).not.toContain('分支上的新一轮')
    expect(JSON.stringify(branchEvents)).not.toContain('主线上的新一轮')
    l.close()
  })

  test('沿链读出的历史 = 祖先的前半段 + 自己的全部，且 seq 重新编号后连续', async () => {
    const l = log()
    await l.append('base', turn(1)) // 1,2
    await l.append('base', turn(2)) // 3,4
    await l.fork('base', 2, 'branch')
    await l.append('branch', [{ t: 'user.input', text: '分支第一轮' }])

    const lineage = await l.readLineage('branch')
    expect(lineage.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(JSON.stringify(lineage)).toContain('第 1 轮')
    // 分叉点之后的主线内容不该出现在分支的历史里
    expect(JSON.stringify(lineage)).not.toContain('第 2 轮')
    expect(JSON.stringify(lineage)).toContain('分支第一轮')
    l.close()
  })

  test('TASK-M3-014 · 视图 seq 换算回「是谁的第几条」：分支的分支也对', async () => {
    const l = log()
    await l.append('base', turn(1)) // base 1,2
    await l.append('base', turn(2)) // base 3,4
    await l.fork('base', 3, 'b1') // b1 视图：base1..3 + 自己
    await l.append('b1', turn(3)) // b1 自己 1,2 → 视图 4,5
    await l.fork('b1', 2, 'b2') // fork 的 atSeq 是父会话**自己的** seq：b1 的第 2 条 = 视图第 5 条
    await l.append('b2', turn(4))

    expect(l.resolveViewSeq('b1', 2)).toEqual({ sessionId: 'base', seq: 2 })
    expect(l.resolveViewSeq('b1', 4)).toEqual({ sessionId: 'b1', seq: 1 })
    expect(l.resolveViewSeq('b2', 5)).toEqual({ sessionId: 'b1', seq: 2 })
    expect(l.resolveViewSeq('b2', 6)).toEqual({ sessionId: 'b2', seq: 1 })
    expect(l.resolveViewSeq('b2', 99)).toBeNull()
    expect(l.resolveViewSeq('b2', 0)).toBeNull()
    // 视图前缀的长度：祖先那一段有多少条
    expect(l.viewOffset('base')).toBe(0)
    expect(l.viewOffset('b1')).toBe(3)
    expect(l.viewOffset('b2')).toBe(5)
    expect((await l.readLineage('b2')).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
    l.close()
  })

  test('父链成环时报错而不是死循环', async () => {
    const l = log()
    await l.append('a', turn(1))
    await l.append('b', turn(1))

    // 正常 API 造不出环：upsert 不修改已存在会话的 parent 链（那是有意的）。
    // 成环只可能来自数据损坏或将来的某个 bug——所以这里直接改表模拟那种状态，
    // 因为这个守卫存在的理由就是「读到坏数据时别死循环」。
    const db = (l as unknown as { db: { query(sql: string): { run(...a: unknown[]): void } } }).db
    db.query('UPDATE sessions SET parent_session_id = ?, parent_seq = 1 WHERE id = ?').run('b', 'a')
    db.query('UPDATE sessions SET parent_session_id = ?, parent_seq = 1 WHERE id = ?').run('a', 'b')

    expect(() => l.sessions.lineage('a')).toThrow(/成环/)
    l.close()
  })
})

describe('AC-4 · 软删除', () => {
  test('删除后不在列表里，但事件一条不少，restore 能拿回来', async () => {
    const l = log()
    await l.append('a', turn(1))
    const before = await l.read('a')

    l.sessions.softDelete('a', 123)
    expect(l.sessions.list().map((s) => s.id)).not.toContain('a')
    expect(l.sessions.list({ includeDeleted: true }).map((s) => s.id)).toContain('a')
    // 事件一条不删（INV-01）
    expect(await l.read('a')).toEqual(before)

    l.sessions.restore('a')
    expect(l.sessions.list().map((s) => s.id)).toContain('a')
    l.close()
  })
})

describe('AC-5 · 时间展示', () => {
  test.each([
    [30_000, '刚刚'],
    [5 * 60_000, '5 分钟前'],
    [3 * 3_600_000, '3 小时前'],
    [2 * 86_400_000, '2 天前'],
  ])('%i ms 前 → %s', (ago, expected) => {
    const now = 1_756_000_000_000
    expect(formatRelative(now - ago, now)).toBe(expected)
  })

  test('超过 30 天退回绝对日期', () => {
    const now = 1_756_000_000_000
    expect(formatRelative(now - 40 * 86_400_000, now)).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
