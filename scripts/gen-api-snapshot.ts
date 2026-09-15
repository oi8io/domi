/**
 * INV-01 的守卫之一：把 @domi/protocol 的**事件契约**导出成 .api.md 提交进仓库。
 *
 * 为什么不是 tsc 的类型字符串：zod schema 展开后有 7 万字符，人看不了、diff 也读不了——
 * 那样的快照没人会认真看，等于没有守卫。这里只记真正构成契约的三样：
 * 事件类型集合、每个类型的字段与可选性、信封字段。
 *
 * 目的不是文档，是**让契约变更在 diff 里显式出现**——改事件类型时必须顺手改这份快照，
 * 于是你在 commit 那一刻就会意识到"我正在改契约"。（docs/ENGINEERING.md 第三道防线）
 *
 * 用法：bun run scripts/gen-api-snapshot.ts [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod'
import * as plugin from '../packages/plugin/src/index.ts'
import * as protocol from '../packages/protocol/src/index.ts'

const OUT = 'packages/protocol/.api.md'
const PLUGIN_OUT = 'packages/plugin/.api.md'

/**
 * zod 4 的内省入口是 `schema._zod.def`（v3 是 `_def.typeName`）。
 * 这是私有 API——所以升级 zod 时本脚本必然先红，而这正是它该做的：
 * 契约快照生成不了，就说明契约的读法变了，必须有人看一眼。
 */
interface ZodDef {
  type?: string
  innerType?: ZodTypeAny
  values?: unknown[]
  entries?: Record<string, unknown>
  keyType?: ZodTypeAny
  valueType?: ZodTypeAny
  element?: ZodTypeAny
}

function defOf(t: ZodTypeAny): ZodDef {
  return ((t as unknown as { _zod?: { def?: ZodDef } })._zod?.def ?? {}) as ZodDef
}

function kindOf(t: ZodTypeAny): string {
  const def = defOf(t)
  const name = def.type ?? 'unknown'
  if (name === 'optional' && def.innerType) return `${kindOf(def.innerType)}?`
  if (name === 'nullable' && def.innerType) return `${kindOf(def.innerType)} | null`
  if (name === 'literal') return (def.values ?? []).map((v) => JSON.stringify(v)).join(' | ')
  if (name === 'enum')
    return Object.values(def.entries ?? {})
      .map((v) => JSON.stringify(v))
      .join(' | ')
  if (name === 'array' && def.element) return `${kindOf(def.element)}[]`
  if (name === 'record' && def.keyType && def.valueType) {
    return `record<${kindOf(def.keyType)}, ${kindOf(def.valueType)}>`
  }
  return name
}

function shapeLines(schema: ZodObject<ZodRawShape>, indent: string): string[] {
  return Object.entries(schema.shape)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${indent + k}: ${kindOf(v as ZodTypeAny)}`)
}

function tagOf(o: ZodObject<ZodRawShape>): string {
  const vals = defOf(o.shape.t as unknown as ZodTypeAny).values ?? []
  return String(vals[0] ?? '?')
}

const options = protocol.DomiEventSchema.options as unknown as ZodObject<ZodRawShape>[]

const lines: string[] = [
  '# @domi/protocol 事件契约快照',
  '',
  '> 由 `bun run scripts/gen-api-snapshot.ts` 生成，**不要手改**。',
  '> 这份文件变了就意味着协议契约变了（INV-01）。',
  '> 改之前先回答一个问题：**用旧版本写下的事件，新代码还能不能解析？**',
  '',
  `SCHEMA_VERSION = ${String(protocol.SCHEMA_VERSION)}`,
  '',
  '## 事件类型',
  '',
]

for (const opt of options.slice().sort((a, b) => tagOf(a).localeCompare(tagOf(b)))) {
  lines.push(tagOf(opt))
  lines.push(...shapeLines(opt, '  ').filter((l) => !l.trimStart().startsWith('t: ')))
  lines.push('')
}

lines.push('## 信封', '')
lines.push(...shapeLines(protocol.EventEnvelopeSchema as unknown as ZodObject<ZodRawShape>, '  '))
lines.push('', '## 导出符号', '')
for (const k of Object.keys(protocol).sort()) lines.push(`  ${k}`)
lines.push('')

const content = lines.join('\n')

/** 插件 API 快照（PRD-M6-001 AC-4）：manifest 形状、API 版本、弃用表、ctx 能力、导出符号 */
function nested(schema: ZodTypeAny, indent: string): string[] {
  const def = defOf(schema) as ZodDef & { shape?: ZodRawShape; in?: ZodTypeAny }
  const inner = def.type === 'default' || def.type === 'optional' ? def.innerType : undefined
  if (inner) return nested(inner, indent)
  if (def.type === 'pipe' && def.in) return nested(def.in, indent)
  if (def.type === 'array' && def.element) return nested(def.element, indent)
  const shape = (schema as unknown as ZodObject<ZodRawShape>).shape
  if (def.type !== 'object' || !shape) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(shape).sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`${indent}${k}: ${kindOf(v as ZodTypeAny)}`)
    out.push(...nested(v as ZodTypeAny, `${indent}  `))
  }
  return out
}

const pluginLines = [
  '# @domi/plugin 插件 API 快照',
  '',
  '> 由 `bun run scripts/gen-api-snapshot.ts` 生成，**不要手改**。',
  '> 这份文件变了就意味着插件 API 变了（PRD-M6-001 AC-4，docs/adr/022）：',
  '> 只加可选字段 = 小版本；改名、删字段、改含义 = 主版本，同时要登记弃用。',
  '',
  `PLUGIN_API_VERSIONS = ${JSON.stringify(plugin.PLUGIN_API_VERSIONS)}`,
  `MANIFEST_FILE = ${plugin.MANIFEST_FILE}`,
  `HOST_CALLS = ${plugin.HOST_CALLS.join(', ')}`,
  '',
  '## manifest',
  '',
  ...nested(plugin.ManifestSchema as unknown as ZodTypeAny, '  '),
  '',
  '## 弃用',
  '',
  ...plugin.DEPRECATIONS.map((d) => `  ${d.path}（${d.since} 起弃用，${d.removeIn} 移除；改用 ${d.instead}）`),
  '',
  '## 导出符号',
  '',
  ...Object.keys(plugin)
    .sort()
    .map((k) => `  ${k}`),
  '',
]
const pluginContent = pluginLines.join('\n')

if (process.argv.includes('--check')) {
  let failed = false
  for (const [out, want, what] of [
    [OUT, content, '协议契约'],
    [PLUGIN_OUT, pluginContent, '插件 API'],
  ] as const) {
    let existing = ''
    try {
      existing = readFileSync(out, 'utf8')
    } catch {
      console.error(`[api-snapshot] ${out} 不存在。先跑一次不带 --check 的生成。`)
      failed = true
      continue
    }
    if (existing !== want) {
      console.error(`[api-snapshot] ${out} 与当前${what}不一致 —— ${what}变了。`)
      console.error('若这是有意的：重新生成快照，并在 commit message 里说明为什么旧的仍然可用。')
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log('[api-snapshot] OK —— 协议契约与插件 API 都未变')
} else {
  writeFileSync(OUT, content, 'utf8')
  writeFileSync(PLUGIN_OUT, pluginContent, 'utf8')
  console.log(`[api-snapshot] 已写入 ${OUT}（${String(options.length)} 个事件类型）与 ${PLUGIN_OUT}`)
}
