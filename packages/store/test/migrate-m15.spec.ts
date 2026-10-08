/**
 * PRD-M15-008 AC-2 · 内部会话泄漏迁移
 *
 * fixture 库：造一个 `_` 前缀会话，前几条是记忆事件（memory.write），
 * 后面混进用户事件（user.input / model.delta / tool.call）——这是 M4 之前的泄漏形态。
 * 断言：用户事件迁出到 migrated-<id> 普通会话、seq 原样保留、引用可解析、
 * 内部会话只剩记忆事件、幂等可重跑、迁移前有备份、纯记忆会话不动。
 */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateM15InternalSessions } from '../src/index.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-m15-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 同上：清理失败不该把好测试报成失败
    }
  }
})

/** 造 fixture 库：普通会话 + 泄漏的内部会话 + 纯记忆内部会话 */
function fixture(dir: string): string {
  const path = join(dir, 'events.db')
  const db = new Database(path, { create: true })
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      cwd TEXT NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL,
      parent_session_id TEXT, parent_seq INTEGER, spawned_by TEXT, kind TEXT, project_id TEXT
    ) STRICT;
    CREATE TABLE events (
      session_id TEXT NOT NULL, seq INTEGER NOT NULL, parent_seq INTEGER,
      ts INTEGER NOT NULL, schema_version INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    ) STRICT;
  `)
  db.query(
    'INSERT INTO sessions (id, created_at, updated_at, cwd, title, model, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('_memory', 1, 1, '/tmp', '记忆', 'm', 'chat')
  db.query(
    'INSERT INTO sessions (id, created_at, updated_at, cwd, title, model, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('s-ok', 1, 1, '/tmp', '正常会话', 'm', 'chat')
  db.query(
    'INSERT INTO sessions (id, created_at, updated_at, cwd, title, model, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('_pure', 1, 1, '/tmp', '纯记忆', 'm', 'chat')
  const ev = db.query(
    'INSERT INTO events (session_id, seq, parent_seq, ts, schema_version, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  // _memory：1-2 记忆事件，3-6 用户事件（泄漏）
  ev.run('_memory', 1, null, 1, 1, 'memory.write', '{}')
  ev.run('_memory', 2, null, 1, 1, 'memory.write', '{}')
  // 失败记录（error）不是用户事件，不该触发迁移起算
  ev.run('_memory', 3, null, 1, 1, 'error', '{"scope":"memory","message":"抽取失败","recoverable":true}')
  ev.run('_memory', 4, null, 1, 1, 'user.input', '{"text":"hi"}')
  ev.run('_memory', 5, 4, 1, 1, 'model.delta', '{"text":"ok"}')
  ev.run('_memory', 6, null, 1, 1, 'tool.call', '{"name":"fs.read"}')
  ev.run('_memory', 7, null, 1, 1, 'user.note', '{"id":"n1","text":"补充"}')
  // _pure：全是记忆事件
  ev.run('_pure', 1, null, 1, 1, 'memory.write', '{}')
  ev.run('_pure', 2, null, 1, 1, 'memory.write', '{}')
  db.close()
  return path
}

describe('PRD-M15-008 AC-2 · 泄漏迁移', () => {
  test('用户事件迁出成普通会话，内部会话只留记忆事件，seq 原样保留', () => {
    const path = fixture(tmp())
    const r = migrateM15InternalSessions({ dbPath: path })
    expect(r.changed).toBe(true)
    expect(r.migrated).toHaveLength(1)
    expect(r.migrated[0]?.from).toBe('_memory')
    expect(r.migrated[0]?.to).toBe('migrated-_memory')
    expect(r.migrated[0]?.cutoffSeq).toBe(4)
    expect(r.migrated[0]?.events).toBe(4)

    const db = new Database(path)
    const migrated = db
      .query<{ id: string; kind: string | null; title: string }, [string]>(
        'SELECT id, kind, title FROM sessions WHERE id = ?',
      )
      .get('migrated-_memory')
    expect(migrated?.kind).toBe('chat')
    expect(migrated?.title).toContain('迁移自 _memory')
    // 内部会话只留记忆事件
    const memTypes = db
      .query<{ type: string }, []>("SELECT type FROM events WHERE session_id = '_memory' ORDER BY seq")
      .all()
      .map((x) => x.type)
    // 记忆事件 + 失败记录都留在内部会话；用户事件迁走
    expect(memTypes).toEqual(['memory.write', 'memory.write', 'error'])
    // 新会话保留原 seq：3→6
    const moved = db
      .query<{ seq: number; type: string }, [string]>('SELECT seq, type FROM events WHERE session_id = ? ORDER BY seq')
      .all('migrated-_memory')
    expect(moved.map((x) => x.seq)).toEqual([4, 5, 6, 7])
    // 引用可解析：ctx.ref 指 {sessionId:'migrated-_memory', seq:4} 能取到
    expect(moved[1]?.type).toBe('model.delta')
    db.close()
  })

  test('幂等：重跑不重复迁，跳过已迁移会话', () => {
    const path = fixture(tmp())
    const r1 = migrateM15InternalSessions({ dbPath: path })
    const r2 = migrateM15InternalSessions({ dbPath: path })
    expect(r1.migrated).toHaveLength(1)
    expect(r2.migrated).toHaveLength(0)
    expect(r2.skipped.join()).toContain('migrated-_memory')
    expect(r2.changed).toBe(false)
    // 事件没有重复
    const db = new Database(path)
    const c = db
      .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM events WHERE session_id = 'migrated-_memory'")
      .get()?.c
    expect(c).toBe(4)
    db.close()
  })

  test('纯记忆会话不动；普通会话不受影响', () => {
    const path = fixture(tmp())
    const r = migrateM15InternalSessions({ dbPath: path })
    expect(r.skipped.join()).toContain('_pure')
    const db = new Database(path)
    const pure = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM events WHERE session_id = '_pure'").get()?.c
    expect(pure).toBe(2)
    const ok = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM events WHERE session_id = 's-ok'").get()?.c
    expect(ok).toBe(0)
    db.close()
  })

  test('迁移前自动备份 events.db 到 backups/pre-m15-migration-<ts>/', () => {
    const dir = tmp()
    const path = fixture(dir)
    const r = migrateM15InternalSessions({ dbPath: path })
    expect(r.backup).toBeTruthy()
    const bak = join(r.backup as string, 'events.db')
    expect(existsSync(bak)).toBe(true)
  })
})
