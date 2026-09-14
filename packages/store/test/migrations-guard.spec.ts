/**
 * PRD-M2-007 AC-2 · 迁移只允许补默认值与新增派生列 —— 守卫照例先红一次
 *
 * 这条破坏**不会在测试里露面**：新写的数据一切正常，坏掉的是别人磁盘上的旧数据。
 * 所以必须由静态扫描在合并前拦住。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join('packages', 'store', 'src', 'schema.ts')
const ORIGINAL = readFileSync(FILE, 'utf8')

afterEach(() => {
  // 改的是真文件，所以一定要还原。写回原文比删除安全：
  // 挂载没有删除权限时，rm 会把一个本身是好的守卫报成失败
  if (existsSync(FILE) && readFileSync(FILE, 'utf8') !== ORIGINAL) writeFileSync(FILE, ORIGINAL, 'utf8')
})

async function run(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-migrations.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

/** 往 MIGRATIONS 里塞一条语句 */
function inject(sql: string): void {
  const marked = ORIGINAL.replace(
    'export const MIGRATIONS: readonly Migration[] = [',
    `export const MIGRATIONS: readonly Migration[] = [\n  { toVersion: 99, statements: [${JSON.stringify(sql)}] },`,
  )
  writeFileSync(FILE, marked, 'utf8')
}

describe('守卫会红', () => {
  for (const [sql, keyword] of [
    ['ALTER TABLE events DROP COLUMN payload', '删列'],
    ['ALTER TABLE events RENAME COLUMN ts TO created_at', '改名'],
    ['DROP TABLE events', '删表'],
    ['UPDATE events SET payload = ?', 'append-only'],
    ['DELETE FROM events WHERE seq < 100', 'append-only'],
  ] as const) {
    test(`${sql} 被拦下`, async () => {
      inject(sql)
      const { code, out } = await run()
      expect(code).not.toBe(0)
      expect(out).toContain(keyword)
    }, 60_000)
  }

  test('白名单之外的花样写法也拦 —— 黑名单永远漏', async () => {
    inject('ALTER TABLE events ALTER COLUMN ts SET DEFAULT 0')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('不在白名单里')
  }, 60_000)
})

describe('该放行的要放行', () => {
  for (const sql of [
    "ALTER TABLE sessions ADD COLUMN nickname TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX IF NOT EXISTS idx_x ON events(ts)',
    'CREATE VIEW IF NOT EXISTS v_recent AS SELECT * FROM events',
  ]) {
    test(`${sql.slice(0, 40)}… 放行`, async () => {
      inject(sql)
      expect((await run()).code).toBe(0)
    }, 60_000)
  }
})

describe('真实仓库是绿的', () => {
  test('现有迁移全部是新增形状', async () => {
    expect((await run()).code).toBe(0)
  }, 60_000)
})
