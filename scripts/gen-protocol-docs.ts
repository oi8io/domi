/**
 * 协议文档由 schema 生成 —— PRD-M3-001 AC-4
 *
 * **手写的协议文档一定会过期。** 不是因为人懒，是因为改代码和改文档是两个动作，
 * 而只有第一个是必须做的。所以这份文档从 zod 方法表生成，CI 断言它与仓库里的一致——
 * 于是「改了协议忘了改文档」变成一次构建失败，而不是三个月后某个人的困惑。
 *
 * 顺带产出 JSON Schema（AC-1）：`docs/protocol.schema.json`。
 *
 * 用法：
 *   bun run scripts/gen-protocol-docs.ts          写入
 *   bun run scripts/gen-protocol-docs.ts --check  只比对，CI 用
 *
 * 接线：`pnpm guard:protocol`（在 `pnpm guard` 链里）。
 * `docs/protocol.schema.json` 在 biome.json 里排除——它是生成产物，格式归本脚本管；
 * 让 biome 再格式化一遍，两边会互相改写，`--check` 就永远红。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import {
  METHODS,
  type MethodName,
  NOTIFICATIONS,
  type NotificationName,
  PROTOCOL_VERSION,
} from '../packages/protocol/src/rpc.ts'

const DOC = 'docs/protocol.md'
const SCHEMA = 'docs/protocol.schema.json'

function jsonSchema(s: z.ZodType): unknown {
  return z.toJSONSchema(s, { io: 'input' })
}

function block(title: string, s: z.ZodType): string {
  return `${title}\n\n\`\`\`json\n${JSON.stringify(jsonSchema(s), null, 2)}\n\`\`\`\n`
}

function render(): string {
  const lines: string[] = [
    '# Domi Protocol',
    '',
    `> **本文件由 \`scripts/gen-protocol-docs.ts\` 生成，不要手改。** 改协议请改 \`packages/protocol/src/rpc.ts\`。`,
    `> 协议版本 **v${PROTOCOL_VERSION}** · 传输：JSON-RPC 2.0 over stdio（本地）/ WebSocket（远程）`,
    '',
    '## 约定',
    '',
    '- **握手必须是第一个请求**；未握手的其它请求返回 `NOT_HANDSHAKED`。',
    '- **版本不匹配就断开，不降级**：返回 `PROTOCOL_VERSION_MISMATCH`，`data` 里带双方版本号。',
    '- **事件推送是通知**（没有 `id`），客户端不轮询。断线重连时用 `session.subscribe` 的 `fromSeq` 断点续订。',
    '- **daemon 是事件流的唯一写入者**，客户端只提交意图。',
    '',
    '## 方法',
    '',
  ]

  for (const name of Object.keys(METHODS) as MethodName[]) {
    const m = METHODS[name]
    lines.push(`### \`${name}\``, '', m.summary, '', block('**params**', m.params), block('**result**', m.result))
  }

  lines.push('## 通知（服务端 → 客户端）', '')
  for (const name of Object.keys(NOTIFICATIONS) as NotificationName[]) {
    const n = NOTIFICATIONS[name]
    lines.push(`### \`${name}\``, '', n.summary, '', block('**params**', n.params))
  }

  return `${lines.join('\n')}\n`
}

function renderSchema(): string {
  const out: Record<string, unknown> = { protocolVersion: PROTOCOL_VERSION, methods: {}, notifications: {} }
  const methods = out.methods as Record<string, unknown>
  for (const name of Object.keys(METHODS) as MethodName[]) {
    methods[name] = { params: jsonSchema(METHODS[name].params), result: jsonSchema(METHODS[name].result) }
  }
  const notes = out.notifications as Record<string, unknown>
  for (const name of Object.keys(NOTIFICATIONS) as NotificationName[]) {
    notes[name] = { params: jsonSchema(NOTIFICATIONS[name].params) }
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

const check = process.argv.includes('--check')
const pairs: Array<[string, string]> = [
  [DOC, render()],
  [SCHEMA, renderSchema()],
]

if (check) {
  let bad = 0
  for (const [path, next] of pairs) {
    const current = (() => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return ''
      }
    })()
    if (current !== next) {
      console.error(`[PRD-M3-001 AC-4] ${path} 与 schema 不一致`)
      bad++
    }
  }
  if (bad > 0) {
    console.error('\n协议文档由 schema 生成。跑一次 `bun run scripts/gen-protocol-docs.ts` 并把结果一起提交。')
    process.exit(1)
  }
  console.log(`[gen-protocol-docs] OK —— 文档与 schema 一致（协议 v${PROTOCOL_VERSION}）`)
} else {
  for (const [path, next] of pairs) writeFileSync(path, next, 'utf8')
  console.log(`[gen-protocol-docs] 已写入 ${DOC} 与 ${SCHEMA}（协议 v${PROTOCOL_VERSION}）`)
}
