/**
 * 生成随仓库一起提交的示范 fixture —— PRD-M2-008
 *
 * 为什么要有它：新克隆的仓库里 `~/.domi/events.db` 是空的，`domi eval run` 无事可做。
 * 一条提交在仓库里的 fixture 让**任何人 clone 下来就能跑通整条回放链路**，
 * 不需要先有一次真实会话、更不需要 API key。提测的人第一条命令就是它。
 *
 * 这条会话是手写的**真实形状**（读文件 → 改文件 → 跑测试），不是真实对话——
 * 真实对话里可能带用户路径与凭据，那种东西不进版本库（INV-11）。
 *
 * 用法：bun run scripts/make-demo-fixture.ts
 */
import { writeFileSync } from 'node:fs'
import { record, serialize } from '../packages/eval/src/index.ts'
import type { DomiEvent, EventEnvelope } from '../packages/protocol/src/index.ts'

const SESSION = 'demo-edit-and-test'
let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq++
  return {
    seq,
    sessionId: SESSION,
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 3,
    ev,
  }
}

const events: EventEnvelope[] = [
  env({ t: 'user.input', text: '把 sum.js 的减号改成加号并跑测试' }),
  env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 3 }),
  env({ t: 'model.reason', text: '先读文件再改' }),
  env({ t: 'model.delta', text: '我先看看这个文件。' }),
  env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } }),
  env({ t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'config', matchedRule: 'allow-read' }),
  env({
    t: 'tool.result',
    id: 'c1',
    ok: true,
    payload: { lines: 1, text: 'export const sum = (a, b) => a - b' },
    ms: 4,
  }),
  env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 9 }),
  env({ t: 'model.delta', text: '减号应该是加号，改掉。' }),
  env({
    t: 'tool.call',
    id: 'c2',
    name: 'fs.write',
    args: { path: 'sum.js', content: 'export const sum = (a, b) => a + b' },
  }),
  env({ t: 'permission', capabilityId: 'fs.write', decision: 'allow', source: 'user', matchedRule: 'confirm-write' }),
  env({ t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 34 }, ms: 2 }),
  env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 14 }),
  env({ t: 'tool.call', id: 'c3', name: 'shell.exec', args: { cmd: 'bun test sum.spec.js' } }),
  env({ t: 'permission', capabilityId: 'shell.exec', decision: 'allow', source: 'user', matchedRule: 'confirm-shell' }),
  env({ t: 'tool.result', id: 'c3', ok: true, payload: { stdout: '1 pass 0 fail', exitCode: 0 }, ms: 312 }),
  env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 20 }),
  env({ t: 'model.delta', text: '改好了，测试通过。' }),
  env({ t: 'model.usage', raw: { input_tokens: 421, output_tokens: 88, cache_read_input_tokens: 256 } }),
]

const out = `fixtures/sessions/${SESSION}.json`
writeFileSync(out, serialize(record(events, SESSION)), 'utf8')
console.log(`[make-demo-fixture] 写出 ${out}（${events.length} 条事件）`)
