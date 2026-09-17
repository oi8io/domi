/**
 * 定时任务 —— PRD-M8-007 · SPEC-M8-007
 *
 * 一个计划 = 项目 + 目标 + cron + 时区。last_due 记最近一次处理过的应触发时刻（触发或跳过都算），
 * 补跑与防重复都靠它。删除是软删（deleted_at），历史运行还能查。
 */
import type { Database } from 'bun:sqlite'

export interface ScheduleRow {
  id: string
  projectId: string
  goal: string
  cron: string
  tz: string
  paused: boolean
  createdAt: number
  lastDue: number | null
}

export interface ScheduleRunRow {
  scheduleId: string
  due: number
  firedAt: number
  sessionId: string | null
  late: boolean
  skipped: boolean
}

interface Raw {
  id: string
  project_id: string
  goal: string
  cron: string
  tz: string
  paused: number
  created_at: number
  last_due: number | null
  deleted_at: number | null
}

interface RunRaw {
  schedule_id: string
  due: number
  fired_at: number
  session_id: string | null
  late: number
  skipped: number
}

const toRow = (r: Raw): ScheduleRow => ({
  id: r.id,
  projectId: r.project_id,
  goal: r.goal,
  cron: r.cron,
  tz: r.tz,
  paused: r.paused !== 0,
  createdAt: r.created_at,
  lastDue: r.last_due,
})

const toRun = (r: RunRaw): ScheduleRunRow => ({
  scheduleId: r.schedule_id,
  due: r.due,
  firedAt: r.fired_at,
  sessionId: r.session_id,
  late: r.late !== 0,
  skipped: r.skipped !== 0,
})

export class ScheduleRepo {
  constructor(private readonly db: Database) {}

  insert(s: { id: string; projectId: string; goal: string; cron: string; tz: string; createdAt: number }): ScheduleRow {
    this.db
      .query('INSERT INTO schedules (id, project_id, goal, cron, tz, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.id, s.projectId, s.goal, s.cron, s.tz, s.createdAt)
    return this.get(s.id) as ScheduleRow
  }

  /** 没删的 */
  get(id: string): ScheduleRow | null {
    const r = this.db.query<Raw, [string]>('SELECT * FROM schedules WHERE id = ? AND deleted_at IS NULL').get(id)
    return r ? toRow(r) : null
  }

  list(): ScheduleRow[] {
    return this.db
      .query<Raw, []>('SELECT * FROM schedules WHERE deleted_at IS NULL ORDER BY created_at')
      .all()
      .map(toRow)
  }

  update(id: string, patch: { goal?: string; cron?: string; tz?: string; paused?: boolean }): ScheduleRow | null {
    const cur = this.get(id)
    if (!cur) return null
    this.db
      .query('UPDATE schedules SET goal = ?, cron = ?, tz = ?, paused = ? WHERE id = ?')
      .run(patch.goal ?? cur.goal, patch.cron ?? cur.cron, patch.tz ?? cur.tz, (patch.paused ?? cur.paused) ? 1 : 0, id)
    return this.get(id)
  }

  /** 改了时间表或恢复时，从这一刻重新算，不补之前的 */
  setLastDue(id: string, due: number): void {
    this.db.query('UPDATE schedules SET last_due = ? WHERE id = ?').run(due, id)
  }

  delete(id: string, at: number): void {
    this.db.query('UPDATE schedules SET deleted_at = ? WHERE id = ?').run(at, id)
  }

  /** 记一次触发。同一时刻重复记（进程在写会话前崩了又补）以最后一次为准 */
  addRun(r: ScheduleRunRow): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO schedule_runs (schedule_id, due, fired_at, session_id, late, skipped)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(r.scheduleId, r.due, r.firedAt, r.sessionId, r.late ? 1 : 0, r.skipped ? 1 : 0)
  }

  runs(scheduleId: string, limit = 20): ScheduleRunRow[] {
    return this.db
      .query<RunRaw, [string, number]>(
        'SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY due DESC, fired_at DESC LIMIT ?',
      )
      .all(scheduleId, limit)
      .map(toRun)
  }

  /** 最近一次真的建了会话的触发（判断「上一次还没结束」用） */
  lastFired(scheduleId: string): ScheduleRunRow | null {
    const r = this.db
      .query<RunRaw, [string]>(
        'SELECT * FROM schedule_runs WHERE schedule_id = ? AND session_id IS NOT NULL ORDER BY fired_at DESC LIMIT 1',
      )
      .get(scheduleId)
    return r ? toRun(r) : null
  }
}
