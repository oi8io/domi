/**
 * 会话管理 —— PRD-M1-006 · SPEC-M1-006
 *
 * 两个设计决定值得先说：
 *
 * **分支不复制事件。** 分支 = 新 sessionId + 指向源会话某个 seq 的 parent 链，
 * 读取时沿链拼接。复制的话「向一个分支追加不影响另一个」要靠纪律保证；
 * 不复制的话它是**结构上不可能**发生的——AC-3 因此自动成立。
 *
 * **删除是软的，事件一条不删。** INV-01 说事件只增不改，
 * 「用户删了个会话」不是删除事件的理由，只是不再列出来而已。
 */
import type { Database } from 'bun:sqlite'
import type { EventEnvelope } from '@domi/protocol'

export interface SessionRow {
  id: string
  createdAt: number
  updatedAt: number
  cwd: string
  title: string
  model: string
  deletedAt: number | null
  parentSessionId: string | null
  parentSeq: number | null
  /** 子 agent 会话：派生它的父会话（M5-001）。和分支的 parentSessionId 是两回事 */
  spawnedBy: string | null
  /** 自由会话 / 任务（M8-004）。null = 升级前的老会话，还没回填 */
  kind: SessionKind | null
  projectId: string | null
}

export type SessionKind = 'chat' | 'task'

export interface SessionSummary extends SessionRow {
  messageCount: number
  eventCount: number
  /** 本会话首条 user.input 前 40 字（列表空标题 fallback，SPEC-M10 取舍-2）。事件流是真相，这是读时算的派生值 */
  firstInput?: string
}

interface RawRow {
  id: string
  created_at: number
  updated_at: number
  cwd: string
  title: string
  model: string
  deleted_at: number | null
  parent_session_id: string | null
  parent_seq: number | null
  spawned_by: string | null
  kind?: string | null
  project_id?: string | null
  first_input?: string | null
}

function toRow(r: RawRow): SessionRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cwd: r.cwd,
    title: r.title,
    model: r.model,
    deletedAt: r.deleted_at,
    parentSessionId: r.parent_session_id,
    parentSeq: r.parent_seq,
    spawnedBy: r.spawned_by ?? null,
    kind: r.kind === 'chat' || r.kind === 'task' ? r.kind : null,
    projectId: r.project_id ?? null,
  }
}

export class SessionStoreError extends Error {}

export class SessionRepo {
  constructor(private readonly db: Database) {}

  upsert(s: Pick<SessionRow, 'id' | 'cwd'> & Partial<SessionRow>): void {
    const now = s.updatedAt ?? s.createdAt ?? 0
    this.db
      .query(
        `INSERT INTO sessions (id, created_at, updated_at, cwd, title, model, parent_session_id, parent_seq, spawned_by, kind, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           updated_at = excluded.updated_at,
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE sessions.title END,
           model = CASE WHEN excluded.model != '' THEN excluded.model ELSE sessions.model END`,
      )
      .run(
        s.id,
        s.createdAt ?? now,
        now,
        s.cwd,
        s.title ?? '',
        s.model ?? '',
        s.parentSessionId ?? null,
        s.parentSeq ?? null,
        s.spawnedBy ?? null,
        s.kind ?? null,
        s.projectId ?? null,
      )
  }

  get(id: string): SessionRow | null {
    const r = this.db.query<RawRow, [string]>('SELECT * FROM sessions WHERE id = ?').get(id)
    return r ? toRow(r) : null
  }

