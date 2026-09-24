/**
 * PRD-M13-002 · 中断当前轮：kernel 的三个检查点（SPEC-M13-002 取舍-2）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StubProvider } from '@domi/model'
import type { EventEnvelope, ToolSchema } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { type ContextPolicy, type LoopDeps, runTurn, type ToolRunner, turnState } from '../src/index.ts'

const POLICY: ContextPolicy = { maxTokens: 1_000_000, includeReasoning: false }
const SCHEMAS: ToolSchema[] = [{ name: 'fs.read', description: '读文件', inputSchema: { type: 'object' } }]
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function deps(over: Partial<LoopDeps> & Pick<LoopDeps, 'provider' | 'tools'>): LoopDeps {
  const d = mkdtempSync(join(tmpdir(), 'domi-int-'))
  dirs.push(d)
  let t = 1
  return {
    sink: new SqliteEventLog({ path: join(d, 'e.db') }),
    clock: { now: () => t++ },
    policy: POLICY,
    model: 's',
    ...over,
  }
}
const tools = (run?: ToolRunner['run']): ToolRunner => ({
  schemas: () => SCHEMAS,
  run: run ?? (async () => ({ ok: true, payload: 1 })),
})
const types = (evs: readonly EventEnvelope[]) => evs.map((e) => e.ev.t)
const lastError = (evs: readonly EventEnvelope[]) => evs.filter((e) => e.ev.t === 'error').at(-1)?.ev

describe('PRD-M13-002 AC-2 / AC-4 · 模型输出中被中断', () => {
  test('已吐出的内容落盘；本步解析出的工具调用不执行、补 interrupted；结束事件带 stopReason 与 by', async () => {
    const ac = new AbortController()
    const provider = new StubProvider([
      () => {
        return [
          { type: 'delta', text: '我先读' },
          { type: 'tool-call', id: 'c1', name: 'fs.read', args: {} },
        ]
      },
    ])
    // provider 吐完第一段就中断：用一个包装在第一条事件之后 abort
    const wrapped = {
      id: provider.id,
      async *generate(req: Parameters<typeof provider.generate>[0], signal: AbortSignal) {
        for await (const ev of provider.generate(req, signal)) {
          yield ev
          if (ev.type === 'tool-call') ac.abort({ by: 'domi-web' })
        }
      },
    }
    let ran = 0
    const d = deps({
      provider: wrapped,
      tools: tools(async () => {
        ran += 1
        return { ok: true, payload: 1 }
      }),
    })
    const r = await runTurn(d, 's1', '读文件', ac.signal)
    expect(r.stopReason).toBe('interrupted')
    expect(ran).toBe(0)
    const evs = await d.sink.read('s1')
    expect(types(evs)).toEqual(['user.input', 'model.request', 'model.delta', 'tool.call', 'tool.result', 'error'])
    expect(evs[4]!.ev).toMatchObject({ t: 'tool.result', id: 'c1', ok: false, reason: 'interrupted' })
    expect(lastError(evs)).toMatchObject({ scope: 'loop', stopReason: 'interrupted', by: 'domi-web' })
    expect(turnState(evs)).toEqual({ open: false, danglingCalls: [] })
  })
})

describe('PRD-M13-002 AC-3 · 工具执行中被中断', () => {
  test('执行中的那个结果标 interrupted，后面的补 interrupted，不再请求模型', async () => {
    const ac = new AbortController()
    const provider = new StubProvider([
      [
        { type: 'tool-call', id: 'c1', name: 'fs.read', args: {} },
        { type: 'tool-call', id: 'c2', name: 'fs.read', args: {} },
        { type: 'tool-call', id: 'c3', name: 'fs.read', args: {} },
      ],
      [{ type: 'delta', text: '不该到这' }],
    ])
    const seen: string[] = []
    const d = deps({
      provider,
      tools: tools(async (call, signal) => {
        seen.push(call.id)
        ac.abort({ by: 'domi-tui' })
        expect(signal.aborted).toBe(true)
        return { ok: false, payload: { error: 'killed' } }
      }),
    })
    const r = await runTurn(d, 's1', 'go', ac.signal)
    expect(r.stopReason).toBe('interrupted')
    expect(seen).toEqual(['c1'])
    expect(provider.calls).toHaveLength(1)
    const results = (await d.sink.read('s1')).filter((e) => e.ev.t === 'tool.result').map((e) => e.ev)
    expect(results).toEqual([
      expect.objectContaining({ id: 'c1', reason: 'interrupted', payload: { error: 'killed' } }),
      expect.objectContaining({ id: 'c2', ok: false, reason: 'interrupted' }),
      expect.objectContaining({ id: 'c3', ok: false, reason: 'interrupted' }),
    ])
    expect(turnState(await d.sink.read('s1')).danglingCalls).toEqual([])
  })
})

describe('PRD-M13-002 · 每步开头的检查点', () => {
  test('开跑前已中断 → 不请求模型，直接收场', async () => {
    const ac = new AbortController()
    ac.abort({ by: 'domi-web' })
    const provider = new StubProvider([[{ type: 'delta', text: 'x' }]])
    const d = deps({ provider, tools: tools() })
    const r = await runTurn(d, 's1', 'go', ac.signal)
    expect(r.stopReason).toBe('interrupted')
    expect(provider.calls).toHaveLength(0)
    expect(types(await d.sink.read('s1'))).toEqual(['user.input', 'error'])
  })

  test('不传 signal：行为不变；其他 stop 也写 stopReason', async () => {
    const provider = new StubProvider([[{ type: 'tool-call', id: 'c1', name: 'fs.read', args: {} }]], {
      onExhausted: 'repeat-last',
    })
    const d = deps({ provider, tools: tools(), limits: { maxToolCalls: 2 } })
    const r = await runTurn(d, 's1', 'go')
    expect(r.stopReason).toBe('max_tool_calls')
    expect(lastError(await d.sink.read('s1'))).toMatchObject({ stopReason: 'max_tool_calls' })
    expect((lastError(await d.sink.read('s1')) as { by?: string }).by).toBeUndefined()
  })
})
