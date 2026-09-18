/**
 * 定时任务 —— PRD-M8-007 AC-1 / AC-2 / AC-3 / AC-4
 *
 * cron 解析与下一次运行是纯函数；调度器注入假时钟与假定时器，
 * 断言「错过 5 个周期只补跑一次且 late」「上一个还没结束就跳过」这两条。
 */
import { describe, expect, test } from 'bun:test'
import type { ScheduleRow, ScheduleRunRow } from '@domi/store'
import { type CronError, nextRun, parseCron, previewCron, prevRun, Scheduler, scheduleNextRun } from '../src/index.ts'

const UTC = 'UTC'
const at = (y: number, m: number, d: number, h = 0, min = 0): number => Date.UTC(y, m - 1, d, h, min)

describe('PRD-M8-007 AC-1 · 5 段 cron，非法的如实拒绝并指出哪一段', () => {
  test('常见写法都算得对（含名字与步长）', () => {
    const base = at(2026, 9, 17, 10, 30)
    expect(nextRun(parseCron('*/15 * * * *'), UTC, base)).toBe(at(2026, 9, 17, 10, 45))
    expect(nextRun(parseCron('0 9 * * 1-5'), 'Asia/Shanghai', base)).toBe(at(2026, 9, 18, 1, 0))
    expect(nextRun(parseCron('0 0 1 jan *'), UTC, base)).toBe(at(2027, 1, 1))
    // 日与周都限定时取「或」（Vixie cron 的规矩）：13 号或周五
    expect(nextRun(parseCron('0 0 13 * 5'), UTC, base)).toBe(at(2026, 9, 18))
    expect(prevRun(parseCron('0 0 13 * 5'), UTC, base)).toBe(at(2026, 9, 13))
  })

  test('闰日只在闰年触发', () => {
    expect(nextRun(parseCron('0 12 29 2 *'), UTC, at(2026, 9, 17))).toBe(at(2028, 2, 29, 12))
  })

  test('非法表达式指出第几段、错在哪；永远不会触发的也拦下来', () => {
    const bad = (expr: string): CronError => {
      try {
        previewCron(expr, UTC, at(2026, 9, 17), 1)
      } catch (e) {
        return e as CronError
      }
      throw new Error(`${expr} 应该被拒绝`)
    }
    expect(bad('0 9 * *').field).toBe('expression')
    expect(bad('60 * * * *').message).toContain('第 1 段')
    expect(bad('0 25 * * *').field).toBe('hour')
    expect(bad('0 0 * * 8').field).toBe('weekday')
    expect(bad('*/0 * * * *').message).toContain('步长')
    expect(bad('0 0 30 2 *').message).toContain('永远不会触发')
    expect(bad('5-1 * * * *').message).toContain('反了')
  })

  test('时区认不出来也如实拒绝', () => {
    expect(() => previewCron('* * * * *', 'Mars/Base', 0, 1)).toThrow(/不认识的时区/)
  })

  test('预览给出接下来几次（界面显示下次运行时间）', () => {
    const runs = previewCron('0 9 * * 1-5', 'Asia/Shanghai', at(2026, 9, 17, 10, 30), 3)
    expect(runs).toHaveLength(3)
    expect(runs[0]).toBe(at(2026, 9, 18, 1))
    expect(runs[1]).toBe(at(2026, 9, 21, 1))
  })
})

/** 假的一张表：调度器只认这四个方法 */
function store(rows: ScheduleRow[]) {
  const runs: ScheduleRunRow[] = []
  return {
    runs,
    list: () => rows,
    get: (id: string) => rows.find((r) => r.id === id) ?? null,
    setLastDue: (id: string, due: number) => {
      const r = rows.find((x) => x.id === id)
      if (r) r.lastDue = due
    },
    addRun: (r: ScheduleRunRow) => {
      runs.push(r)
    },
    lastFired: (id: string) => [...runs].reverse().find((r) => r.scheduleId === id && r.sessionId !== null) ?? null,
  }
}

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: 'sch-1',
  projectId: 'p1',
  goal: '检查依赖更新',
  cron: '*/5 * * * *',
  tz: UTC,
  paused: false,
  createdAt: at(2026, 9, 17, 10, 0),
  lastDue: at(2026, 9, 17, 10, 0),
  ...over,
})

