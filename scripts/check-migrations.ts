/**
 * PRD-M2-007 AC-2 · 迁移只允许补默认值与新增派生列，禁止修改或删除既有事件字段
 *
 * 这条守的是 INV-01 里最要命的那半句：**任意历史事件永远可解析**。
 * 一条 `ALTER TABLE events DROP COLUMN` 就能让几个月前的会话永久读不出来，
 * 而这种破坏**不会在测试里露面**——新写的数据一切正常，坏掉的是别人磁盘上的旧数据。
 * 所以它必须由静态扫描在合并前拦住。
 *
 * 判据：`MIGRATIONS` 里的每一条 SQL 都必须落在白名单形状里。
 * 用白名单而不是黑名单，是因为黑名单永远漏——SQL 的花样比人想得多。
 *
 * 用法：bun run scripts/check-migrations.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join('packages', 'store', 'src', 'schema.ts')

/** 允许的形状。注意 ADD COLUMN 是新增，RENAME / DROP 是修改，后者一律不行 */
const ALLOWED: Array<{ re: RegExp; what: string }> = [
  { re: /^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+/i, what: '新增列' },
  { re: /^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i, what: '新增索引' },
  { re: /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, what: '新增表' },
  { re: /^CREATE\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?/i, what: '新增视图（派生，不改原始数据）' },
  { re: /^INSERT\s+OR\s+IGNORE\s+INTO\s+meta\b/i, what: '写 meta 的默认值' },
]

/** 明确点名的高危写法，命中时给一句更具体的话（仍然由白名单兜底） */
const NAMED_DANGERS: Array<{ re: RegExp; why: string }> = [
  { re: /\bDROP\s+COLUMN\b/i, why: '删列会让旧事件永久读不出来' },
  { re: /\bRENAME\s+(COLUMN|TO)\b/i, why: '改名等于删一个加一个，旧代码读不到原字段' },
  { re: /\bDROP\s+TABLE\b/i, why: '删表' },
  { re: /^\s*UPDATE\b/i, why: '改既有行——events 是 append-only（INV-01）' },
  { re: /^\s*DELETE\b/i, why: '删既有行——events 是 append-only（INV-01）' },
]

const src = readFileSync(FILE, 'utf8')

// 取 MIGRATIONS 数组的源码段落，只扫它 —— DDL 里的 CREATE TABLE 是建库不是迁移
const start = src.indexOf('export const MIGRATIONS')
if (start < 0) {
  console.error(`[PRD-M2-007 AC-2] 在 ${FILE} 里找不到 MIGRATIONS`)
  process.exit(1)
}
const end = src.indexOf('\nexport ', start + 1)
const block = src.slice(start, end < 0 ? undefined : end)

// 单引号 / 双引号 / 反引号里的 SQL 字面量
const statements = [...block.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
  .map((m) => m[2] ?? '')
  .map((s) => s.trim())
  .filter((s) => /^(ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|PRAGMA)\b/i.test(s))

const violations: string[] = []
for (const sql of statements) {
  const danger = NAMED_DANGERS.find((d) => d.re.test(sql))
  if (danger) {
    violations.push(`${sql}\n    → ${danger.why}`)
    continue
  }
  if (!ALLOWED.some((a) => a.re.test(sql))) {
    violations.push(`${sql}\n    → 不在白名单里（允许：${ALLOWED.map((a) => a.what).join(' / ')}）`)
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`[PRD-M2-007 AC-2] ${v}`)
  console.error(
    '\n迁移只允许**补默认值、新增列、新增索引/表/视图**。' +
      '\n改或删既有字段的破坏不会在测试里露面——新写的数据一切正常，坏掉的是别人磁盘上的旧数据。' +
      '\n真要改结构：新增一列、双写、让旧列自然退役，**不要动旧列**。',
  )
  process.exit(1)
}
console.log(`[check-migrations] OK —— ${statements.length} 条迁移 SQL 全部是新增形状，没有修改或删除既有字段`)
