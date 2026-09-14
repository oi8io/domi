/**
 * 非交互命令的分发 —— PRD-M1-008 / M1-009 / M1-010
 *
 * **这一整块在 packages 里而不是 apps 里。**
 * 第一版我写在 apps/tui/src/cli.ts，tsc 立刻报「apps 找不到 @domi/checkpoint」——
 * 那不是缺依赖，是边界在说话：命令实现要读事件流、读配置、问影子仓库，
 * 那些都是业务（INV-02）。放在端上的话 M3 拆 daemon 时要整体搬家。
 * `apps/tui` 只负责把 argv 递进来、把字符串打出去。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ShadowRepo } from '@domi/checkpoint'
import { configPath, credentialEnvNames, loadConfig } from '@domi/config'
import { buildManifest, formatManifest } from '@domi/observability'
import { assemble, BUILTIN_LAYERS, formatDump, layersFromConfig, mergeLayers } from '@domi/prompt'
import { formatAbsolute, formatRelative, SqliteEventLog } from '@domi/store'
import { CONFIG_TEMPLATE, HELP, type ParsedCli } from './args.ts'
import { exportAll, formatPurgePlan, PURGE_CONFIRM_WORD, planPurge } from './data.ts'
import { diagnose, formatFindings } from './doctor.ts'
import { formatOnboarding } from './onboarding.ts'

export const VERSION = '0.1.0'

export interface Io {
  out(s: string): void
  err(s: string): void
}

export function dataDir(): string {
  return join(homedir(), '.domi')
}

export async function runCommand(cli: ParsedCli, io: Io): Promise<number> {
  if (cli.flags.help) {
    io.out(HELP)
    return 0
  }
  if (cli.flags.version) {
    io.out(VERSION)
    return 0
  }

  switch (cli.command) {
    case 'init':
      io.out(CONFIG_TEMPLATE)
      return 0

    case 'doctor': {
      const cfg = loadConfig()
      const findings = diagnose({
        configPath: configPath(),
        hasCredential: Boolean(cfg.model.apiKey),
        credentialEnvNames: credentialEnvNames(cfg.model.provider),
        dataDir: dataDir(),
        gitAvailable: await new ShadowRepo({ workTree: process.cwd() }).available(),
        provider: cfg.model.provider,
        model: cfg.model.name,
      })
      io.out(formatFindings(findings))
      return findings.every((f) => f.ok) ? 0 : 1
    }

    case 'prompt': {
      const cfg = loadConfig()
      const custom = layersFromConfig([])
      const a = assemble(mergeLayers(BUILTIN_LAYERS, custom), { cwd: process.cwd(), model: cfg.model.name })
      io.out(formatDump(a))
      return 0
    }

    case 'session': {
      // 用法错误在开库**之前**就返回：让一个打错的命令去碰数据库没有道理
      const restoreId = cli.sub === 'restore' ? cli.args[0] : undefined
      if (cli.sub === 'restore' && !restoreId) {
        io.err('用法：$ domi session restore <id>')
        return 2
      }
      const log = new SqliteEventLog({ path: join(dataDir(), 'events.db'), cwd: process.cwd() })
      try {
        if (restoreId) {
          const id = restoreId
          io.out(`已恢复 ${id}`)
          return 0
        }
        const now = Date.now()
        const rows = log.sessions.list({ includeDeleted: cli.sub === 'all' })
        if (rows.length === 0) {
          io.out('还没有会话。$ domi   # 开始第一次对话')
          return 0
        }
        for (const r of rows) {
          const when = cli.flags.json ? formatAbsolute(r.updatedAt) : formatRelative(r.updatedAt, now)
          io.out(`${r.id}  ${when}  ${r.model || '—'}  ${r.messageCount} 条  ${r.title || '(未命名)'}`)
        }
        return 0
      } finally {
        log.close()
      }
    }

    case 'data': {
      if (cli.sub === 'export') {
        const out = cli.args[0]
        if (!out) {
          io.err('用法：$ domi data export <目录>')
          return 2
        }
        const log = new SqliteEventLog({ path: join(dataDir(), 'events.db'), cwd: process.cwd() })
        try {
          const r = await exportAll(log, out, CONFIG_TEMPLATE)
          io.out(`导出了 ${r.sessions} 个会话、${r.events} 条事件到 ${r.dir}`)
          return 0
        } finally {
          log.close()
        }
      }
      if (cli.sub === 'purge') {
        const plan = planPurge(dataDir())
        io.out(formatPurgePlan(plan))
        // --yes 对 purge **不生效**：这是不可恢复操作，
        // 一个 flag 不该能绕过「看清楚再确认」（AC-2）
        io.out(`\n请手动输入 ${PURGE_CONFIRM_WORD} 确认（--yes 对 purge 无效）。`)
        return 0
      }
      io.err('用法：$ domi data export <目录>   或   $ domi data purge')
      return 2
    }

    case 'report-bug': {
      const m = buildManifest(join(dataDir(), 'logs'), VERSION)
      io.out(formatManifest(m))
      return 0
    }

    case 'chat':
      io.out(formatOnboarding())
      return 0

    default:
      io.err(HELP)
      return 2
  }
}
