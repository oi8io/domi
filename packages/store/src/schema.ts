/**
 * 表结构 —— docs/spec/M0.md §4.1
 *
 * 本文件是**唯一**允许出现建表 SQL 的地方。
 * 注意：这里不允许出现任何针对 events 表的 UPDATE / DELETE
 * （PRD-M0-001 AC-3，由 scripts/check-append-only.ts 扫描阻断）。
 */
export const PRAGMAS = ['PRAGMA journal_mode = WAL', 'PRAGMA synchronous = NORMAL', 'PRAGMA foreign_keys = ON'] as const

export const DDL = `
CREATE TABLE IF NOT EXISTS events (
  session_id     TEXT    NOT NULL,
  seq            INTEGER NOT NULL,
  parent_seq     INTEGER,
  ts             INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  payload        TEXT    NOT NULL,
  PRIMARY KEY (session_id, seq)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_events_type ON events(session_id, type, seq);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  cwd        TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) STRICT;
`

/**
 * 迁移：**只允许补默认值、新增列、新增索引**（PRD-M2-007 AC-2）。
 * 禁止修改或删除既有事件字段——那会让旧数据读不出来，违反 INV-01。
 *
 * 每一项都必须幂等（重复跑不出错），因为崩溃恢复时会重跑。
 */
export interface Migration {
  toVersion: number
  statements: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    toVersion: 3,
    statements: [
      // M1-006 会话管理需要的列。ALTER TABLE ADD COLUMN 是新增，不是修改
      "ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE sessions ADD COLUMN deleted_at INTEGER',
      'ALTER TABLE sessions ADD COLUMN parent_session_id TEXT',
      'ALTER TABLE sessions ADD COLUMN parent_seq INTEGER',
      'ALTER TABLE sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0',
    ],
  },
]

export const META_SCHEMA_VERSION = 'schema_version'
