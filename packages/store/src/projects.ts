/**
 * 项目 —— PRD-M8-003 · SPEC-M8-003
 *
 * 项目是「一个目录 + 一个人认得的名字 + 几项设置」。任务按 sessions.project_id 归属。
 * 归档不删行（archived_at）：归档的项目下的任务照样能在全部会话里找到。
 */
import type { Database } from 'bun:sqlite'

export interface ProjectSettings {
  isolation: 'auto' | 'always' | 'never'
  /** 已废弃（PRD v1.14 划掉 M8-005 AC-3）：计划审批改由会话确认模式决定。旧数据照读，不再有人读它 */
  planReview: 'auto' | 'always' | 'never'
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { isolation: 'auto', planReview: 'auto' }

export interface ProjectRow {
  id: string
  name: string
  path: string
  createdAt: number
  archivedAt: number | null
  settings: ProjectSettings
}

export interface ProjectSummary extends ProjectRow {
  taskCount: number
  lastActivity: number | null
  recentTasks: Array<{ id: string; title: string; updatedAt: number; firstInput?: string }>
}

interface Raw {
  id: string
  name: string
  path: string
  created_at: number
  archived_at: number | null
  settings: string
}

function parseSettings(text: string): ProjectSettings {
  try {
    const v = JSON.parse(text) as Partial<ProjectSettings>
    const pick = <T extends string>(x: unknown, ok: readonly T[], d: T): T => (ok.includes(x as T) ? (x as T) : d)
    const modes = ['auto', 'always', 'never'] as const
    return {
      isolation: pick(v.isolation, modes, DEFAULT_PROJECT_SETTINGS.isolation),
      planReview: pick(v.planReview, modes, DEFAULT_PROJECT_SETTINGS.planReview),
    }
  } catch {
    return { ...DEFAULT_PROJECT_SETTINGS }
  }
}

function toRow(r: Raw): ProjectRow {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    settings: parseSettings(r.settings),
  }
}

export class ProjectRepo {
  constructor(private readonly db: Database) {}

  insert(p: { id: string; name: string; path: string; createdAt: number }): ProjectRow {
    this.db
      .query('INSERT INTO projects (id, name, path, created_at, settings) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.name, p.path, p.createdAt, JSON.stringify(DEFAULT_PROJECT_SETTINGS))
    return this.get(p.id) as ProjectRow
  }

  get(id: string): ProjectRow | null {
    const r = this.db.query<Raw, [string]>('SELECT * FROM projects WHERE id = ?').get(id)
    return r ? toRow(r) : null
  }

  byPath(path: string): ProjectRow | null {
    const r = this.db.query<Raw, [string]>('SELECT * FROM projects WHERE path = ?').get(path)
    return r ? toRow(r) : null
  }

  /** 全部项目（含归档），给归属判断用 */
  all(): ProjectRow[] {
    return this.db.query<Raw, []>('SELECT * FROM projects').all().map(toRow)
  }

  update(id: string, patch: { name?: string; settings?: Partial<ProjectSettings> }): ProjectRow | null {
    const cur = this.get(id)
    if (!cur) return null
    const name = patch.name ?? cur.name
    const settings = { ...cur.settings, ...(patch.settings ?? {}) }
    this.db.query('UPDATE projects SET name = ?, settings = ? WHERE id = ?').run(name, JSON.stringify(settings), id)
    return this.get(id)
  }

  setArchived(id: string, at: number | null): void {
    this.db.query('UPDATE projects SET archived_at = ? WHERE id = ?').run(at, id)
  }

  /** 列表：按最近活动（没有任务的按创建时间）倒序；每个项目带 recent 个最近的任务（不含已删除、子 agent） */
  list(opts: { includeArchived?: boolean; recent?: number } = {}): ProjectSummary[] {
    const rows = this.db
      .query<Raw & { task_count: number; last_activity: number | null }, []>(
        `SELECT p.*,
                (SELECT COUNT(*) FROM sessions s
                  WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.spawned_by IS NULL) AS task_count,
                (SELECT MAX(s.updated_at) FROM sessions s
                  WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS last_activity
         FROM projects p
         ${opts.includeArchived ? '' : 'WHERE p.archived_at IS NULL'}`,
      )
      .all()
    const recent = opts.recent ?? 5
    const recentQ = this.db.query<
      { id: string; title: string; updated_at: number; first_input: string | null },
      [string, number]
    >(
      `SELECT id, title, updated_at,
              (SELECT substr(json_extract(e.payload, '$.text'), 1, 40) FROM events e
               WHERE e.session_id = s.id AND e.type = 'user.input' ORDER BY e.seq LIMIT 1) AS first_input
       FROM sessions s
       WHERE project_id = ? AND deleted_at IS NULL AND spawned_by IS NULL
       ORDER BY updated_at DESC, created_at DESC LIMIT ?`,
    )
    return rows
      .map((r) => ({
        ...toRow(r),
        taskCount: r.task_count,
        lastActivity: r.last_activity,
        recentTasks:
          recent === 0
            ? []
            : recentQ.all(r.id, recent).map((t) => ({
                id: t.id,
                title: t.title,
                updatedAt: t.updated_at,
                ...(t.first_input ? { firstInput: t.first_input } : {}),
              })),
      }))
      .sort((a, b) => (b.lastActivity ?? b.createdAt) - (a.lastActivity ?? a.createdAt))
  }
}
