/**
 * 插件宿主 —— PRD-M6-001 / 002 / 003
 *
 * 把已安装的插件变成 domi 认识的东西：tool → Tool，skill → Skill 目录，mcp → server 配置，ui → 面板。
 * 插件工具的 execute 就是「在沙箱里跑一次」，沙箱里的 I/O 请求由这里按权限快照代做。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Tool } from '@domi/capability'
import type { McpServerConfig } from '@domi/config'
import { guardedFetch, HostNotAllowedError } from '@domi/mcp'
import type { DomiEvent } from '@domi/protocol'
import { z } from 'zod'
import { type LoadedPlugin, type LoadProblem, loadInstalled } from './install.ts'
import { toolId } from './manifest.ts'
import {
  bunExecutable,
  detectSandbox,
  ensureRunner,
  type HostApi,
  runSandboxed,
  type SandboxBackend,
} from './sandbox.ts'

export const PLUGIN_MANIFEST_RULE = 'plugin-manifest'

export interface PluginHostOptions {
  pluginsDir: string
  /** 没有系统级沙箱时是否仍然运行插件代码（默认否，ADR-023） */
  allowUnsandboxed?: boolean
  backend?: SandboxBackend
  fetch?: typeof globalThis.fetch
  log?: (line: string) => void
}

export interface PluginUiPanel {
  plugin: string
  id: string
  title: string
  entry: string
  dir: string
}

/** 相对工作目录的路径是否被某个 glob 允许；越出工作目录的一律不许 */
export function pathAllowed(
  cwd: string,
  requested: string,
  globs: readonly string[],
): { ok: boolean; rel: string; abs: string } {
  const abs = resolve(cwd, requested)
  const rel = relative(cwd, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, rel, abs }
  const norm = rel.split('\\').join('/')
  return { ok: globs.some((g) => new Bun.Glob(g).match(norm)), rel: norm, abs }
}

const MAX_READ = 2 * 1024 * 1024

export class PluginHost {
  private loaded: LoadedPlugin[] = []
  private problemList: LoadProblem[] = []
  readonly backend: SandboxBackend
  private runnerPath = ''

  constructor(private readonly opts: PluginHostOptions) {
    this.backend = opts.backend ?? detectSandbox()
    this.reload()
  }

  reload(): void {
    const { plugins, problems } = loadInstalled(this.opts.pluginsDir)
    this.loaded = plugins
    this.problemList = [...problems]
    for (const p of plugins) for (const w of p.warnings) this.opts.log?.(`plugin ${p.manifest.name}: ${w}`)
    const withCode = plugins.filter((p) => p.manifest.contributes.tools.length > 0)
    if (withCode.length > 0 && this.backend === 'none' && !this.opts.allowUnsandboxed) {
      for (const p of withCode) {
        this.problemList.push({
          name: p.manifest.name,
          message: `插件 ${p.manifest.name} 带代码，但这台机器没有系统级沙箱（Linux 要 bwrap，macOS 要 sandbox-exec），它的工具没有加载。skill / MCP / UI 照常`,
        })
      }
    }
    this.runnerPath = ensureRunner(join(this.opts.pluginsDir, '.runtime'))
  }

  get plugins(): readonly LoadedPlugin[] {
    return this.loaded
  }

  problems(): readonly LoadProblem[] {
    return this.problemList
  }

  private codeAllowed(): boolean {
    return this.backend !== 'none' || this.opts.allowUnsandboxed === true
  }

  skillDirs(): string[] {
    return this.loaded.flatMap((p) => p.manifest.contributes.skills.map((s) => dirname(join(p.dir, s))))
  }

  /** 插件带的 skill：每个是一个 SKILL.md 文件路径 */
  skillFiles(): string[] {
    return this.loaded.flatMap((p) => p.manifest.contributes.skills.map((s) => join(p.dir, s, 'SKILL.md')))
  }

  /** MCP server 配置，名字加上插件前缀，避免和用户自己配的撞名 */
  mcpServers(): McpServerConfig[] {
    return this.loaded.flatMap((p) =>
      p.manifest.contributes.mcp.map((s) => ({
        ...s,
        name: `${p.manifest.name}-${s.name}`.slice(0, 32),
        ...(s.cwd === undefined ? {} : { cwd: resolve(p.dir, s.cwd) }),
      })),
    )
  }

