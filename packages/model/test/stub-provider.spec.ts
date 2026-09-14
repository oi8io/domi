/**
 * PRD-M0-002 · 模型层边界
 * SPEC-M0-003 / docs/adr/004 —— 重点是 providerOptions 与原始 usage 的原样透传
 */
import { describe, expect, test } from 'bun:test'
import type { ModelEvent } from '../src/index.ts'
import { StubProvider } from '../src/index.ts'

async function drain(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('StubProvider', () => {
  test('按轮次消费脚本', async () => {
    const p = new StubProvider([[{ type: 'delta', text: '第一轮' }], [{ type: 'delta', text: '第二轮' }]])
    const req = { model: 'm', messages: [] }
    expect(await drain(p.generate(req, new AbortController().signal))).toEqual([{ type: 'delta', text: '第一轮' }])
    expect(await drain(p.generate(req, new AbortController().signal))).toEqual([{ type: 'delta', text: '第二轮' }])
  })

  test('脚本用尽时默认抛错，暴露「多跑了一轮」', async () => {
    const p = new StubProvider([[{ type: 'delta', text: 'x' }]])
    const req = { model: 'm', messages: [] }
    await drain(p.generate(req, new AbortController().signal))
    await expect(drain(p.generate(req, new AbortController().signal))).rejects.toThrow(/只有 1 轮/)
  })

  test('providerOptions 原样到达 provider，未被抽象层改写（ADR-004 的逃生口）', async () => {
    const p = new StubProvider([[]])
    const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' }, thinking: { budgetTokens: 1024 } } }
    await drain(p.generate({ model: 'm', messages: [], providerOptions }, new AbortController().signal))
    expect(p.calls[0]?.providerOptions).toEqual(providerOptions)
    expect(p.calls[0]?.providerOptions).toBe(providerOptions)
  })

  test('usage 事件携带未归一的原始字段', async () => {
    const raw = { input_tokens: 128, cache_read_input_tokens: 96, cache_creation_input_tokens: 32 }
    const p = new StubProvider([[{ type: 'usage', raw }]])
    const [ev] = await drain(p.generate({ model: 'm', messages: [] }, new AbortController().signal))
    expect(ev).toEqual({ type: 'usage', raw })
    expect(Object.keys((ev as { raw: Record<string, unknown> }).raw)).toContain('cache_read_input_tokens')
  })

  test('abort 后立即停止产出', async () => {
    const ac = new AbortController()
    const p = new StubProvider([
      [
        { type: 'delta', text: 'a' },
        { type: 'delta', text: 'b' },
      ],
    ])
    const out: ModelEvent[] = []
    for await (const e of p.generate({ model: 'm', messages: [] }, ac.signal)) {
      out.push(e)
      ac.abort()
    }
    expect(out).toHaveLength(1)
  })

  test('函数式剧本能读到本轮 request，便于按上下文分支', async () => {
    const p = new StubProvider([(req, turn) => [{ type: 'delta', text: `${turn}:${req.messages.length}` }]])
    const [ev] = await drain(
      p.generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal),
    )
    expect(ev).toEqual({ type: 'delta', text: '0:1' })
  })
})
