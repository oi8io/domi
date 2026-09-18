/**
 * `domi memory …` 与 `domi soul …` —— PRD-M4-001…004
 *
 * 和 `domi session` 一样在本进程里直接开库（这些命令要在 domid 没跑的时候也能用）。
 * 写操作经 MemoryService，先落事件再动文件，和 daemon 里走的是同一段代码。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadConfig } from '@domi/config'
import { tr } from '@domi/i18n'
import { MemoryService } from '@domi/runtime'
import type { Io } from './io.ts'

export interface SoulCliDeps {
  dataDir: string
  home: string
}

function service(deps: SoulCliDeps): MemoryService {
  return new MemoryService({
    config: loadConfig({ home: deps.home }),
    dbPath: join(deps.dataDir, 'events.db'),
    soulDir: join(deps.dataDir, 'soul'),
  })
}

const MEMORY_USAGE = () => tr('cli.memory.usage')

export async function runMemory(
  sub: string | undefined,
  args: readonly string[],
  io: Io,
  deps: SoulCliDeps,
  flags: { all?: boolean } = {},
): Promise<number> {
  const m = service(deps)
  try {
    switch (sub) {
      case 'list':
      case undefined: {
        const items = m.list({ includeDeleted: flags.all === true })
        if (items.length === 0) io.out(tr('cli.memory.none'))
        for (const i of items) {
          const refs = i.sourceRefs.map((r) => `${r.sessionId}#${r.seq}`).join(' ')
          io.out(
            tr('cli.memory.item', {
              id: i.id,
              kind: i.kind,
              text: i.text,
              v: i.deletedAt !== null ? tr('cli.memory.deletedTag') : '',
              refs,
            }),
          )
        }
        return 0
      }
      case 'search': {
        const q = args.join(' ').trim()
        if (q === '') {
          io.err(MEMORY_USAGE())
          return 2
        }
        const r = await m.search(q)
        if (r.mode === 'keyword') io.out(tr('cli.memory.keywordOnly'))
        if (r.items.length === 0) io.out(tr('tui.memory.noneDot'))
        for (const i of r.items) io.out(`${i.id}  [${i.kind}] ${i.text}`)
        return 0
      }
      case 'delete': {
        if (!args[0]) {
          io.err(MEMORY_USAGE())
          return 2
        }
        const ok = await m.remove(args[0])
        io.out(ok ? tr('cli.memory.deleted', { v: args[0] }) : tr('cli.memory.notFound', { v: args[0] }))
        return ok ? 0 : 1
      }
      case 'extract': {
        if (!args[0]) {
          io.err(MEMORY_USAGE())
          return 2
        }
        const r = await m.extract(args[0])
        io.out(tr('cli.memory.extracted', { length: r.added.length, length2: r.soul.length }))
        for (const i of r.added) io.out(`+ [${i.kind}] ${i.text}`)
        return 0
      }
      default:
        io.err(MEMORY_USAGE())
        return 2
    }
  } finally {
    m.close()
  }
}

const SOUL_USAGE = () => tr('cli.soul.usage')

export async function runSoul(
  sub: string | undefined,
  args: readonly string[],
  io: Io,
  deps: SoulCliDeps,
): Promise<number> {
  const m = service(deps)
  try {
    switch (sub) {
      case 'show':
      case undefined: {
        io.out(existsSync(m.soulPath) ? readFileSync(m.soulPath, 'utf8') : tr('cli.soul.none'))
        io.err(tr('cli.soul.path', { soulPath: m.soulPath }))
        return 0
      }
      case 'update': {
        const changes = await m.updateSoul()
        io.out(
          changes.length === 0
            ? tr('cli.soul.nothing')
            : changes.map((c) => `${c.op} [${c.section}] ${c.after ?? c.before}`).join('\n'),
        )
        return 0
      }
      case 'review': {
        const pending = await m.pendingChanges()
        if (pending.length === 0) {
          io.out(tr('cli.soul.noPending'))
          return 0
        }
        if (!io.ask) {
          // 非交互环境不替人决定（M4-003 的前提：否决是人的动作）
          for (const c of pending) io.out(`${c.id}\n${c.diff}\n`)
          io.err(tr('cli.soul.needsTty'))
          return 1
        }
        for (const c of pending) {
          io.out(`\n${c.diff}`)
          const a = (await io.ask(tr('cli.soul.reviewPrompt'))).trim().toLowerCase()
          if (a === 'q') break
          if (a !== 'a' && a !== 'r') continue
          const r = await m.review(c.id, a === 'a' ? 'accept' : 'reject')
          io.out(r.detail)
        }
        return 0
      }
      case 'export': {
        const { text, findings } = m.exportText()
        if (findings.length > 0) {
          io.err(tr('cli.soul.exportRefused'))
          for (const f of findings) io.err(tr('cli.soul.exportLine', { line: f.line, kind: f.kind, text: f.text }))
          return 1
        }
        if (args[0]) {
          writeFileSync(args[0], text, 'utf8')
          io.out(tr('cli.soul.exported', { v: args[0] }))
        } else io.out(text)
        return 0
      }
      case 'import': {
        const file = args[0]
        if (!file || !existsSync(file)) {
          io.err(file ? tr('cli.soul.fileNotFound', { file }) : SOUL_USAGE())
          return 2
        }
        // M4-004 AC-3：必须逐区确认，非交互直接失败，不静默合并
        if (!io.ask) {
          io.err(tr('cli.soul.importNeedsTty'))
          return 1
        }
        const plans = m.planImport(readFileSync(file, 'utf8'), basename(file))
        if (plans.length === 0) {
          io.out(tr('cli.soul.nothingToImport'))
          return 0
        }
        io.out(tr('cli.soul.importNotice'))
        const accepted = []
        for (const p of plans) {
          io.out(
            `\n## ${p.section}\n${p.add.map((l) => `+ ${l.replace(/\s*<!--.*-->$/, '').replace(/^- /, '')}`).join('\n')}`,
          )
          const a = (await io.ask(tr('cli.soul.importSection'))).trim().toLowerCase()
          if (a === 'y') accepted.push(p)
        }
        const changes = await m.applyImport(accepted)
        io.out(tr('cli.soul.imported', { length: changes.length, length2: accepted.length }))
        return 0
      }
      default:
        io.err(SOUL_USAGE())
        return 2
    }
  } finally {
    m.close()
  }
}
