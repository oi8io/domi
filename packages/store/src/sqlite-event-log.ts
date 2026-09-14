/**
 * SQLite 实现 —— TASK-M0-007 / SPEC-M0-001 / docs/spec/M0.md §4.1 §4.2
 *
 * 三个不显然的地方，改之前先读：
 *   1. seq 在**同一事务内**分配（SELECT MAX+1 → INSERT），靠 PRIMARY KEY 兜底。
 *      M0 是单进程；daemon 拆分（M3 / PRD-M3-004）时这里要换成真正的并发仲裁。
 *   2. 序列化放在事务**内部**。这样一批事件里任意一条序列化失败，整批回滚，
 *      磁盘上不会留半条（PRD-M0-001 AC-4）。挪到事务外会让这条 AC 变成假绿。
 *   3. read 走 parseEvent 的降级路径，永不抛"无法解析"（INV-01）。
 */
import { Database } from 'bun:sqlite'
import { type AnyEvent, type DomiEvent, type EventEnvelope, parseEvent, SCHEMA_VERSION } from '@domi/protocol'
import { type AppendRange, type Clock, type EventLog, type ReadOpts, systemClock } from './event-log.ts'
import { serializeRedacted } from './redact.ts'
import { DDL, META_SCHEMA_VERSION, PRAGMAS } from './schema.ts'

export interface SqliteEventLogOptions {
  /** 数据库文件路径；':memory:' 仅供不需要跨进程持久化的用例 */
  path: string
  clock?: Clock
  /** 默认 process.cwd()；store 不该猜，调用方给 */
  cwd?: string
}

interface EventRow {
  session_id: string
  seq: number
  parent_seq: number | null
  ts: number
  schema_version: number
  type: string
  payload: string
}

export class SqliteEventLog implements EventLog {
  private readonly db: Database
  private readonly clock: Clock
  private readonly cwd: string
  /** 磁盘版本高于代码版本时置位：只读打开并告警，不拒绝启动（INV-01 / §4.2） */
  readonly readOnlyFuture: boolean

  constructor(opts: SqliteEventLogOptions) {
    this.db = new Database(opts.path, { create: true })
    this.clock = opts.clock ?? systemClock
    this.cwd = opts.cwd ?? process.cwd()
    for (const p of PRAGMAS) this.db.exec(p)
    this.db.exec(DDL)

    const onDisk = this.diskSchemaVersion()
    this.readOnlyFuture = onDisk > SCHEMA_VERSION
    if (this.readOnlyFuture) {
      console.warn(
        `[domi/store] 数据库 schema_version=${onDisk} 高于本程序的 ${SCHEMA_VERSION}；` +
          `以只读方式打开。升级 domi 后即可写入。`,
      )
    } else if (onDisk < SCHEMA_VERSION) {
      this.migrate(onDisk, SCHEMA_VERSION)
    }
  }

  private diskSchemaVersion(): number {
    const row = this.db.query<{ v: string }, [string]>('SELECT v FROM meta WHERE k = ?').get(META_SCHEMA_VERSION)
    if (row) return Number(row.v)
    this.db.query('INSERT INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(SCHEMA_VERSION))
    return SCHEMA_VERSION
  }

  /**
   * 迁移只允许：补默认值、新增列、新增索引。
   * **禁止修改或删除既有事件字段**（PRD-M2-007 AC-2）。M0 无历史版本，是空实现。
   */
  private migrate(from: number, to: number): void {
    this.db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(to))
    void from
  }

  async append(sessionId: string, evs: DomiEvent[]): Promise<AppendRange> {
    if (this.readOnlyFuture) throw new Error('[domi/store] 数据库由更新版本的 domi 写入，本进程只读')
    if (evs.length === 0) {
      const head = await this.head(sessionId)
      return { from: head + 1, to: head }
    }

    const ts = this.clock.now()
    const insertSession = this.db.query(
      'INSERT INTO sessions (id, created_at, cwd) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
    )
    const maxSeq = this.db.query<{ m: number }, [string]>(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE session_id = ?',
    )
    const insertEvent = this.db.query(
      'INSERT INTO events (session_id, seq, parent_seq, ts, schema_version, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )

    const tx = this.db.transaction((): AppendRange => {
      insertSession.run(sessionId, ts, this.cwd)
      const base = maxSeq.get(sessionId)?.m ?? 0
      let prev: number | null = base > 0 ? base : null
      evs.forEach((ev, i) => {
        const seq = base + i + 1
        // 序列化+脱敏在事务内：任意一条失败 → 整批回滚（AC-4）
        const payload = serializeRedacted(ev)
        insertEvent.run(sessionId, seq, prev, ts, SCHEMA_VERSION, ev.t, payload)
        prev = seq
      })
      return { from: base + 1, to: base + evs.length }
    })

    return tx()
  }

  async read(sessionId: string, opts: ReadOpts = {}): Promise<EventEnvelope[]> {
    const from = opts.fromSeq ?? 1
    const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER
    const rows = this.db
      .query<EventRow, [string, number, number]>(
        'SELECT * FROM events WHERE session_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC',
      )
      .all(sessionId, from, to)

    return rows.map((r) => ({
      seq: r.seq,
      sessionId: r.session_id,
      parentSeq: r.parent_seq,
      ts: r.ts,
      schemaVersion: r.schema_version,
      ev: this.decode(r),
    }))
  }

  /** 解码永不抛错：JSON 坏了也降级成 UnknownEvent（INV-01） */
  private decode(r: EventRow): AnyEvent {
    let raw: unknown
    try {
      raw = JSON.parse(r.payload)
    } catch {
      return { t: r.type, __unparsed: r.payload, __schemaVersion: r.schema_version }
    }
    return parseEvent(raw, r.schema_version)
  }

  async head(sessionId: string): Promise<number> {
    return (
      this.db
        .query<{ m: number }, [string]>('SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE session_id = ?')
        .get(sessionId)?.m ?? 0
    )
  }

  close(): void {
    this.db.close(false)
  }
}
