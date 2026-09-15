/**
 * `domi plugin …` —— PRD-M6-002 / 004
 *
 * 安装要人确认（非交互直接拒绝，AC-2）。装好之后要重启 domid 才生效：
 * daemon 启动时读一次已安装列表，运行中不热加载——热加载会让「什么时候开始拥有这些权限」变得模糊。
 */
import { resolve } from 'node:path'
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

const USAGE = `用法：
  domi plugin list                        已安装的插件、沙箱状态、没加载上的原因
  domi plugin install <目录>              安装（逐条列出权限，确认后才装；装好后重启 domid 生效）
  domi plugin remove <名字>               卸载
  domi plugin scaffold <tool|skill|mcp> <目录> [名字]
                                          生成插件骨架（自带 bun test）

写法见 docs/site/plugin-dev.md。`

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
      io.out(`沙箱：${backend === 'none' ? '没有（带代码的插件不会运行）' : backend}`)
      const { plugins, problems } = loadInstalled(opts.pluginsDir)
      if (readIndex(opts.pluginsDir).plugins.length === 0) io.out('还没有安装插件。')
      for (const p of plugins) {
        const c = p.manifest.contributes
        io.out(
          `${p.manifest.name} ${p.manifest.version}  ${p.manifest.description}\n` +
            `    工具 ${c.tools.length} · skill ${c.skills.length} · MCP ${c.mcp.length} · 面板 ${c.ui.length}`,
        )
      }
      for (const pr of problems) io.err(`⚠ ${pr.message}`)
      return problems.length > 0 ? 1 : 0
    }
    case 'install': {
      const dir = args[0]
      if (!dir) {
        io.err(USAGE)
        return 2
      }
      const ask = io.ask
      try {
        const inst = await installPlugin(resolve(dir), {
          pluginsDir: opts.pluginsDir,
          ...(ask
            ? {
                confirm: async (m, perms) => {
                  io.out(`\n插件 ${m.name} ${m.version}：${m.description}\n它需要：`)
                  for (const p of perms) io.out(`  · ${p}`)
                  return (await ask('\n确认安装？[y/N] ')).trim().toLowerCase() === 'y'
                },
              }
            : {}),
        })
        io.out(`已安装 ${inst.name} ${inst.version}。重启 domid 后生效（关掉所有 domi 窗口，或 kill domid 进程）`)
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
        io.err(USAGE)
        return 2
      }
      const ok = removePlugin(opts.pluginsDir, args[0])
      io.out(ok ? `已卸载 ${args[0]}。重启 domid 后生效` : `没有安装 ${args[0]}`)
      return ok ? 0 : 1
    }
    case 'scaffold': {
      const kind = args[0] as ScaffoldKind | undefined
      const dir = args[1]
      if (!kind || !['tool', 'skill', 'mcp'].includes(kind) || !dir) {
        io.err(USAGE)
        return 2
      }
      const name = (args[2] ?? resolve(dir).split(/[\\/]/).pop() ?? 'my-plugin')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
      const files = scaffold(kind, dir, name)
      io.out(
        `已生成 ${name}（${kind} 型）：\n${files.map((f) => `  ${f}`).join('\n')}\n\n$ cd ${dir} && bun test\n$ domi plugin install ${dir}`,
      )
      return 0
    }
    default:
      io.err(USAGE)
      return 2
  }
}
