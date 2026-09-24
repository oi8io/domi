/**
 * 跨会话全文检索 —— PRD-M2-004 AC-1 / AC-3 / AC-4
 *
 * 「上次我们怎么解决那个 CORS 问题的」——这个问题只有事件流能回答，
 * 因为答案不在任何一个文件里，它在**当时那段对话**里。
 *
 * 三个设计决定：
 *
 * 1. **索引是派生数据。** 删掉 `events_fts` 重建即可，事件流才是真相（INV-01）。
 *    所以它不进 MIGRATIONS，跟着建库 DDL 无条件跑。
 * 2. **随 append 增量建索引**，不搞"用的时候再建"。后者第一次搜索要等几秒，
 *    而那正是人最没耐心的时刻。
 * 3. **每条结果都带 sessionId + seq**（AC-1 的原话）：搜到了要能跳回原始轨迹，
 *    否则搜索结果就是一段无法追溯的文本。
 */
import type { Database } from 'bun:sqlite'
import { type AnyEvent, isKnownEvent } from '@domi/protocol'

export interface SearchHit {
  sessionId: string
  seq: number
  type: string
  body: string
  /** bm25 分数。**越小越相关**（SQLite 的 bm25 返回负数） */
  score: number
}

export interface SearchOptions {
  limit?: number
  /** 只搜某个会话；不给就是跨全部会话 */
  sessionId?: string
}

/** 进上下文的四类事件之外，检索还要覆盖思考与错误——"上次那个报错"是真实问法 */
const INDEXED_TYPES = new Set([
  'user.input',
  'user.note',
  'model.delta',
  'model.reason',
  'tool.call',
  'tool.result',
  'error',
])

/** 事件的可检索文本。与轨迹的投影口径一致，但这里要的是**可搜到**，不是好看 */
export function searchableText(ev: AnyEvent): string | null {
  if (!isKnownEvent(ev)) return null
  switch (ev.t) {
    case 'user.input':
    case 'user.note':
    case 'model.delta':
    case 'model.reason':
      return ev.text
    case 'tool.call':
      return `${ev.name} ${JSON.stringify(ev.args)}`
    case 'tool.result':
      return typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)
    case 'error':
      return `${ev.scope} ${ev.message}`
    default:
      return null
  }
}

/** trigram 分词器的下限：查询串不足三个字符就匹配不到任何东西 */
export const TRIGRAM_MIN = 3

export class SearchRepo {
  constructor(private readonly db: Database) {}

  /** 增量建索引。只插入，从不改写已有行——和事件流同一条规矩 */
  index(sessionId: string, rows: ReadonlyArray<{ seq: number; type: string; ev: AnyEvent }>): number {
    const insert = this.db.query('INSERT INTO events_fts (session_id, seq, type, body) VALUES (?, ?, ?, ?)')
    let n = 0
    let maxSeq = this.indexedSeq(sessionId)
    for (const r of rows) {
      if (r.seq <= maxSeq) continue
      if (!INDEXED_TYPES.has(r.type)) {
        maxSeq = Math.max(maxSeq, r.seq)
        continue
      }
      const body = searchableText(r.ev)
      if (body === null || body === '') {
        maxSeq = Math.max(maxSeq, r.seq)
        continue
      }
      insert.run(sessionId, r.seq, r.type, body)
      maxSeq = Math.max(maxSeq, r.seq)
      n++
    }
    this.db
      .query(
        'INSERT INTO fts_progress (session_id, indexed_seq) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET indexed_seq = excluded.indexed_seq',
      )
      .run(sessionId, maxSeq)
    return n
  }

  indexedSeq(sessionId: string): number {
    const row = this.db
      .query<{ indexed_seq: number }, [string]>('SELECT indexed_seq FROM fts_progress WHERE session_id = ?')
      .get(sessionId)
    return row?.indexed_seq ?? 0
  }

  /**
   * 检索。查询串不足三个字符时降级成 LIKE 扫描——
   * trigram 匹配不到两个字的中文词，而「减号」「超时」这类问法真实存在。
   * 降级路径慢，但它只在短查询上发生，而短查询本来就少见。
   */
  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 20
    const q = query.trim()
    if (q === '') return []

    const scoped = opts.sessionId !== undefined
    if ([...q].length < TRIGRAM_MIN) {
      const sql =
        'SELECT session_id, seq, type, body, 0 AS score FROM events_fts' +
        ` WHERE body LIKE ?${scoped ? ' AND session_id = ?' : ''} ORDER BY seq DESC LIMIT ?`
      const args: unknown[] = [`%${q}%`]
      if (scoped) args.push(opts.sessionId)
      args.push(limit)
      return this.rows(sql, args)
    }

    const sql =
      'SELECT session_id, seq, type, body, bm25(events_fts) AS score FROM events_fts' +
      ` WHERE events_fts MATCH ?${scoped ? ' AND session_id = ?' : ''} ORDER BY score ASC LIMIT ?`
    const args: unknown[] = [quote(q)]
    if (scoped) args.push(opts.sessionId)
    args.push(limit)
    try {
      return this.rows(sql, args)
    } catch {
      // MATCH 语法错误（用户输入里带引号、星号之类）不该炸掉整次搜索
      return []
    }
  }

  private rows(sql: string, args: readonly unknown[]): SearchHit[] {
    const raw = this.db
      .query<{ session_id: string; seq: number; type: string; body: string; score: number }, never[]>(sql)
      .all(...(args as never[]))
    return raw.map((r) => ({ sessionId: r.session_id, seq: r.seq, type: r.type, body: r.body, score: r.score }))
  }
}

/** 把用户输入整体当成一个短语，避免 FTS5 把 `-` `*` `"` 当成语法 */
function quote(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}
