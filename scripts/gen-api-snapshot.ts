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
import * as protocol from '../packages/protocol/src/index.ts'

const OUT = 'packages/protocol/.api.md'

interface ZodDefLike {
  typeName?: string
  innerType?: ZodTypeAny
  value?: unknown
  values?: unknown[]
}

function kindOf(t: ZodTypeAny): string {
  const def = t._def as ZodDefLike
  const name = (def.typeName ?? 'Unknown').replace(/^Zod/, '')
  if (name === 'Optional' && def.innerType) return kindOf(def.innerType) + '?'
  if (name === 'Nullable' && def.innerType) return kindOf(def.innerType) + ' | null'
  if (name === 'Literal') return JSON.stringify(def.value)
  if (name === 'Enum') return (def.values as string[]).map((v) => JSON.stringify(v)).join(' | ')
  return name.toLowerCase()
}

function shapeLines(schema: ZodObject<ZodRawShape>, indent: string): string[] {
  return Object.entries(schema.shape)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => indent + k + ': ' + kindOf(v as ZodTypeAny))
}

function tagOf(o: ZodObject<ZodRawShape>): string {
  return (o.shape.t as unknown as { _def: { value: string } })._def.value
}

const options = protocol.DomiEventSchema.options as unknown as ZodObject<ZodRawShape>[]

const lines: string[] = [
  '# @domi/protocol 事件契约快照',
  '',
  '> 由 `bun run scripts/gen-api-snapshot.ts` 生成，**不要手改**。',
  '> 这份文件变了就意味着协议契约变了（INV-01）。',
  '> 改之前先回答一个问题：**用旧版本写下的事件，新代码还能不能解析？**',
  '',
  'SCHEMA_VERSION = ' + String(protocol.SCHEMA_VERSION),
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
for (const k of Object.keys(protocol).sort()) lines.push('  ' + k)
lines.push('')

const content = lines.join('\n')

if (process.argv.includes('--check')) {
  let existing = ''
  try {
    existing = readFileSync(OUT, 'utf8')
  } catch {
    console.error('[api-snapshot] ' + OUT + ' 不存在。先跑一次不带 --check 的生成。')
    process.exit(1)
  }
  if (existing !== content) {
    console.error('[api-snapshot] ' + OUT + ' 与当前契约不一致 —— 协议变了。')
    console.error('若这是有意的：重新生成快照，并在 commit message 里说明旧事件为什么仍可解析。')
    process.exit(1)
  }
  console.log('[api-snapshot] OK —— 协议契约未变')
} else {
  writeFileSync(OUT, content, 'utf8')
  console.log('[api-snapshot] 已写入 ' + OUT + '（' + String(options.length) + ' 个事件类型）')
}
