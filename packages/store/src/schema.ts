/**
 * 表结构 —— docs/spec/M0.md §4.1
 *
 * 本文件是**唯一**允许出现建表 SQL 的地方。
 * 注意：这里不允许出现任何针对 events 表的 UPDATE / DELETE
 * （PRD-M0-001 AC-3，由 scripts/check-append-only.ts 扫描阻断）。
 */
export const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
] as const

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

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) STRICT;
`

export const META_SCHEMA_VERSION = 'schema_version'
