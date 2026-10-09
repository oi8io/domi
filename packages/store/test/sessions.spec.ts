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

  test('按标题过滤（内容检索是另一回事，见 memory 的 episodic / PRD-M2-004）', async () => {
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

describe('PRD-M10-001 AC-2 · 列表空标题 fallback（first_input 派生列）', () => {
  const LONG = '帮我把这个项目里所有用到旧版配置格式的地方都找出来并且逐个迁移到新格式上去，注意保持向后兼容'

  test('空标题会话返回首条 user.input 前 40 字', async () => {
    const l = log()
    await l.append('a', [
      { t: 'user.input', text: LONG },
      { t: 'model.delta', text: 'ok' },
    ])
    const row = l.sessions.list().find((x) => x.id === 'a')!
    expect(row.firstInput).toBe(LONG.slice(0, 40))
    expect(row.title).toBe('')
    l.close()
  })

  test('有标题时 title 原样，firstInput 不受影响', async () => {
    const l = log()
    await l.append('a', [
      { t: 'user.input', text: '输入' },
      { t: 'model.delta', text: 'ok' },
    ])
    l.sessions.setTitle('a', '手动标题')
    const row = l.sessions.list().find((x) => x.id === 'a')!
    expect(row.title).toBe('手动标题')
    expect(row.firstInput).toBe('输入')
    l.close()
  })

  test('没有 user.input 的会话不产生 firstInput', async () => {
    const l = log()
    l.sessions.upsert({ id: 'b', cwd: '/tmp/b' })
    const row = l.sessions.list().find((x) => x.id === 'b')!
    expect(row.firstInput).toBeUndefined()
    l.close()
  })
})

describe('PRD-M8-002/009 · 会话列表排序（SPEC-M16-001）', () => {
  // log() 的 clock 每次调用 +1000，从 1_756_000_000_000 起：第一次 clock.now() = 1_756_000_001_000

  test('按最后一条消息倒序；lastMessageAt 值正确', async () => {
    const l = log()
    await l.append('a', [{ t: 'user.input', text: '一' }])
    await l.append('b', [{ t: 'user.input', text: '二' }])
    expect(l.sessions.list().map((s) => s.id)).toEqual(['b', 'a'])
    const a = l.sessions.list().find((x) => x.id === 'a')!
    const b = l.sessions.list().find((x) => x.id === 'b')!
    expect(a.lastMessageAt).toBe(1_756_000_001_000)
    expect(b.lastMessageAt).toBe(1_756_000_002_000)
    l.close()
  })

  test('非消息事件不改变排序与 lastMessageAt', async () => {
    const l = log()
    await l.append('a', [{ t: 'user.input', text: '一' }]) // t1
    await l.append('b', [{ t: 'user.input', text: '二' }]) // t2 → b 在前
    await l.append('a', [
      { t: 'tool.call', id: 'r1', name: 'fs.read', args: { path: 'x' } },
      { t: 'session.kind', kind: 'chat', cwd: '/tmp/work' },
      { t: 'model.request', provider: 'p', model: 'm', tokensIn: 1 },
    ]) // t3 全是非消息事件 → a 不应上升
    expect(l.sessions.list().map((s) => s.id)).toEqual(['b', 'a'])
    expect(l.sessions.list().find((x) => x.id === 'a')!.lastMessageAt).toBe(1_756_000_001_000)
    l.close()
  })

  test('user.note 与 model.delta 都算消息；多条 delta 取最后一条的落盘时间', async () => {
    const l = log()
    await l.append('a', [{ t: 'user.input', text: '一' }]) // t1
    await l.append('b', [{ t: 'user.input', text: '二' }]) // t2 → b 在前
    await l.append('a', [{ t: 'user.note', id: 'n1', text: '补一句' }]) // t3 → a 在前
    expect(l.sessions.list().map((s) => s.id)).toEqual(['a', 'b'])
    expect(l.sessions.list().find((x) => x.id === 'a')!.lastMessageAt).toBe(1_756_000_003_000)
    await l.append('b', [
      { t: 'model.delta', text: '片1' },
      { t: 'model.delta', text: '片2' },
    ]) // t4 → b 在前；取最后一条 delta 的落盘时间
    expect(l.sessions.list().map((s) => s.id)).toEqual(['b', 'a'])
    expect(l.sessions.list().find((x) => x.id === 'b')!.lastMessageAt).toBe(1_756_000_004_000)
    l.close()
  })

  test('同刻（相同 ts）按创建时间倒序', async () => {
    const d = mkdtempSync(join(tmpdir(), 'domi-sess-'))
    dirs.push(d)
    const l = new SqliteEventLog({ path: join(d, 'e.db'), cwd: '/tmp/work', clock: { now: () => 500 } })
    l.sessions.upsert({ id: 'a', cwd: '/tmp/work', createdAt: 100 })
    l.sessions.upsert({ id: 'b', cwd: '/tmp/work', createdAt: 200 })
    await l.append('a', [{ t: 'user.input', text: '一' }]) // ts=500
    await l.append('b', [{ t: 'user.input', text: '二' }]) // ts=500，同刻
    const rows = l.sessions.list().map((s) => ({ id: s.id, lm: s.lastMessageAt, created: s.createdAt }))
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']) // 同 ts → 创建晚的在前
    expect(rows[0]!.lm).toBe(500)
    expect(rows[0]!.created).toBe(200)
    l.close()
  })

  test('无消息会话按创建时间（lastMessageAt 回退创建时间）', async () => {
    const l = log()
    await l.append('a', [{ t: 'user.input', text: '早' }]) // t1
    await l.append('b', [{ t: 'session.kind', kind: 'chat', cwd: '/tmp/work' }]) // t2，无消息
    const rows = l.sessions.list().map((s) => ({ id: s.id, lm: s.lastMessageAt }))
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows[0]!.lm).toBe(1_756_000_002_000) // b：lastMessageAt === 创建时间
    expect(rows[1]!.lm).toBe(1_756_000_001_000)
    l.close()
  })

  test('存量 created_at=0 行：无消息时读时按首事件时间兜底（取舍-3）', async () => {
    const l = log()
    await l.append('a', [{ t: 'session.kind', kind: 'chat', cwd: '/tmp/work' }]) // t1
    ;(l as unknown as { db: { query(sql: string): { run(...a: unknown[]): void } } }).db
      .query('UPDATE sessions SET created_at = 0 WHERE id = ?')
      .run('a') // 模拟旧 daemon 创建（created_at=0）
    await l.append('b', [{ t: 'user.input', text: '二' }]) // t2
    const rows = l.sessions.list().map((s) => ({ id: s.id, lm: s.lastMessageAt }))
    expect(rows.find((r) => r.id === 'a')!.lm).toBe(1_756_000_001_000) // 兜底首事件时间
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    l.close()
  })

  test('upsert 不带时间戳：created_at/updated_at 是真实时钟（回归取舍-3）', async () => {
    const l = log()
    l.sessions.upsert({ id: 'b', cwd: '/tmp/b' })
    const row = l.sessions.get('b')!
    expect(row.createdAt).toBe(1_756_000_001_000)
    expect(row.updatedAt).toBe(1_756_000_001_000)
    l.close()
  })

  test('起标题/切模型的 upsert 不改变排序，也不再清零 updated_at（回归）', async () => {
    const l = log()
    await l.append('a', [{ t: 'user.input', text: '一' }]) // t1
    await l.append('b', [{ t: 'user.input', text: '二' }]) // t2 → b 在前
    l.sessions.upsert({ id: 'a', cwd: '/tmp/work', title: '标题' }) // t3
    l.sessions.upsert({ id: 'a', cwd: '/tmp/work', model: 'm2' }) // t4
    const rows = l.sessions.list()
    expect(rows.map((s) => s.id)).toEqual(['b', 'a'])
    const a = rows.find((x) => x.id === 'a')!
    expect(a.lastMessageAt).toBe(1_756_000_001_000)
    expect(a.updatedAt).toBeGreaterThan(0) // 此前 bug：updated_at 被清零
    l.close()
  })
})
