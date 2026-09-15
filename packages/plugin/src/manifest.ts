/**
 * 插件 manifest —— PRD-M6-001 / 002 · docs/adr/022 · docs/spec/M6.md SPEC-M6-001
 */
import { McpServerSchema } from '@domi/config'
import { z } from 'zod'

/** 宿主支持的插件 API 主版本 */
export const PLUGIN_API_VERSIONS = [1] as const
export const PLUGIN_API_VERSION = 1

export const MANIFEST_FILE = 'domi-plugin.yaml'

/**
 * 弃用登记（AC-2）。命中时 warn，并写明哪个版本移除。
 * 形状：manifest 里的字段路径 → 说明
 */
export const DEPRECATIONS: ReadonlyArray<{ path: string; since: string; removeIn: string; instead: string }> = [
  // 示例：api 1.0 早期草案里工具入口叫 main，正式版改名 entry。先认着，2.0 移除
  { path: 'contributes.tools[].main', since: '1.0', removeIn: '2.0', instead: 'contributes.tools[].entry' },
]

const Name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, '只许小写字母、数字和 -，最长 40')

export const PluginToolSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    description: z.string().min(1).max(500),
    entry: z.string().min(1),
    input: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
    /** 默认 30 秒，最长 120 秒 */
    timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  })
  .strict()

export const PluginUiSchema = z
  .object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), title: z.string().min(1), entry: z.string().min(1) })
  .strict()

export const PluginPermissionsSchema = z
  .object({
    /** 相对工作目录的 glob。宿主代读 */
    read: z.array(z.string()).default([]),
    write: z.array(z.string()).default([]),
    /** ctx.fetch 可访问的主机；`*.example.com` 匹配子域 */
    hosts: z.array(z.string()).default([]),
  })
  .strict()
export type PluginPermissions = z.infer<typeof PluginPermissionsSchema>

export const ManifestSchema = z
  .object({
    name: Name,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, '要是 semver，比如 0.1.0'),
    api: z.number().int(),
    description: z.string().max(500).default(''),
    author: z.string().optional(),
    homepage: z.string().optional(),
    /** 必填：缺了安装失败（M6-002 AC-1）。什么都不要也要写 permissions: {} */
    permissions: PluginPermissionsSchema,
    contributes: z
      .object({
        tools: z.array(PluginToolSchema).default([]),
        skills: z.array(z.string()).default([]),
        mcp: z.array(McpServerSchema).default([]),
        ui: z.array(PluginUiSchema).default([]),
      })
      .strict()
      .default({ tools: [], skills: [], mcp: [], ui: [] }),
  })
  .strict()
export type PluginManifest = z.infer<typeof ManifestSchema>

export class ManifestError extends Error {
  constructor(message: string) {
    super(`插件 manifest 有问题：${message}`)
    this.name = 'ManifestError'
  }
}

/** 旧写法改成新写法，并返回弃用告警 */
function upgrade(raw: unknown): { raw: unknown; warnings: string[] } {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') return { raw, warnings }
  const copy = structuredClone(raw) as Record<string, unknown>
  const tools = (copy.contributes as { tools?: Array<Record<string, unknown>> } | undefined)?.tools
  for (const t of tools ?? []) {
    if ('main' in t && !('entry' in t)) {
      const d = DEPRECATIONS[0] as (typeof DEPRECATIONS)[number]
      warnings.push(`${d.path} 自 ${d.since} 起弃用，将在 ${d.removeIn} 移除；请改用 ${d.instead}`)
      t.entry = t.main
      delete t.main
    }
  }
  return { raw: copy, warnings }
}

export function parseManifest(text: string): { manifest: PluginManifest; warnings: string[] } {
  let raw: unknown
  try {
    raw = Bun.YAML.parse(text)
  } catch (e) {
    throw new ManifestError(`YAML 读不懂：${e instanceof Error ? e.message : String(e)}`)
  }
  if (raw && typeof raw === 'object' && !('permissions' in raw)) {
    throw new ManifestError(
      '缺少 permissions。插件必须显式声明要读写哪些文件、访问哪些主机——什么都不要也写 permissions: {}',
    )
  }
  const { raw: upgraded, warnings } = upgrade(raw)
  const parsed = ManifestSchema.safeParse(upgraded)
  if (!parsed.success) {
    throw new ManifestError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const m = parsed.data
  if (!(PLUGIN_API_VERSIONS as readonly number[]).includes(m.api)) {
    throw new ManifestError(
      `插件要的是 API ${m.api}，这个 domi 支持 ${PLUGIN_API_VERSIONS.join('、')}。升级 domi 或找对应版本的插件`,
    )
  }
  for (const p of [
    ...m.contributes.tools.map((t) => t.entry),
    ...m.contributes.skills,
    ...m.contributes.ui.map((u) => u.entry),
  ]) {
    if (p.startsWith('/') || p.split(/[\\/]/).includes('..')) throw new ManifestError(`路径必须在插件目录里：${p}`)
  }
  return { manifest: m, warnings }
}

/** 插件工具在 domi 里的名字（也是能力 id） */
export function toolId(plugin: string, tool: string): string {
  return `plugin.${plugin}.${tool}`
}

/** 给人看的权限清单（安装确认用） */
export function describePermissions(m: PluginManifest): string[] {
  const p = m.permissions
  const lines: string[] = []
  for (const g of p.read) lines.push(`读取工作目录下的 ${g}`)
  for (const g of p.write) lines.push(`写入工作目录下的 ${g}`)
  for (const h of p.hosts) lines.push(`访问网络主机 ${h}`)
  for (const s of m.contributes.mcp) {
    lines.push(
      `启动 MCP server「${s.name}」：${s.command ? `${s.command} ${(s.args ?? []).join(' ')}` : s.url}（它是独立进程，不在插件沙箱里）`,
    )
  }
  for (const t of m.contributes.tools) lines.push(`提供工具 ${toolId(m.name, t.name)}（调用时仍按你的权限规则确认）`)
  if (lines.length === 0) lines.push('不需要任何文件或网络权限')
  return lines
}
