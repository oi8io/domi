/**
 * TASK-M0-011 · AI SDK 适配 —— docs/adr/004
 *
 * **不打真接口**（INV-08）：用 ai/test 的 MockLanguageModelV4 打桩。
 * 这个文件的重点不是「能不能跑通」，是 ADR-004 的红线有没有守住：
 * providerOptions 原样下去、provider 的原始 usage 字段整块上来。
 */
import { describe, expect, test } from 'bun:test'
import { VENDORS } from '@domi/config'
import type { ToolSchema } from '@domi/protocol'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { AiSdkProvider, buildToolNameMap, encodeToolName, type ModelEvent, toAiMessages } from '../src/index.ts'

/** 这些用例不验能力拒绝，所以给一个全支持的矩阵 */
const CAPS = VENDORS.openai.capabilities

/**
 * AI SDK 在 finish 阶段会读 usage 的内部结构，给 `{}` 会炸。
 * 我们的适配层把它转成 recoverable 的 error 事件（行为是对的），
 * 但 fixture 要给合法形状，否则测的是错误路径而不是正常路径。
 */
const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

const TOOLS: ToolSchema[] = [
  { name: 'fs.read', description: '读文件', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
]

function mock(chunks: unknown[], capture?: (opts: Record<string, unknown>) => void): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async (opts) => {
      capture?.(opts as unknown as Record<string, unknown>)
      return { stream: simulateReadableStream({ chunks: chunks as never, chunkDelayInMs: 0 }) }
    },
  })
}

async function drain(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

/** AI SDK v7 拒绝空 prompt，所以每个用例都得有一条真实消息 */
const USER = { role: 'user' as const, content: '读一下 a.txt' }

const START = [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'id-0', modelId: 'mock', timestamp: new Date(0) },
]

describe('流翻译', () => {
  test('text-delta / reasoning-delta / tool-call 各就各位', async () => {
    const p = new AiSdkProvider({
      id: 'mock',
      capabilities: CAPS,
      model: mock([
        ...START,
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: '先读文件' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: '好的' },
        { type: 'text-end', id: 't1' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', input: '{"path":"a.txt"}' },
        { type: 'finish', finishReason: 'tool-calls', usage: USAGE },
      ]),
    })
    const evs = await drain(p.generate({ model: 'm', messages: [USER], tools: TOOLS }, new AbortController().signal))

    expect(evs.filter((e) => e.type === 'reason')).toEqual([{ type: 'reason', text: '先读文件' }])
    expect(evs.filter((e) => e.type === 'delta')).toEqual([{ type: 'delta', text: '好的' }])
    const call = evs.find((e) => e.type === 'tool-call')
    // 关键：工具名要换回带点的原名，不能把 fs_read 丢给 ToolRegistry
    expect(call).toEqual({ type: 'tool-call', id: 'c1', name: 'fs.read', args: { path: 'a.txt' } })
  })

  test('构造期就抛的错（空 prompt）也变成 error 事件，不穿透到 loop 外', async () => {
    const p = new AiSdkProvider({
      id: 'mock',
      capabilities: CAPS,
      model: mock([...START, { type: 'finish', finishReason: 'stop', usage: USAGE }]),
    })
    const evs = await drain(p.generate({ model: 'm', messages: [] }, new AbortController().signal))
    const err = evs.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { recoverable: boolean }).recoverable).toBe(true)
  })

  test('流中途出错变成 recoverable 的 error 事件，不把异常抛给 loop', async () => {
    const p = new AiSdkProvider({
      id: 'mock',
      capabilities: CAPS,
      model: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error('upstream 503')
        },
      }),
    })
    const evs = await drain(p.generate({ model: 'm', messages: [USER] }, new AbortController().signal))
    const err = evs.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { recoverable: boolean }).recoverable).toBe(true)
    expect((err as { message: string }).message).toContain('503')
  })
})

describe('docs/adr/004 的红线', () => {
  test('providerOptions 原样传到 provider，没有被适配层改写', async () => {
    let seen: Record<string, unknown> | undefined
    const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' }, thinking: { budgetTokens: 2048 } } }
    const p = new AiSdkProvider({
      id: 'mock',
      capabilities: CAPS,
      model: mock([...START, { type: 'finish', finishReason: 'stop', usage: USAGE }], (o) => {
        seen = o
      }),
    })
    await drain(p.generate({ model: 'm', messages: [USER], providerOptions }, new AbortController().signal))
    expect(seen?.providerOptions).toEqual(providerOptions)
  })

  test('usage 事件整块带回 providerMetadata，不挑字段', async () => {
    const p = new AiSdkProvider({
      id: 'mock',
      capabilities: CAPS,
      model: mock([
        ...START,
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 100, outputTokens: 20 },
          providerMetadata: { anthropic: { cacheReadInputTokens: 88, cacheCreationInputTokens: 12 } },
        },
      ]),
    })
    const evs = await drain(p.generate({ model: 'm', messages: [USER] }, new AbortController().signal))
    const usage = evs.find((e) => e.type === 'usage') as { raw: Record<string, unknown> } | undefined
    expect(usage).toBeDefined()
    // 这两个字段是 M2「压缩 × prompt cache」的唯一输入，丢了那块就没法做
    expect(JSON.stringify(usage?.raw)).toContain('cacheReadInputTokens')
    expect(JSON.stringify(usage?.raw)).toContain('cacheCreationInputTokens')
  })
})

describe('工具名编码（Anthropic 不接受带点的名字）', () => {
  test('点换成下划线，且能反查回原名', () => {
    expect(encodeToolName('fs.read')).toBe('fs_read')
    expect(buildToolNameMap(TOOLS).get('fs_read')).toBe('fs.read')
  })

  test('编码后撞名直接报错，不悄悄猜一个', () => {
    expect(() =>
      buildToolNameMap([
        { name: 'fs.read', description: '', inputSchema: {} },
        { name: 'fs_read', description: '', inputSchema: {} },
      ]),
    ).toThrow(/冲突/)
  })
})

describe('消息转换', () => {
  test('assistant 的 toolCalls 与随后的 tool 结果能对上 toolName', () => {
    const ai = toAiMessages([
      { role: 'user', content: '读一下' },
      { role: 'assistant', content: '好', toolCalls: [{ id: 'c1', name: 'fs.read', args: { path: 'a' } }] },
      { role: 'tool', toolCallId: 'c1', ok: true, content: '{"lines":3}' },
    ])
    expect(ai).toHaveLength(3)
    const toolMsg = ai[2] as { content: Array<{ toolName: string; output: { value: unknown } }> }
    expect(toolMsg.content[0]?.toolName).toBe('fs_read')
    expect(toolMsg.content[0]?.output.value).toEqual({ lines: 3 })
  })

  test('工具结果不是 JSON 时也不崩，包成 raw', () => {
    const ai = toAiMessages([{ role: 'tool', toolCallId: 'c1', ok: false, content: '这不是 JSON' }])
    const toolMsg = ai[0] as { content: Array<{ output: { value: unknown } }> }
    expect(toolMsg.content[0]?.output.value).toEqual({ raw: '这不是 JSON' })
  })
})
