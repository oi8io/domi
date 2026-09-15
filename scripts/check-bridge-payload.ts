/**
 * PRD-M5-007 AC-5 · 桥接出站消息里没有文件内容与代码正文（INV-11）
 *
 * 做法：把一次真实运行会产生的事件（写文件、读文件、跑命令，全都带着「内容」）喂给 client-core 的投影，
 * 再交给桥接唯一的出站格式化函数，断言输出里一个内容字符串都没有。
 * 格式化函数改坏了（比如顺手把 summary 带上）这里立刻红。
 *
 * 用法：bun run scripts/check-bridge-payload.ts [--inject]
 *   --inject：造一个违规（把节点输出带进消息），证明这道守卫会红
 */
import { formatAsk, formatProgress } from '../apps/bridge-telegram/src/format.ts'
import { createSessionStore, type TranscriptItem } from '../packages/client-core/src/index.ts'
import type { EventEnvelope } from '../packages/protocol/src/index.ts'

const SECRETS = [
  'const SECRET_FILE_BODY = 42', // fs.write 的内容
  'PRIVATE_README_LINE', // fs.read 的结果
  'rm -rf /very/private/path', // shell.exec 的命令
  'NODE_OUTPUT_WITH_CODE()', // 节点输出
  'deploy-token-abc', // 命令参数里的东西
]

const evs: Array<EventEnvelope['ev']> = [
  { t: 'task.run', name: '发布', spec: { name: '发布', nodes: [] } },
  { t: 'task.node', nodeId: 'write', status: 'started', attempt: 1 },
  { t: 'tool.call', id: 'c1', name: 'fs.write', args: { path: '/Users/me/app/secret.ts', content: SECRETS[0] } },
  { t: 'tool.result', id: 'c1', ok: true, payload: { bytes: 20 }, ms: 3 },
  { t: 'tool.call', id: 'c2', name: 'fs.read', args: { path: 'README.md' } },
  { t: 'tool.result', id: 'c2', ok: true, payload: SECRETS[1], ms: 1 },
  { t: 'task.node', nodeId: 'write', status: 'done', attempt: 1, output: SECRETS[3], ms: 1200 },
  { t: 'task.node', nodeId: 'shell', status: 'failed', attempt: 1, error: `${SECRETS[2]} ${SECRETS[4]}`, ms: 10 },
  { t: 'task.end', status: 'failed' },
]

const store = createSessionStore()
store.applyEvents(
  evs.map((ev, i) => ({ seq: i + 1, sessionId: 'run-x', parentSeq: i || null, ts: 0, schemaVersion: 8, ev })),
)

const inject = process.argv.includes('--inject')
const format = (item: TranscriptItem): string | null => {
  const text = formatProgress('run-x', item)
  return inject && text !== null ? `${text}\n${item.summary ?? ''}` : text
}

const out: string[] = []
for (const item of store.$items.get()) {
  const t = format(item)
  if (t !== null) out.push(t)
}
out.push(
  formatAsk('run-x', {
    askId: 'k',
    capabilityId: 'fs.write',
    detail: JSON.stringify({ path: '/Users/me/app/secret.ts', content: `${SECRETS[0]}\nline2` }),
  }),
  formatAsk('run-x', {
    askId: 'k2',
    capabilityId: 'shell.exec',
    detail: JSON.stringify({ cmd: `${SECRETS[2]} ${SECRETS[4]}` }),
  }),
)

const joined = out.join('\n---\n')
const leaks = SECRETS.filter((s) => joined.includes(s))
const leakedPath = joined.includes('/Users/me')
if (leaks.length > 0 || leakedPath) {
  console.error('[check-bridge-payload] 桥接出站消息里出现了不该出现的内容（PRD-M5-007 AC-5）：')
  for (const l of leaks) console.error(`  - ${l}`)
  if (leakedPath) console.error('  - 本机完整路径 /Users/me/…')
  process.exit(1)
}
if (out.length < 5) {
  console.error(`[check-bridge-payload] 只生成了 ${out.length} 条消息——喂进去的事件没有被投影，这道守卫就是空转`)
  process.exit(1)
}
console.log(`[check-bridge-payload] OK —— ${out.length} 条出站消息，没有文件内容、命令原文或节点输出`)
