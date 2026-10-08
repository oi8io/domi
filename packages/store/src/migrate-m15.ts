/**
 * PRD-M15-008 AC-2 · 内部会话泄漏迁移（`domi migrate-m15`）
 *
 * 背景：M4 之前的版本允许 `_` 前缀会话（内部会话）被当作普通会话使用，
 * 用户事件（user.input 等）可能落进 `_memory` / 其他 `_` 前缀会话。
 * 本函数把这些泄漏的用户事件迁出成普通会话，内部会话只留记忆事件。
 *
 * 三个硬性要求（AC-2 + 取舍-21）：
 *   1. 迁移前自动把 events.db 复制到 backups/pre-m15-migration-<ts>/，失败可回滚；
 *   2. 幂等可重跑：migrated-<原id> 会话已存在就跳过，重复跑不重复迁；
 *   3. 保留原 seq 映射：seq 是会话内的，UPDATE session_id 后原 seq 原样保留，
 *      ctx.ref 引用照常解析。
 *
 * INV-01：事件只增不改——这里**不删除**任何事件，只是把一批事件从旧会话
 * 划到新会话名下；原会话行保留（只留记忆事件，且内部会话本来就不进列表）。
 */

import { Database } from 'bun:sqlite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface MigrateM15Options {
  dbPath: string
  /** 默认 <dbPath 目录>/backups（AC-2：~/.domi/backups） */
  backupDir?: string
  now?: () => number
}

export interface MigrateM15SessionResult {
  from: string
  to: string
  /** 迁出的事件数 */
  events: number
  /** 从哪个 seq 起迁（第一个非记忆事件） */
  cutoffSeq: number
}

export interface MigrateM15Result {
  /** 备份目录（迁移前自动复制 events.db 进去）；没有内部会话时也是 null？——否，总是备份 */
  backup: string | null
  migrated: MigrateM15SessionResult[]
  /** 跳过原因：已经是纯记忆会话 / migrated-<id> 已存在 */
  skipped: string[]
  changed: boolean
}

export function migrateM15InternalSessions(opts: MigrateM15Options): MigrateM15Result {
  const now = opts.now ?? Date.now
  const dbPath = opts.dbPath
  const db = new Database(dbPath, { create: true })

  // AC-2：迁移前备份。备份目录 = <backupDir>/pre-m15-migration-<ts>/
  const backupRoot = opts.backupDir ?? join(dirname(dbPath), 'backups')
  const backup = join(backupRoot, `pre-m15-migration-${now()}`)
  mkdirSync(backup, { recursive: true })
  copyFileSync(dbPath, join(backup, 'events.db'))

  const out: MigrateM15Result = { backup, migrated: [], skipped: [], changed: false }

  // 全部 _ 前缀会话
  const rows = db.query<{ id: string }, []>("SELECT id FROM sessions WHERE substr(id, 1, 1) = '_'").all()
  for (const { id } of rows) {
    const target = `migrated-${id}`
    // 幂等：目标会话已存在（上次迁过），跳过
    const exists = db.query<{ c: number }, [string]>('SELECT COUNT(*) AS c FROM sessions WHERE id = ?').get(target)
    if ((exists?.c ?? 0) > 0) {
      out.skipped.push(`${id}（已迁移为 ${target}）`)
      continue
    }
    // 找第一个用户事件（user.input / user.note）——迁出的起算点（SPEC-M15-008 取舍-21）。
    // 不把 error / ctx.* 当用户事件：_memory 里的失败记录（error{scope:'memory'}）是正常
    // 投影，不该被当成泄漏迁走。
    const first = db
      .query<{ seq: number }, [string]>(
        "SELECT seq FROM events WHERE session_id = ? AND type IN ('user.input', 'user.note') ORDER BY seq LIMIT 1",
      )
      .get(id)
    if (first === null) {
      out.skipped.push(`${id}（纯记忆会话，无用户事件）`)
      continue
    }
    const cutoff = first.seq
    // bun:sqlite 返回原始列名（snake_case），泛型直接对应
    const src = db
      .query<
        {
          id: string
          created_at: number
          updated_at: number
          cwd: string
          title: string
          model: string
          kind: string | null
        },
        [string]
      >('SELECT id, created_at, updated_at, cwd, title, model, kind FROM sessions WHERE id = ?')
      .get(id)
    if (src === null) continue

    const tx = db.transaction(() => {
      // 新普通会话行：继承 kind / cwd / model；标题标注来源
      db.query(
        `INSERT INTO sessions (id, created_at, updated_at, cwd, title, model, parent_session_id, parent_seq, spawned_by, kind, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        target,
        src.created_at,
        now(),
        src.cwd,
        `${src.title}（迁移自 ${id}）`,
        src.model,
        null,
        null,
        null,
        src.kind ?? null,
        null,
      )
      // 把用户事件划到新会话；原 seq 原样保留（seq 是会话内的，跨会话不冲突）
      const n =
        db
          .query<{ c: number }, [string, number]>('SELECT COUNT(*) AS c FROM events WHERE session_id = ? AND seq >= ?')
          .get(id, cutoff)?.c ?? 0
      // append-only-exempt: PRD-M15-008 AC-2（INV-01 唯一例外）——把用户事件划到新会话名下
      db.query('UPDATE events SET session_id = ? WHERE session_id = ? AND seq >= ?').run(target, id, cutoff)
      return n
    })
    const moved = tx()
    out.migrated.push({ from: id, to: target, events: moved, cutoffSeq: cutoff })
    out.changed = true
  }

  db.close()
  return out
}

export function formatMigrateM15(r: MigrateM15Result): string {
  const lines: string[] = []
  lines.push(`备份：${r.backup}`)
  if (r.migrated.length === 0) {
    lines.push('没有需要迁移的内部会话。')
  } else {
    for (const m of r.migrated) {
      lines.push(`迁移 ${m.from} → ${m.to}：${m.events} 条用户事件（自 seq ${m.cutoffSeq} 起）`)
    }
  }
  for (const s of r.skipped) lines.push(`跳过：${s}`)
  lines.push(r.changed ? '完成。原内部会话只保留记忆事件。' : '没有变化。')
  return lines.join('\n')
}
