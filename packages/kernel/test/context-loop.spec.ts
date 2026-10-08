/**
 * SPEC-M14-006 取舍-1 · model.request.ctx 由 kernel 纯计算（PRD-M14-006 AC-1）
 * - 有 prompt（含 layers）→ ctx 带上层清单 + tools / history 估算（estimateTextTokens 口径 · BUG-M14-001）
 * - 无 prompt（或没层）→ 不带 ctx，旧事件端上照常解析（AC-2）
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateTextTokens } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { type Clock, type ProviderLike, runTurn } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const make = (): { clock: Clock & { t: number }; sink: SqliteEventLog; provider: ProviderLike } => {
  const d = mkdtempSync(join(tmpdir(), 'domi-ctx-'))
  dirs.push(d)
  const clock: Clock & { t: number } = { t: 1_000_000, now: () => clock.t }
  const sink = new SqliteEventLog({ path: join(d, 'e.db'), clock })
  const provider: ProviderLike = {
    id: 'stub',
    async *generate() {
      yield { type: 'delta', text: '好' }
      yield { type: 'usage', raw: { input_tokens: 10, output_tokens: 20 } }
    },
  }
  return { clock, sink, provider }
}

test('有 prompt（含 layers）→ model.request 带 ctx：层清单原样 + tools/history 估算', async () => {
  const { clock, sink, provider } = make()
  const layers: Array<{ id: string; role: 'system' | 'user'; cacheable: boolean; approxTokens: number }> = [
    { id: 'builtin.identity', role: 'system', cacheable: true, approxTokens: 100 },
    { id: 'session.plan', role: 'user', cacheable: false, approxTokens: 30 },
  ]
  const tools = [
    { name: 'fs.read', description: '读文件' },
    { name: 'fs.write', description: '写文件' },
  ]
  await runTurn(
    {
      sink,
      clock,
      provider,
      tools: {
        schemas: () => tools as never,
        run: async () => ({ ok: true, payload: {} }),
      },
      policy: { maxTokens: 1_000_000, includeReasoning: false },
      model: 'm',
      prompt: () => ({ system: 'sys', dynamic: 'usr', layers }),
    },
    's',
    '你好',
  )
  const evs = await sink.read('s')
  const req = evs.find((e) => e.ev.t === 'model.request')!
  const ctx = (req.ev as { ctx?: { layers: unknown[]; tools: number; history: number } }).ctx
  expect(ctx).not.toBeUndefined()
  expect(ctx!.layers).toEqual(layers)
  // tools / history = 工具 schema、消息的 JSON 文本按 estimateTextTokens 口径估算
  expect(ctx!.tools).toBe(estimateTextTokens(JSON.stringify(tools)))
  // M15（SPEC-M15-003）：dynamic 弃用后消息里没有尾巴（prompt.system unshift + history 的 user）
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '你好' },
  ]
  expect(ctx!.history).toBe(estimateTextTokens(JSON.stringify(messages)))
  sink.close()
})

test('没有 prompt → 不带 ctx（旧宿主路径；端上 hasLayers=false）', async () => {
  const { clock, sink, provider } = make()
  await runTurn(
    {
      sink,
      clock,
      provider,
      tools: {
        schemas: () => [],
        run: async () => ({ ok: true, payload: {} }),
      },
      policy: { maxTokens: 1_000_000, includeReasoning: false },
      model: 'm',
    },
    's',
    '你好',
  )
  const evs = await sink.read('s')
  const req = evs.find((e) => e.ev.t === 'model.request')!
  expect((req.ev as { ctx?: unknown }).ctx).toBeUndefined()
  sink.close()
})

// BUG-M14-001：history 原来是 JSON 长度 / 4，1000 个汉字只算约 260，上下文 tab 的「对话历史」偏小、「未归类」被撑大
test('BUG-M14-001 · 中文对话历史按 CJK 口径估算：1000 个汉字 → history ≥ 1000', async () => {
  const { clock, sink, provider } = make()
  await runTurn(
    {
      sink,
      clock,
      provider,
      tools: {
        schemas: () => [],
        run: async () => ({ ok: true, payload: {} }),
      },
      policy: { maxTokens: 1_000_000, includeReasoning: false },
      model: 'm',
      prompt: () => ({ system: 'sys', dynamic: 'usr', layers: [] }),
    },
    's',
    '中'.repeat(1_000),
  )
  const evs = await sink.read('s')
  const req = evs.find((e) => e.ev.t === 'model.request')!
  const ctx = (req.ev as { ctx?: { history: number } }).ctx
  expect(ctx!.history).toBeGreaterThanOrEqual(1_000)
  sink.close()
})
