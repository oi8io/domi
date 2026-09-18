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
import { configSource, credentialEnvNames, loadConfig, readConfigFile } from '@domi/config'
import { buildManifest, formatManifest } from '@domi/observability'
import { assemble, BUILTIN_LAYERS, formatDump, layersFromConfig, mergeLayers } from '@domi/prompt'
import { formatAbsolute, formatMigrate, formatRelative, migrateDatabase, SqliteEventLog } from '@domi/store'
import { CONFIG_TEMPLATE, HELP, type ParsedCli } from './args.ts'
import {
  exportAll,
  exportableConfig,
  formatPurgePlan,
  PURGE_CONFIRM_WORD,
  planPurge,
  toYamlWithoutSecrets,
} from './data.ts'
import { diagnose, formatFindings } from './doctor.ts'
import type { Io } from './io.ts'
import { formatOnboarding } from './onboarding.ts'
import { ping } from './ping.ts'

export const VERSION = '0.1.0'

export type { Io } from './io.ts'

/** 先看 HOME：os.homedir() 在 Bun 里不跟随运行期对 HOME 的修改，测试与「换个 HOME 跑一次」都靠这个 */
function userHome(): string {
  return process.env.HOME || homedir()
}

export function dataDir(): string {
  return join(userHome(), '.domi')
}