  uiPanels(): PluginUiPanel[] {
    return this.loaded.flatMap((p) =>
      p.manifest.contributes.ui.map((u) => ({
        plugin: p.manifest.name,
        id: u.id,
        title: u.title,
        entry: u.entry,
        dir: p.dir,
      })),
    )
  }

  uiHtml(plugin: string, id: string): string | null {
    const panel = this.uiPanels().find((u) => u.plugin === plugin && u.id === id)
    if (!panel) return null
    return readFileSync(join(panel.dir, panel.entry), 'utf8')
  }

  tools(cwd: string): Tool[] {
    if (!this.codeAllowed()) return []
    return this.loaded.flatMap((p) => p.manifest.contributes.tools.map((t) => this.makeTool(p, t, cwd)))
  }

  private makeTool(p: LoadedPlugin, t: LoadedPlugin['manifest']['contributes']['tools'][number], cwd: string): Tool {
    const name = toolId(p.manifest.name, t.name)
    const host = this
    return {
      name,
      capability: name,
      description: `【插件 ${p.manifest.name}】${t.description}`,
      // 参数由插件自己的 JSON Schema 描述；宿主只保证是个对象，细节交给插件校验
      schema: z.record(z.string(), z.unknown()),
      inputJsonSchema: t.input,
      async execute(args, ctx) {
        const events: DomiEvent[] = []
        const r = await runSandboxed(
          { backend: host.backend, bun: bunExecutable(), pluginDir: p.dir, runnerPath: host.runnerPath },
          { entry: t.entry, args, cwd },
          host.hostApi(p, cwd, (ev) => {
            events.push(ev)
            ctx.emit(ev)
          }),
          { timeoutMs: t.timeoutMs, signal: ctx.signal, tmpDir: join(host.opts.pluginsDir, '.runtime', 'tmp') },
        )
        if (r.crashed) {
          ctx.emit({ t: 'plugin.error', plugin: p.manifest.name, tool: t.name, message: r.error ?? '插件崩溃' })
        }
        if (!r.ok) throw new PluginToolError(r.error ?? '插件执行失败')
        // 插件的输出是不可信数据（INV-06）：作为工具结果返回，由 kernel 包上边界
        return r.payload
      },
    }
  }

  /** 宿主代理：每个调用都按安装时的权限快照核对，越权拒绝并落事件（M6-002 AC-3） */
  hostApi(p: LoadedPlugin, cwd: string, emit: (ev: DomiEvent) => void): HostApi {
    const granted = p.installed.granted
    const name = p.manifest.name
    const deny = (what: 'read' | 'write' | 'net', detail: string): never => {
      emit({
        t: 'permission',
        capabilityId: `plugin.${name}.${what}`,
        decision: 'deny',
        source: 'default',
        matchedRule: PLUGIN_MANIFEST_RULE,
      })
      throw new Error(`插件 ${name} 没有声明这个权限：${detail}`)
    }
    const baseFetch = this.opts.fetch ?? globalThis.fetch
    return {
      async readFile(path) {
        const a = pathAllowed(cwd, path, granted.read)
        if (!a.ok) deny('read', `读取 ${path}`)
        const text = readFileSync(a.abs)
        if (text.byteLength > MAX_READ) throw new Error(`文件超过 ${MAX_READ} 字节`)
        return text.toString('utf8')
      },
      async writeFile(path, content) {
        const a = pathAllowed(cwd, path, granted.write)
        if (!a.ok) deny('write', `写入 ${path}`)
        mkdirSync(dirname(a.abs), { recursive: true })
        writeFileSync(a.abs, content, 'utf8')
      },
      async fetch(req) {
        const f = guardedFetch((i, init) => baseFetch(i, init), granted.hosts)
        let res: Response
        try {
          res = await f(req.url, {
            ...(req.method === undefined ? {} : { method: req.method }),
            ...(req.headers === undefined ? {} : { headers: req.headers }),
            ...(req.body === undefined ? {} : { body: req.body }),
            signal: AbortSignal.timeout(15_000),
          })
        } catch (e) {
          if (e instanceof HostNotAllowedError) deny('net', `访问 ${e.host}`)
          throw e
        }
        const text = (await res.text()).slice(0, MAX_READ)
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text }
      },
      log: async (message) => {
        this.opts.log?.(`plugin ${name}: ${message.slice(0, 500)}`)
      },
    }
  }
}

export class PluginToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginToolError'
  }
}