function scheduler(rows: ScheduleRow[], opts: { busy?: Set<string>; fire?: () => Promise<string> } = {}) {
  const s = store(rows)
  let clock = at(2026, 9, 17, 10, 2)
  const fired: Array<{ due: number; late: boolean }> = []
  let n = 0
  const sched = new Scheduler({
    store: s,
    now: () => clock,
    setTimer: () => () => undefined,
    isBusy: (id) => opts.busy?.has(id) === true,
    fire: async (_row, due, late) => {
      fired.push({ due, late })
      return opts.fire ? opts.fire() : `sess-${++n}`
    },
  })
  return {
    sched,
    s,
    fired,
    tick: async (ms: number) => {
      clock += ms
      await sched.tick()
    },
    now: () => clock,
  }
}

describe('PRD-M8-007 AC-2 / AC-3 · 到点建任务；错过多个周期只补一次；上一个没结束就跳过', () => {
  test('还没到点不触发', async () => {
    const { sched, fired } = scheduler([row()])
    await sched.start()
    expect(fired).toEqual([])
  })

  test('假时钟跳过 5 个周期 → 只触发 1 次，并且 late', async () => {
    const start = scheduler([row()])
    await start.sched.start()
    start.sched.stop()
    expect(start.fired).toEqual([])
    // 26 分钟后：10:05 / 10:10 / 10:15 / 10:20 / 10:25 都错过了
    const run = scheduler([row()])
    await run.tick(26 * 60_000)
    expect(run.fired).toHaveLength(1)
    expect(run.fired[0]?.due).toBe(at(2026, 9, 17, 10, 25))
    expect(run.fired[0]?.late).toBe(true)
    expect(run.s.runs).toHaveLength(1)
    expect(run.s.runs[0]).toMatchObject({ skipped: false, late: true, sessionId: 'sess-1' })
    expect(start.s.runs).toEqual([])
  })

  test('准点触发的不算 late', async () => {
    const run = scheduler([row()])
    await run.tick(3 * 60_000 + 30_000)
    expect(run.fired[0]?.late).toBe(false)
  })

  test('上一次的任务还在跑 → 记一条 skipped，不建新会话', async () => {
    const r = row()
    const run = scheduler([r])
    await run.tick(6 * 60_000)
    expect(run.fired).toHaveLength(1)
    const busy = scheduler([row()], { busy: new Set(['sess-1']) })
    busy.s.runs.push({
      scheduleId: 'sch-1',
      due: at(2026, 9, 17, 10, 0),
      firedAt: 0,
      sessionId: 'sess-1',
      late: false,
      skipped: false,
    })
    await busy.tick(6 * 60_000)
    expect(busy.fired).toEqual([])
    expect(busy.s.runs.at(-1)).toMatchObject({ skipped: true, sessionId: null })
  })

  test('暂停的计划不触发，也没有下一次运行时间', async () => {
    const paused = scheduler([row({ paused: true })])
    await paused.tick(60 * 60_000)
    expect(paused.fired).toEqual([])
    expect(scheduleNextRun(row({ paused: true }), at(2026, 9, 17, 10, 2))).toBeNull()
    expect(scheduleNextRun(row(), at(2026, 9, 17, 10, 2))).toBe(at(2026, 9, 17, 10, 5))
  })

  test('建会话失败时记一条没有会话的运行，不把这一刻重试一辈子', async () => {
    const run = scheduler([row()], {
      fire: () => Promise.reject(new Error('项目已归档')),
    })
    await run.tick(6 * 60_000)
    expect(run.s.runs.at(-1)).toMatchObject({ sessionId: null, skipped: false })
    await run.tick(60_000)
    expect(run.s.runs).toHaveLength(1)
  })
})

describe('PRD-M8-007 AC-4 · 立即运行', () => {
  test('runNow 不动 last_due，记一条运行', async () => {
    const r = row()
    const run = scheduler([r])
    const id = await run.sched.runNow('sch-1')
    expect(id).toBe('sess-1')
    expect(r.lastDue).toBe(at(2026, 9, 17, 10, 0))
    expect(run.s.runs.at(-1)).toMatchObject({ sessionId: 'sess-1', late: false, skipped: false })
  })

  test('上一次还在跑时 runNow 报忙', async () => {
    const run = scheduler([row()], { busy: new Set(['sess-1']) })
    run.s.runs.push({ scheduleId: 'sch-1', due: 0, firedAt: 0, sessionId: 'sess-1', late: false, skipped: false })
    expect(run.sched.runNow('sch-1')).rejects.toThrow(/还没结束/)
  })

  test('不存在的计划', async () => {
    const run = scheduler([])
    expect(run.sched.runNow('nope')).rejects.toThrow(/没有这个定时任务/)
  })
})
