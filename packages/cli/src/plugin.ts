/**
 * `domi plugin …` —— PRD-M6-002 / 004
 *
 * 安装要人确认（非交互直接拒绝，AC-2）。装好之后要重启 domid 才生效：
 * daemon 启动时读一次已安装列表，运行中不热加载——热加载会让「什么时候开始拥有这些权限」变得模糊。
 */

import { resolve } from 'node:path'
import { tr } from '@domi/i18n'
import {
  detectSandbox,
  InstallRefusedError,
  installPlugin,
  loadInstalled,
  ManifestError,
  readIndex,
  removePlugin,
  type ScaffoldKind,
  scaffold,
} from '@domi/plugin'
import type { Io } from './io.ts'

const USAGE = () => tr('cli.plugin.usage')

export async function runPlugin(
  sub: string | undefined,
  args: readonly string[],
  io: Io,
  opts: { pluginsDir: string },
): Promise<number> {
  switch (sub) {
    case 'list':
    case undefined: {
      const backend = detectSandbox()
      io.out(tr('web.plugins.sandbox', { v: backend === 'none' ? tr('web.plugins.noSandbox') : backend }))
      const { plugins, problems } = loadInstalled(opts.pluginsDir)
      if (readIndex(opts.pluginsDir).plugins.length === 0) io.out(tr('cli.plugin.none'))
      for (const p of plugins) {
        const c = p.manifest.contributes
        io.out(
          `${p.manifest.name} ${p.manifest.version}  ${p.manifest.description}\n` +
            tr('cli.plugin.counts', {
              length: c.tools.length,
              length2: c.skills.length,
              length3: c.mcp.length,
              length4: c.ui.length,
            }),
        )
      }
      for (const pr of problems) io.err(`⚠ ${pr.message}`)
      return problems.length > 0 ? 1 : 0
    }
    case 'install': {
      const dir = args[0]
      if (!dir) {
        io.err(USAGE())
        return 2
      }
      const ask = io.ask
      try {
        const inst = await installPlugin(resolve(dir), {
          pluginsDir: opts.pluginsDir,
          ...(ask
            ? {
                confirm: async (m, perms) => {
                  io.out(tr('cli.plugin.needs', { name: m.name, version: m.version, description: m.description }))
                  for (const p of perms) io.out(`  · ${p}`)
                  return (await ask(tr('cli.plugin.confirm'))).trim().toLowerCase() === 'y'
                },
              }
            : {}),
        })
        io.out(tr('cli.plugin.installed', { name: inst.name, version: inst.version }))
        return 0
      } catch (e) {
        if (e instanceof InstallRefusedError || e instanceof ManifestError) {
          io.err(e.message)
          return 1
        }
        throw e
      }
    }
    case 'remove': {
      if (!args[0]) {
        io.err(USAGE())
        return 2
      }
      const ok = removePlugin(opts.pluginsDir, args[0])
      io.out(ok ? tr('cli.plugin.removed', { v: args[0] }) : tr('cli.plugin.notInstalled', { v: args[0] }))
      return ok ? 0 : 1
    }
    case 'scaffold': {
      const kind = args[0] as ScaffoldKind | undefined
      const dir = args[1]
      if (!kind || !['tool', 'skill', 'mcp'].includes(kind) || !dir) {
        io.err(USAGE())
        return 2
      }
      const name = (args[2] ?? resolve(dir).split(/[\\/]/).pop() ?? 'my-plugin')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
      const files = scaffold(kind, dir, name)
      io.out(tr('cli.plugin.scaffolded', { name, kind, join: files.map((f) => `  ${f}`).join('\n'), dir, dir2: dir }))
      return 0
    }
    default:
      io.err(USAGE())
      return 2
  }
}
