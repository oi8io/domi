/**
 * `domi migrate` 的实现 —— PRD-M2-007 AC-3
 *
 * **迁移前自动备份，失败自动回滚到备份。**
 *
 * 为什么这条不能省：迁移是**唯一**会碰用户既有数据的操作。
 * 其它地方出错最多是这一次失败，这里出错是几个月的会话记录没了。
 * 而 SQLite 的 ALTER 在多语句迁移中途失败时，库会停在半路——
 * 没有备份的话，那个半路状态就是新的现实。
 *
 * 备份是**文件级复制**而不是 `.dump`：前者原样，后者要经过一次 SQL 往返，
 * 而"往返里丢了什么"恰恰是最难发现的那类损坏。
 */

import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { SCHEMA_VERSION } from '@domi/protocol'
import { META_SCHEMA_VERSION, MIGRATIONS } from './schema.ts'

export interface MigrateResult {
  /** 迁移前的磁盘版本 */
  from: number
  to: number
  /** 备份文件路径；null 表示没有需要迁移的东西，因而没备份 */
  backup: string | null
  applied: number
  /** 失败并成功回滚时为真 */
  rolledBack: boolean
  message: string
}

export function backupPath(dbPath: string, now: number): string {
  return `${dbPath}.bak-${now}`
}

function diskVersion(db: Database): number {
  const row = db.query<{ v: string }, [string]>('SELECT v FROM meta WHERE k = ?').get(META_SCHEMA_VERSION)
  return row ? Number(row.v) : 0
}

export interface MigrateOptions {
  dbPath: string
  now?: () => number
  /** 注入用：让测试能造一个必然失败的迁移 */
  migrations?: readonly { toVersion: number; statements: readonly string[] }[]
  target?: number
}

export function migrateDatabase(opts: MigrateOptions): MigrateResult {
  const { dbPath } = opts
  const now = opts.now ?? (() => Date.now())
  const migrations = opts.migrations ?? MIGRATIONS
  const target = opts.target ?? SCHEMA_VERSION

  if (!existsSync(dbPath)) {
    return { from: 0, to: target, backup: null, applied: 0, rolledBack: false, message: `没有数据库文件：${dbPath}` }
  }

  // 文件存在已经在上面确认过了，这里不传 create:false —— bun 1.4 对它的处理是 SQLITE_MISUSE
  const probe = new Database(dbPath)
  const from = diskVersion(probe)
  probe.close()

  if (from >= target) {
    return {
      from,
      to: target,
      backup: null,
      applied: 0,
      rolledBack: false,
      message:
        from === target
          ? `已经是最新（v${from}），没有可迁移的东西`
          : `磁盘版本 v${from} 高于本程序 v${target}，不动它`,
    }
  }

  const todo = migrations.filter((m) => m.toVersion > from && m.toVersion <= target)

  // 备份**先做**，哪怕这次没有语句要跑：版本号本身也要改，改坏了一样要能退回来
  const backup = backupPath(dbPath, now())
  copyFileSync(dbPath, backup)

  const db = new Database(dbPath)
  let applied = 0
  try {
    for (const m of todo) {
      for (const sql of m.statements) {
        try {
          db.exec(sql)
          applied++
        } catch (e) {
          // 迁移必须幂等（崩溃恢复会重跑），列已存在不算失败
          if (!String(e).includes('duplicate column name')) throw e
        }
      }
    }
    db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(target))
    db.close()
    return {
      from,
      to: target,
      backup,
      applied,
      rolledBack: false,
      message: `v${from} → v${target}，执行 ${applied} 条语句。备份留在 ${backup}`,
    }
  } catch (e) {
    db.close()
    // 回滚：把备份原样盖回去。这一步失败才是真的坏了，所以让它往上抛
    copyFileSync(backup, dbPath)
    const size = statSync(dbPath).size
    return {
      from,
      to: target,
      backup,
      applied,
      rolledBack: true,
      message:
        `迁移失败，已从备份回滚（${size} 字节）：${e instanceof Error ? e.message : String(e)}\n` +
        `备份仍在 ${backup}，没有删——出了事要能拿着它找人看。`,
    }
  }
}

export function formatMigrate(r: MigrateResult): string {
  const head = r.rolledBack ? '✗ 迁移失败' : '✓ 迁移'
  return `${head}\n  ${r.message}`
}