  /** 默认不列软删除的。includeDeleted 只给 `domi session restore` 用 */
  list(
    opts: {
      includeDeleted?: boolean
      titleLike?: string
      limit?: number
      includeSpawned?: boolean
      idPrefix?: string
      kind?: SessionKind
      projectId?: string
    } = {},
  ): SessionSummary[] {
    const where: string[] = []
    if (!opts.includeDeleted) where.push('s.deleted_at IS NULL')
    // 子 agent 的会话默认不列：它们从父会话的轨迹里点进去（M5-001 AC-4）
    if (!opts.includeSpawned) where.push('s.spawned_by IS NULL')
    if (opts.idPrefix) where.push("s.id LIKE ? || '%'")
    if (opts.kind) where.push('s.kind = ?')
    if (opts.projectId) where.push('s.project_id = ?')
    if (opts.titleLike) where.push("s.title LIKE '%' || ? || '%'")
    const sql = `
      SELECT s.*,
             (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
             (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'user.input') AS message_count,
             (SELECT substr(json_extract(e.payload, '$.text'), 1, 40) FROM events e
              WHERE e.session_id = s.id AND e.type = 'user.input' ORDER BY e.seq LIMIT 1) AS first_input
      FROM sessions s
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.updated_at DESC, s.created_at DESC
      LIMIT ?`
    const params: (string | number)[] = []
    if (opts.idPrefix) params.push(opts.idPrefix)
    if (opts.kind) params.push(opts.kind)
    if (opts.projectId) params.push(opts.projectId)
    if (opts.titleLike) params.push(opts.titleLike)
    params.push(opts.limit ?? 50)
    const rows = this.db
      .query<RawRow & { event_count: number; message_count: number }, never[]>(sql)
      .all(...(params as never[]))
    return rows.map((r) => ({ ...toRow(r), eventCount: r.event_count, messageCount: r.message_count, ...(r.first_input ? { firstInput: r.first_input } : {}) }))
  }

  /** 归类（M8-004）：新建时就定；老会话由宿主启动时回填 */
  setKind(id: string, kind: SessionKind, projectId: string | null): void {
    this.db.query('UPDATE sessions SET kind = ?, project_id = ? WHERE id = ?').run(kind, projectId, id)
  }

  /** 还没归类的老会话（M8-004 回填用）。只要 id 与 cwd */
  unclassified(): Array<{ id: string; cwd: string }> {
    return this.db.query<{ id: string; cwd: string }, []>('SELECT id, cwd FROM sessions WHERE kind IS NULL').all()
  }

  setTitle(id: string, title: string): void {
    this.db.query('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  /** 软删除。事件一条不删（INV-01） */
  softDelete(id: string, at: number): void {
    this.db.query('UPDATE sessions SET deleted_at = ? WHERE id = ?').run(at, id)
  }

  restore(id: string): void {
    this.db.query('UPDATE sessions SET deleted_at = NULL WHERE id = ?').run(id)
  }

  /**
   * 沿 parent 链回溯，返回从根到自己的读取计划。
   * 每个祖先只读到「它的子节点分叉出去的那个 seq」为止，自己读全部。
   */
  lineage(id: string): Array<{ id: string; upToSeq: number | null }> {
    const nodes: SessionRow[] = []
    const seen = new Set<string>()
    let cur = this.get(id)
    while (cur) {
      if (seen.has(cur.id)) throw new SessionStoreError(`会话父链成环：${cur.id}`)
      seen.add(cur.id)
      nodes.push(cur)
      cur = cur.parentSessionId ? this.get(cur.parentSessionId) : null
    }
    nodes.reverse() // 根 → 叶
    return nodes.map((n, i) => ({
      id: n.id,
      upToSeq: i < nodes.length - 1 ? (nodes[i + 1]?.parentSeq ?? null) : null,
    }))
  }
}

/** 把沿链读出来的事件重新编号成一条连续的流，供 buildContext 使用 */
export function flattenLineage(chunks: readonly EventEnvelope[][]): EventEnvelope[] {
  const out: EventEnvelope[] = []
  let seq = 0
  for (const chunk of chunks) {
    for (const e of chunk) {
      seq += 1
      out.push({ ...e, seq, parentSeq: seq > 1 ? seq - 1 : null })
    }
  }
  return out
}

/**
 * 相对时间 —— PRD-M1-006 AC-5。
 * 列表里显示相对时间（人一眼知道「刚才那个」是哪个），
 * 绝对时间留给详情，且带时区偏移（跨机器看日志时没有偏移就是猜）。
 */
export function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days <= 30) return `${days} 天前`
  return new Date(ts).toISOString().slice(0, 10)
}

/** 详情里的绝对时间：ISO-8601 带本地时区偏移 */
export function formatAbsolute(ts: number): string {
  const d = new Date(ts)
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const local = new Date(ts - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
