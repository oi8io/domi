/**
 * L3 语义记忆的投影 —— PRD-M4-001 · docs/adr/018
 *
 * 这里的表全是派生数据：真相是 `_memory` 会话里的 `memory.write{layer:'L3'}` 事件，
 * 由 SqliteEventLog.append 在**同一个事务里**投影过来（和全文索引同一个做法）。
 * embedding 是唯一不来自事件的列——它是算出来的缓存，丢了重算即可。
 */
import type { Database } from 'bun:sqlite'
import { type AnyEvent, isKnownEvent, type SemanticItem } from '@domi/protocol'

/** daemon 自己的记忆会话。下划线开头，不出现在会话列表里 */
export const MEMORY_SESSION_ID = '_memory'

export interface StoredItem extends SemanticItem {
  createdAt: number
  deletedAt: number | null
}

interface Row {
  id: string
  kind: SemanticItem['kind']
  text: string
  source_refs: string
  created_at: number
  deleted_at: number | null
}

function toItem(r: Row): StoredItem {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    sourceRefs: JSON.parse(r.source_refs) as SemanticItem['sourceRefs'],
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }
}

export class SemanticRepo {
  constructor(private readonly db: Database) {}

  /** 把一条事件投影进表。不是 L3 的 memory.write 就什么都不做 */
  apply(ev: AnyEvent, ts: number): void {
    if (!isKnownEvent(ev) || ev.t !== 'memory.write' || ev.layer !== 'L3') return
    if (ev.op === 'add' && ev.item) {
      const it = ev.item
      this.db
        .query(
          'INSERT INTO semantic_items (id, kind, text, source_refs, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        )
        .run(it.id, it.kind, it.text, JSON.stringify(it.sourceRefs), ts)
      this.db.query('INSERT INTO semantic_fts (id, body) VALUES (?, ?)').run(it.id, it.text)
    } else if (ev.op === 'delete' && ev.itemId) {
      this.db.query('UPDATE semantic_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, ev.itemId)
    } else if (ev.op === 'extracted' && ev.range) {
      this.db
        .query(
          `INSERT INTO memory_progress (session_id, extracted_seq) VALUES (?, ?)
           ON CONFLICT(session_id) DO UPDATE SET extracted_seq = MAX(extracted_seq, excluded.extracted_seq)`,
        )
        .run(ev.range.sessionId, ev.range.toSeq)
    }
  }

  get(id: string): StoredItem | null {
    const r = this.db.query<Row, [string]>('SELECT * FROM semantic_items WHERE id = ?').get(id)
    return r ? toItem(r) : null
  }

  list(opts: { includeDeleted?: boolean; kind?: SemanticItem['kind']; limit?: number } = {}): StoredItem[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (!opts.includeDeleted) where.push('deleted_at IS NULL')
    if (opts.kind) {
      where.push('kind = ?')
      args.push(opts.kind)
    }
    args.push(opts.limit ?? 500)
    return this.db
      .query<Row, never[]>(
        `SELECT * FROM semantic_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(...(args as never[]))
      .map(toItem)
  }

  /** 关键词检索。删掉的不返回（AC-3）。短查询降级成 LIKE，和 L2 同一个理由 */
  searchText(query: string, limit = 10): Array<StoredItem & { score: number }> {
    const q = query.trim()
    if (q === '') return []
    const short = [...q].length < 3
    const sql = short
      ? `SELECT s.*, 0 AS score FROM semantic_items s WHERE s.deleted_at IS NULL AND s.text LIKE ? LIMIT ?`
      : `SELECT s.*, bm25(semantic_fts) AS score FROM semantic_fts f JOIN semantic_items s ON s.id = f.id
         WHERE semantic_fts MATCH ? AND s.deleted_at IS NULL ORDER BY score ASC LIMIT ?`
    try {
      return this.db
        .query<Row & { score: number }, [string, number]>(sql)
        .all(short ? `%${q}%` : `"${q.replace(/"/g, '""')}"`, limit)
        .map((r) => ({ ...toItem(r), score: r.score }))
    } catch {
      return []
    }
  }

  /** 还没算 embedding（或是用别的模型算的）的条目 */
  missingEmbeddings(model: string, limit = 64): StoredItem[] {
    return this.db
      .query<Row, [string, number]>(
        'SELECT * FROM semantic_items WHERE deleted_at IS NULL AND (embedding IS NULL OR embed_model != ?) LIMIT ?',
      )
      .all(model, limit)
      .map(toItem)
  }

  setEmbedding(id: string, vec: Float32Array, model: string): void {
    this.db
      .query('UPDATE semantic_items SET embedding = ?, embed_model = ? WHERE id = ?')
      .run(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength), model, id)
  }

  /** 暴力余弦（ADR-018）。只比同一个模型算出来的向量 */
  searchVector(query: Float32Array, model: string, limit = 10): Array<StoredItem & { score: number }> {
    const rows = this.db
      .query<Row & { embedding: Uint8Array }, [string]>(
        'SELECT * FROM semantic_items WHERE deleted_at IS NULL AND embedding IS NOT NULL AND embed_model = ?',
      )
      .all(model)
    const qn = norm(query)
    return rows
      .map((r) => {
        const v = new Float32Array(
          r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength),
        )
        return { ...toItem(r), score: qn === 0 ? 0 : dot(query, v) / (qn * norm(v) || 1) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  extractedSeq(sessionId: string): number {
    return (
      this.db
        .query<{ extracted_seq: number }, [string]>('SELECT extracted_seq FROM memory_progress WHERE session_id = ?')
        .get(sessionId)?.extracted_seq ?? 0
    )
  }

  /** 投影坏了或者表被删了：清空重放 */
  rebuild(events: ReadonlyArray<{ ev: AnyEvent; ts: number }>): void {
    this.db.exec('DELETE FROM semantic_fts; DELETE FROM memory_progress;')
    const keep = new Map(
      this.db
        .query<{ id: string; embedding: Uint8Array | null; embed_model: string | null }, []>(
          'SELECT id, embedding, embed_model FROM semantic_items',
        )
        .all()
        .map((r) => [r.id, r]),
    )
    this.db.exec('DELETE FROM semantic_items')
    for (const e of events) this.apply(e.ev, e.ts)
    for (const [id, r] of keep) {
      if (r.embedding && r.embed_model) {
        this.db
          .query('UPDATE semantic_items SET embedding = ?, embed_model = ? WHERE id = ?')
          .run(r.embedding, r.embed_model, id)
      }
    }
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += (a[i] as number) * (b[i] as number)
  return s
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a))
}
