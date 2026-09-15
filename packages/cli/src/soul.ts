/**
 * `domi memory …` 与 `domi soul …` —— PRD-M4-001…004
 *
 * 和 `domi session` 一样在本进程里直接开库（这些命令要在 domid 没跑的时候也能用）。
 * 写操作经 MemoryService，先落事件再动文件，和 daemon 里走的是同一段代码。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadConfig } from '@domi/config'
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

const MEMORY_USAGE = `用法：
  domi memory list [--all]          列出记下的条目（--all 含已删除）
  domi memory search <关键词>        检索
  domi memory delete <id>            删除一条（之后检索不到，事件仍在）
  domi memory extract <会话 id>      立刻从某个会话抽取`

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
        if (items.length === 0) io.out('还没有记下任何东西。对话攒够几轮之后会自动抽取（memory.extractEvery）。')
        for (const i of items) {
          const refs = i.sourceRefs.map((r) => `${r.sessionId}#${r.seq}`).join(' ')
          io.out(`${i.id}  [${i.kind}] ${i.text}${i.deletedAt !== null ? '  （已删除）' : ''}\n    来源 ${refs}`)
        }
        return 0
      }
      case 'search': {
        const q = args.join(' ').trim()
        if (q === '') {
          io.err(MEMORY_USAGE)
          return 2
        }
        const r = await m.search(q)
        if (r.mode === 'keyword') io.out('（只按关键词匹配：没有配置 memory.embedding）')
        if (r.items.length === 0) io.out('没有相关的条目。')
        for (const i of r.items) io.out(`${i.id}  [${i.kind}] ${i.text}`)
        return 0
      }
      case 'delete': {
        if (!args[0]) {
          io.err(MEMORY_USAGE)
          return 2
        }
        const ok = await m.remove(args[0])
        io.out(ok ? `已删除 ${args[0]}` : `没有 ${args[0]}（或者已经删过了）`)
        return ok ? 0 : 1
      }
      case 'extract': {
        if (!args[0]) {
          io.err(MEMORY_USAGE)
          return 2
        }
        const r = await m.extract(args[0])
        io.out(`新增 ${r.added.length} 条，Soul 改了 ${r.soul.length} 处`)
        for (const i of r.added) io.out(`+ [${i.kind}] ${i.text}`)
        return 0
      }
      default:
        io.err(MEMORY_USAGE)
        return 2
    }
  } finally {
    m.close()
  }
}

const SOUL_USAGE = `用法：
  domi soul show                    打印 Soul（文件在 ~/.domi/soul/soul.md，可以直接改）
  domi soul review                  逐条审阅上次以来的改动：a 接受 / r 否决 / s 跳过
  domi soul update                  用全部记忆重新过一遍（一次最多改 10 处）
  domi soul export [文件]            导出成单个 Markdown（不含来源注释；有凭据或本机路径会拒绝）
  domi soul import <文件>            导入别人的 Soul，逐区确认`

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
        io.out(existsSync(m.soulPath) ? readFileSync(m.soulPath, 'utf8') : '还没有 Soul。对话攒够几轮之后会自动生成。')
        io.err(`（${m.soulPath}）`)
        return 0
      }
      case 'update': {
        const changes = await m.updateSoul()
        io.out(
          changes.length === 0
            ? '没有要改的。'
            : changes.map((c) => `${c.op} [${c.section}] ${c.after ?? c.before}`).join('\n'),
        )
        return 0
      }
      case 'review': {
        const pending = await m.pendingChanges()
        if (pending.length === 0) {
          io.out('没有待审阅的改动。')
          return 0
        }
        if (!io.ask) {
          // 非交互环境不替人决定（M4-003 的前提：否决是人的动作）
          for (const c of pending) io.out(`${c.id}\n${c.diff}\n`)
          io.err('审阅需要在终端里交互进行。')
          return 1
        }
        for (const c of pending) {
          io.out(`\n${c.diff}`)
          const a = (await io.ask('[a]接受 / [r]否决 / [s]跳过 / [q]退出 > ')).trim().toLowerCase()
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
          io.err('导出被拒绝：下面这些行里有凭据、本机路径或邮箱。改掉（或删掉）再导出——不替你静默替换：')
          for (const f of findings) io.err(`  第 ${f.line} 行 [${f.kind}] ${f.text}`)
          return 1
        }
        if (args[0]) {
          writeFileSync(args[0], text, 'utf8')
          io.out(`已导出到 ${args[0]}`)
        } else io.out(text)
        return 0
      }
      case 'import': {
        const file = args[0]
        if (!file || !existsSync(file)) {
          io.err(file ? `找不到 ${file}` : SOUL_USAGE)
          return 2
        }
        // M4-004 AC-3：必须逐区确认，非交互直接失败，不静默合并
        if (!io.ask) {
          io.err('导入必须在终端里逐区确认；非交互环境不会合并任何内容。')
          return 1
        }
        const plans = m.planImport(readFileSync(file, 'utf8'), basename(file))
        if (plans.length === 0) {
          io.out('没有新内容可导入。')
          return 0
        }
        io.out('导入的内容是别人写的：它会进你的提示词，但只作为参考资料，不会被当成指令。')
        const accepted = []
        for (const p of plans) {
          io.out(
            `\n## ${p.section}\n${p.add.map((l) => `+ ${l.replace(/\s*<!--.*-->$/, '').replace(/^- /, '')}`).join('\n')}`,
          )
          const a = (await io.ask('导入这一区？[y/N] ')).trim().toLowerCase()
          if (a === 'y') accepted.push(p)
        }
        const changes = await m.applyImport(accepted)
        io.out(`导入了 ${changes.length} 条（${accepted.length} 个区）。之后可以用 domi soul review 撤回。`)
        return 0
      }
      default:
        io.err(SOUL_USAGE)
        return 2
    }
  } finally {
    m.close()
  }
}
