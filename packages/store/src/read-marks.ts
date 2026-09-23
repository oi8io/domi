/**
 * 已读位置 —— PRD-M8-009 AC-2 · SPEC-M8-009 取舍-8
 *
 * 每个会话一条「读到了自己的第几条事件」（自己的 seq，不是视图编号；视图编号由宿主换算）。
 * 未读 = 最后一条「回复类」事件晚于已读位置，且晚于最后一句用户输入（用户刚发出去、还没回的不算未读）。
 * 老库升级时一次性把所有会话标成已读（不然升级后满屏黄点），用 meta 里的一个标记保证只做一次。
 */
import type { Database } from 'bun:sqlite'

/** 算「有新东西可看」的事件类型：回答、工具结果、错误、计划、长任务结束 */
export const REPLY_TYPES = [
  'model.delta',
  'tool.result',
  'error',
  'plan.proposed',
  'plan.update',
  'task.end',
  'verify.required',
] as const

const BACKFILLED = 'read_marks_backfilled'

export interface ReadState {
  readSeq: number
  unread: boolean
}

export class ReadMarkRepo {
  constructor(private readonly db: Database) {}

  get(sessionId: string): number {
    return (
      this.db.query<{ seq: number }, [string]>('SELECT seq FROM read_marks WHERE session_id = ?').get(sessionId)?.seq ??
      0
    )
  }

  /** 只往前推，不往回退（两个客户端先后报的顺序可能乱）。返回是否真的推进了 */
  mark(sessionId: string, seq: number): boolean {
    if (seq <= this.get(sessionId)) return false
    this.db
      .query(
        `INSERT INTO read_marks (session_id, seq) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET seq = MAX(seq, excluded.seq)`,
      )
      .run(sessionId, seq)
    return true
  }

  /** 这些会话的已读状态 */
  states(ids: readonly string[]): Map<string, ReadState> {
    const out = new Map<string, ReadState>()
    if (ids.length === 0) return out
    // 类型是本文件里的常量，直接写进 SQL
    const types = REPLY_TYPES.map((t) => `'${t}'`).join(',')
    const q = this.db.query<
      { read_seq: number | null; last_reply: number | null; last_input: number | null },
      [string]
    >(
      `SELECT (SELECT seq FROM read_marks WHERE session_id = ?1) AS read_seq,
              (SELECT MAX(seq) FROM events WHERE session_id = ?1 AND type IN (${types})) AS last_reply,
              (SELECT MAX(seq) FROM events WHERE session_id = ?1 AND type = 'user.input') AS last_input`,
    )
    for (const id of ids) {
      const r = q.get(id)
      const read = r?.read_seq ?? 0
      const reply = r?.last_reply ?? 0
      out.set(id, { readSeq: read, unread: reply > read && reply > (r?.last_input ?? 0) })
    }
    return out
  }

  /** 升级后第一次启动：现有会话全部算已读。只做一次 */
  backfill(): number {
    const done = this.db.query<{ v: string }, [string]>('SELECT v FROM meta WHERE k = ?').get(BACKFILLED)
    if (done) return 0
    const r = this.db
      .query(
        `INSERT OR IGNORE INTO read_marks (session_id, seq)
         SELECT session_id, MAX(seq) FROM events GROUP BY session_id`,
      )
      .run()
    this.db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(BACKFILLED, '1')
    return r.changes
  }
}