async function pluginDoctor(
  allowUnsandboxed: boolean,
): Promise<{ sandbox: 'bwrap' | 'sandbox-exec' | 'none'; allowUnsandboxed: boolean; withCode: number }> {
  const { detectSandbox, loadInstalled } = await import('@domi/plugin')
  const { plugins } = loadInstalled(join(dataDir(), 'plugins'))
  return {
    sandbox: detectSandbox(),
    allowUnsandboxed,
    withCode: plugins.filter((p) => p.manifest.contributes.tools.length > 0).length,
  }
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
    // PRD-M2-008 AC-1/AC-2。**故意用动态 import**：AC-5 要求 packages/eval 可以被整个删掉，
    // 静态 import 会让删除直接把 `domi` 打死。这里删掉之后退化成一句话，其它命令照常。
    case 'eval': {
      let runEval: (sub: string | undefined, args: readonly string[], io: Io) => Promise<number>
      try {
        ;({ runEval } = await import('@domi/eval'))
      } catch {
        io.err('评估层不可用（packages/eval 不在这份安装里）。其它命令不受影响。')
        return 127
      }
      // eval 的子命令自己解析选项（--rounds / --tasks / --out …），给它原始参数（BUG-M6-001）
      return runEval(cli.sub, cli.rawArgs, io)
    }

    // PRD-M2-005。同 eval：动态 import，删掉 packages/trace 也只是这一条命令退化
    case 'trace': {
      let runTrace: (id: string | undefined, htmlOut: string | undefined, io: Io) => Promise<number>
      try {
        ;({ runTrace } = await import('@domi/trace'))
      } catch {
        io.err('轨迹层不可用（packages/trace 不在这份安装里）。其它命令不受影响。')
        return 127
      }
      return runTrace(cli.sub, cli.flags.html, io)
    }

    // PRD-M6：插件的安装与脚手架在本进程里做（不需要 domid）
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      return runPlugin(cli.sub, cli.args, io, { pluginsDir: join(dataDir(), 'plugins') })
    }

    // PRD-M4。动态 import：这两个命令要拉起 runtime，其它命令不必为它付加载时间
    case 'memory':
    case 'soul': {
      const { runMemory, runSoul } = await import('./soul.ts')
      const deps = { dataDir: dataDir(), home: userHome() }
      return cli.command === 'memory'
        ? runMemory(cli.sub, cli.args, io, deps, { all: cli.flags.all })
        : runSoul(cli.sub, cli.args, io, deps)
    }

    case 'init': {
      if (cli.flags.project) {
        const { initProject } = await import('@domi/runtime')
        const r = initProject(process.cwd())
        io.out(
          r.created.length === 0
            ? `${r.root} 里已经有 .domi/ 和规矩文件了，什么都没改。`
            : `在 ${r.root} 里新建了：\n${r.created.map((c) => `  ${c}`).join('\n')}\n` +
                '规矩写进 AGENT.md，项目级 Skill 放 .domi/skills/<名字>/SKILL.md。第一次在这里打开会话时 domi 会问你是否信任这个仓库。',
        )
        return 0
      }
      if (!cli.flags.fromToml) {
        io.out(CONFIG_TEMPLATE)
        return 0
      }
      // ADR-014 的迁移：结构原样搬过去，api_key 也保留（这是用户自己的文件，不是导出）
      const legacy = join(dataDir(), 'config.toml')
      const src = configSource({ path: legacy })
      if (!src.exists) {
        io.err(`没有找到 ${legacy}，不需要迁移。\n$ domi init > ${join(dataDir(), 'config.yaml')}   # 从模板开始`)
        return 1
      }
      io.out(
        toYamlWithoutSecrets(
          readConfigFile(src),
          `# 由 ${legacy} 转换而来（domi init --from-toml）。原文件的注释没法带过来，需要的话对照着补。`,
          true,
        ),
      )
      return 0
    }

    case 'hook': {
      const { runHook } = await import('./hook.ts')
      return runHook(cli.sub, cli.args, io)
    }

    case 'trust': {
      const { TrustStore, findRepoRoot } = await import('@domi/runtime')
      const store = new TrustStore(join(dataDir(), 'trust.json'))
      if (cli.sub === 'list') {
        const rows = store.list()
        io.out(
          rows.length === 0
            ? '还没有答过任何仓库。'
            : rows.map((r) => `${r.trusted ? '信任  ' : '不信任'}  ${r.root}`).join('\n'),
        )
        return 0
      }
      const root = findRepoRoot(cli.sub ?? process.cwd())
      if (cli.flags.revoke) {
        store.set(root, false)
        io.out(`不再信任 ${root}：它的 AGENT.md 与 .domi/skills 不会进提示词（下一个会话起生效）。`)
      } else {
        store.set(root, true)
        io.out(`已信任 ${root}：它的 AGENT.md 与 .domi/skills 会进提示词（下一个会话起生效）。`)
      }
      return 0
    }

    case 'doctor': {
      const home = userHome()
      const cfg = loadConfig({ home })
      const src = configSource({ home })
      const legacyPath = src.legacy ? src.path : src.ignoredLegacy
      const pingResult = cli.flags.ping
        ? await ping({
            provider: cfg.model.provider,
            model: cfg.model.name,
            apiKey: cfg.model.apiKey,
            baseUrl: cfg.model.baseUrl,
          })
        : undefined
      const findings = diagnose({
        configPath: src.path,
        legacyConfig: legacyPath ? { path: legacyPath, ignored: !src.legacy } : undefined,
        baseUrl: cfg.model.baseUrl,
        ping: pingResult,
        hasCredential: Boolean(cfg.model.apiKey),
        credentialEnvNames: credentialEnvNames(cfg.model.provider),
        dataDir: dataDir(),
        gitAvailable: await new ShadowRepo({ workTree: process.cwd() }).available(),
        provider: cfg.model.provider,
        model: cfg.model.name,
        plugins: await pluginDoctor(cfg.plugins.allowUnsandboxed),
        ripgrep: Bun.which('rg'),
      })
      io.out(formatFindings(findings))
      return findings.every((f) => f.ok) ? 0 : 1
    }

    case 'prompt': {
      const cfg = loadConfig({ home: userHome() })
      const custom = layersFromConfig(cfg.prompt.layers)
      // 仓库规矩层（BUG-M7-001）：和会话里同一个层、同一个信任判断
      const { dumpRulesLayer } = await import('@domi/runtime')
      const rules = dumpRulesLayer(process.cwd(), dataDir())
      const base = rules.layer === null ? BUILTIN_LAYERS : [...BUILTIN_LAYERS, rules.layer]
      const a = assemble(mergeLayers(base, custom), { cwd: process.cwd(), model: cfg.model.name })
      io.out(formatDump(a))
      if (rules.note !== null) io.out(rules.note)
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
          // BUG-M3-002：这里原来只打印「已恢复」，一行恢复的动作都没有
          if (!log.sessions.get(restoreId)) {
            io.err(`没有这个会话：${restoreId}\n$ domi session all   # 列出包括已删除在内的全部会话`)
            return 1
          }
          log.sessions.restore(restoreId)
          io.out(`已恢复 ${restoreId}`)
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
          const r = await exportAll(log, out, exportableConfig(configSource({ home: userHome() })))
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

    // PRD-M2-007 AC-3。迁移是唯一会碰用户既有数据的操作，所以备份与回滚在 store 里，
    // 这里只负责把结果说清楚
    case 'migrate': {
      const r = migrateDatabase({ dbPath: join(dataDir(), 'events.db') })
      io.out(formatMigrate(r))
      return r.rolledBack ? 1 : 0
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
