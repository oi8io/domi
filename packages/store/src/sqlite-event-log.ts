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
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { type AnyEvent, type DomiEvent, type EventEnvelope, parseEvent, SCHEMA_VERSION } from '@domi/protocol'
import { type AppendRange, type Clock, type EventLog, type ReadOpts, systemClock } from './event-log.ts'
import { ProjectRepo } from './projects.ts'
import { serializeRedacted } from './redact.ts'
import { DDL, META_SCHEMA_VERSION, MIGRATIONS, PRAGMAS } from './schema.ts'
import { SearchRepo } from './search.ts'
import { SemanticRepo } from './semantic.ts'
import { flattenLineage, SessionRepo } from './sessions.ts'

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
    // 首次运行时 ~/.domi 还不存在，SQLite 只会给一句 SQLITE_CANTOPEN。
    // 「第一次跑就崩」是最劝退的失败方式，所以父目录由我们建
    if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true })
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
    } else {
      // 新建库的 DDL 建的是最初的表结构，所以**无条件**跑一遍迁移。
      // 迁移是幂等的，重复跑不出错——这比「新建走一套、升级走另一套」可靠得多，
      // 后者意味着新建路径上的表结构永远没被迁移代码验证过。
      this.migrate(0, SCHEMA_VERSION)
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
    for (const m of MIGRATIONS) {
      if (m.toVersion <= from || m.toVersion > to) continue
      for (const sql of m.statements) {
        try {
          this.db.exec(sql)
        } catch (e) {
          // ALTER TABLE ADD COLUMN 在列已存在时报错 —— 迁移必须幂等，
          // 因为崩溃恢复时会重跑。只吞这一类，其余照抛
          if (!String(e).includes('duplicate column name')) throw e
        }
      }
    }
    this.db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(to))
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
      this.db.query('UPDATE sessions SET updated_at = ? WHERE id = ?').run(ts, sessionId)
      const base = maxSeq.get(sessionId)?.m ?? 0
      let prev: number | null = base > 0 ? base : null
      const indexable: Array<{ seq: number; type: string; ev: DomiEvent }> = []
      evs.forEach((ev, i) => {
        const seq = base + i + 1
        // 序列化+脱敏在事务内：任意一条失败 → 整批回滚（AC-4）
        const payload = serializeRedacted(ev)
        insertEvent.run(sessionId, seq, prev, ts, SCHEMA_VERSION, ev.t, payload)
        indexable.push({ seq, type: ev.t, ev })
        prev = seq
      })
      // 检索索引随写入增量建（PRD-M2-004）。放在同一个事务里，
      // 是因为「事件写进去了但搜不到」比「两者都没写」更难查
      this.search.index(sessionId, indexable)
      // L3 投影同理：事件写进去了、表里没有，比两者都没有更难查
      for (const r of indexable) if (r.type === 'memory.write') this.semantic.apply(r.ev, ts)
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

  /** 会话元数据仓库。事件与会话是两张表，但同一个连接同一个事务边界 */
  get projects(): ProjectRepo {
    return new ProjectRepo(this.db)
  }

  get sessions(): SessionRepo {
    return new SessionRepo(this.db)
  }

  /** L3 语义记忆的投影（PRD-M4-001）。派生数据，可从 _memory 会话重放 */
  get semantic(): SemanticRepo {
    return new SemanticRepo(this.db)
  }

  /** 全文检索索引（PRD-M2-004）。派生数据，删掉可重建 */
  get search(): SearchRepo {
    return new SearchRepo(this.db)
  }

  /**
   * 从某个 seq 分叉出新会话（PRD-M1-006 AC-3）。
   * **不复制事件** —— 新会话只存自己的新事件，读取时沿 parent 链拼接。
   * 所以「向一个分支追加不影响另一个」是结构上不可能发生的，不靠纪律。
   */
  async fork(fromSessionId: string, atSeq: number, newSessionId: string): Promise<void> {
    const parent = this.sessions.get(fromSessionId)
    if (!parent) throw new Error(`会话不存在：${fromSessionId}`)
    this.sessions.upsert({
      id: newSessionId,
      cwd: parent.cwd,
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
      title: `${parent.title || fromSessionId} 的分支 @${atSeq}`,
      model: parent.model,
      parentSessionId: fromSessionId,
      parentSeq: atSeq,
    })
  }

  /** 沿 parent 链读出完整历史并重新编号，供 buildContext 用 */
  async readLineage(sessionId: string): Promise<EventEnvelope[]> {
    const chain = this.sessions.lineage(sessionId)
    const chunks: EventEnvelope[][] = []
    for (const link of chain) {
      chunks.push(await this.read(link.id, link.upToSeq === null ? {} : { toSeq: link.upToSeq }))
    }
    return flattenLineage(chunks)
  }

  /**
   * 视图前缀的长度：祖先们一共贡献了多少条（TASK-M3-014）。
   * 祖先的那一段读到分叉点为止、之后再不会变，所以对一个会话来说这是常数——
   * 自己的第 n 条在视图里永远是第 offset+n 条
   */
  viewOffset(sessionId: string): number {
    const chain = this.sessions.lineage(sessionId)
    let n = 0
    for (const link of chain.slice(0, -1)) n += this.countUpTo(link.id, link.upToSeq)
    return n
  }

  /** 视图里的第 viewSeq 条，实际是哪个会话自己的第几条。越界返回 null */
  resolveViewSeq(sessionId: string, viewSeq: number): { sessionId: string; seq: number } | null {
    if (!Number.isInteger(viewSeq) || viewSeq < 1) return null
    let rest = viewSeq
    for (const link of this.sessions.lineage(sessionId)) {
      const rows = this.db
        .query<{ seq: number }, [string, number]>(
          'SELECT seq FROM events WHERE session_id = ? AND seq <= ? ORDER BY seq ASC',
        )
        .all(link.id, link.upToSeq ?? Number.MAX_SAFE_INTEGER)
      if (rest <= rows.length) return { sessionId: link.id, seq: rows[rest - 1]!.seq }
      rest -= rows.length
    }
    return null
  }

  private countUpTo(sessionId: string, upTo: number | null): number {
    return (
      this.db
        .query<{ n: number }, [string, number]>('SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND seq <= ?')
        .get(sessionId, upTo ?? Number.MAX_SAFE_INTEGER)?.n ?? 0
    )
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
