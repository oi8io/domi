/**
 * PRD-M2-007 AC-3 · 迁移前自动备份；迁移失败自动回滚到备份
 *
 * 迁移是**唯一**会碰用户既有数据的操作。别处出错最多是这一次失败，
 * 这里出错是几个月的会话记录没了。所以这组测试的重点全在失败路径上。
 */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCHEMA_VERSION } from '@domi/protocol'
import { META_SCHEMA_VERSION, migrateDatabase, SqliteEventLog } from '../src/index.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-migrate-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载没有删除权限时不该把一个本身是好的测试报成失败
    }
  }
})

/** 造一个停在旧版本的库：先正常建库，再把 meta 里的版本号改回去 */
function oldDb(dir: string, version: number): string {
  const path = join(dir, 'events.db')
  const log = new SqliteEventLog({ path })
  log.close()
  const db = new Database(path)
  db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(version))
  db.close()
  return path
}

describe('AC-3 · 备份', () => {
  test('迁移前先复制一份，备份文件与原库 byte 级相同', () => {
    const dir = tmp()
    const path = oldDb(dir, 1)
    const before = readFileSync(path)

    const r = migrateDatabase({ dbPath: path, now: () => 1_700_000_000_000 })
    expect(r.backup).not.toBeNull()
    expect(existsSync(r.backup as string)).toBe(true)
    expect(readFileSync(r.backup as string).equals(before)).toBe(true)
  })

  test('没东西可迁移时不留垃圾备份', () => {
    const dir = tmp()
    const path = oldDb(dir, SCHEMA_VERSION)
    const r = migrateDatabase({ dbPath: path })
    expect(r.backup).toBeNull()
    expect(r.applied).toBe(0)
    expect(r.message).toContain('已经是最新')
  })

  test('磁盘版本比程序新时不动它 —— 降级写入是数据损坏的经典来源', () => {
    const dir = tmp()
    const path = oldDb(dir, SCHEMA_VERSION + 5)
    const r = migrateDatabase({ dbPath: path })
    expect(r.backup).toBeNull()
    expect(r.message).toContain('高于本程序')
  })

  test('库文件不存在时给一句人话，不抛异常', () => {
    const r = migrateDatabase({ dbPath: join(tmp(), 'nope.db') })
    expect(r.rolledBack).toBe(false)
    expect(r.message).toContain('没有数据库文件')
  })
})

describe('AC-3 · 失败回滚', () => {
  test('迁移中途失败 → 库被原样还原，备份不删', () => {
    const dir = tmp()
    const path = oldDb(dir, 1)
    const before = readFileSync(path)

    const r = migrateDatabase({
      dbPath: path,
      now: () => 1_700_000_000_001,
      migrations: [
        {
          toVersion: 2,
          statements: [
            "ALTER TABLE sessions ADD COLUMN ok_col TEXT NOT NULL DEFAULT ''", // 这条会成功
            'ALTER TABLE 这个表不存在 ADD COLUMN x TEXT', // 这条必炸
          ],
        },
      ],
      target: 2,
    })

    expect(r.rolledBack).toBe(true)
    expect(r.message).toContain('已从备份回滚')
    // 判据是 byte 级还原 —— 「大概回去了」不算
    expect(readFileSync(path).equals(before)).toBe(true)
    // 备份留着：出了事要能拿着它找人看
    expect(existsSync(r.backup as string)).toBe(true)
  })

  test('回滚之后那条半途成功的列也没了 —— 不许留半个迁移', () => {
    const dir = tmp()
    const path = oldDb(dir, 1)
    migrateDatabase({
      dbPath: path,
      migrations: [
        {
          toVersion: 2,
          statements: [
            "ALTER TABLE sessions ADD COLUMN half TEXT NOT NULL DEFAULT ''",
            'ALTER TABLE nope ADD COLUMN x TEXT',
          ],
        },
      ],
      target: 2,
    })
    const db = new Database(path)
    const cols = db
      .query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all()
      .map((c) => c.name)
    db.close()
    expect(cols).not.toContain('half')
  })

  test('版本号也回滚了 —— 不许记着一个没真正发生的迁移', () => {
    const dir = tmp()
    const path = oldDb(dir, 1)
    migrateDatabase({
      dbPath: path,
      migrations: [{ toVersion: 2, statements: ['ALTER TABLE nope ADD COLUMN x TEXT'] }],
      target: 2,
    })
    const db = new Database(path)
    const v = db.query<{ v: string }, [string]>('SELECT v FROM meta WHERE k = ?').get(META_SCHEMA_VERSION)
    db.close()
    expect(Number(v?.v)).toBe(1)
  })
})

describe('AC-3 · 幂等', () => {
  test('同一次迁移跑两遍不出错 —— 崩溃恢复会重跑', () => {
    const dir = tmp()
    const path = oldDb(dir, 1)
    const m = [{ toVersion: 2, statements: ["ALTER TABLE sessions ADD COLUMN twice TEXT NOT NULL DEFAULT ''"] }]
    const a = migrateDatabase({ dbPath: path, migrations: m, target: 2 })
    expect(a.rolledBack).toBe(false)
    // 把版本改回去再跑一遍，模拟"上次没记上版本号就崩了"
    const db = new Database(path)
    db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, '1')
    db.close()
    const b = migrateDatabase({ dbPath: path, migrations: m, target: 2 })
    expect(b.rolledBack).toBe(false)
  })
})

describe('迁移后数据还在', () => {
  test('迁移前写的事件，迁移后一条不少读得出来', async () => {
    const dir = tmp()
    const path = join(dir, 'events.db')
    const log = new SqliteEventLog({ path })
    await log.append('s1', [
      { t: 'user.input', text: '迁移前写的' },
      { t: 'model.delta', text: '也要在' },
    ])
    log.close()

    const db = new Database(path)
    db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, '1')
    db.close()

    const r = migrateDatabase({ dbPath: path })
    expect(r.rolledBack).toBe(false)

    const after = new SqliteEventLog({ path })
    const events = await after.read('s1')
    after.close()
    expect(events).toHaveLength(2)
    expect(events[0]?.ev).toMatchObject({ t: 'user.input', text: '迁移前写的' })
  })
})
