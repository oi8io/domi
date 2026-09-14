/**
 * PRD-M1-001 AC-2/AC-3 · 能力矩阵与提前拒绝
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { ToolSchema } from '@domi/protocol'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import {
  AiSdkProvider,
  CAPABILITIES,
  UnsupportedCapabilityError,
  assertCapability,
  capabilitiesFor,
  lostCapabilities,
} from '../src/index.ts'

/**
 * AI SDK 在 finish 阶段会读 usage 的内部结构，给 `{}` 会炸。
 * 我们的适配层把它转成 recoverable 的 error 事件（行为是对的），
 * 但 fixture 要给合法形状，否则测的是错误路径而不是正常路径。
 */
const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

const TOOLS: ToolSchema[] = [{ name: 'fs.read', description: '读文件', inputSchema: { type: 'object' } }]

describe('AC-2 · 五个布尔字段', () => {
  test.each(Object.keys(CAPABILITIES))('%s 的矩阵字段齐全', (kind) => {
    const caps = CAPABILITIES[kind as keyof typeof CAPABILITIES]
    expect(Object.keys(caps).sort()).toEqual([
      'promptCache',
      'reasoning',
      'structuredOutput',
      'toolCall',
      'vision',
    ])
    for (const v of Object.values(caps)) expect(typeof v).toBe('boolean')
  })

  test('openai-compatible 全部保守声明为 false —— 后面挂什么我们不知道', () => {
    expect(Object.values(CAPABILITIES['openai-compatible']).every((v) => v === false)).toBe(true)
  })

  test('配置可以覆盖矩阵（用户知道自己的网关支持什么）', () => {
    const caps = capabilitiesFor({
      provider: 'openai-compatible',
      name: 'qwen',
      capabilities: { toolCall: true },
    })
    expect(caps.toolCall).toBe(true)
    expect(caps.vision).toBe(false)
  })
})

describe('AC-3 · 在发出 HTTP 请求之前抛错', () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })

  test('provider 不支持 toolCall 时传工具 → 抛错，且 fetch 一次都没被调用', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalls++
      return original(...args)
    }) as typeof fetch

    const p = new AiSdkProvider({
      id: 'openai-compatible',
      capabilities: CAPABILITIES['openai-compatible'],
      model: new MockLanguageModelV4({
        doStream: async () => ({ stream: simulateReadableStream({ chunks: [], chunkDelayInMs: 0 }) }),
      }),
    })

    const it = p.generate(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS },
      new AbortController().signal,
    )
    await expect((async () => {
      for await (const _ of it) {
        /* 不该走到这里 */
      }
    })()).rejects.toThrow(UnsupportedCapabilityError)

    expect(fetchCalls).toBe(0)
  })

  test('不传工具时不检查 toolCall —— 只有真要用才拦', async () => {
    const p = new AiSdkProvider({
      id: 'openai-compatible',
      capabilities: CAPABILITIES['openai-compatible'],
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'response-metadata', id: 'id-0', modelId: 'mock', timestamp: new Date(0) },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'ok' },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: 'stop', usage: USAGE },
            ] as never,
            chunkDelayInMs: 0,
          }),
        }),
      }),
    })
    const out = []
    for await (const e of p.generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)) {
      out.push(e)
    }
    const errs = out.filter((e) => e.type === 'error')
    expect(errs.map((e) => (e as { message: string }).message)).toEqual([])
    expect(out.some((e) => e.type === 'delta')).toBe(true)
  })

  test('错误信息告诉用户怎么办，而不只是说不支持', () => {
    try {
      assertCapability('openai-compatible', CAPABILITIES['openai-compatible'], 'structuredOutput')
      throw new Error('should throw')
    } catch (e) {
      expect((e as Error).message).toContain('config.toml')
    }
  })
})

describe('PRD-M1-002 AC-2 · 能力差集', () => {
  test('切到更弱的模型时能列出将失去的能力', () => {
    expect(lostCapabilities(CAPABILITIES.openai, CAPABILITIES['openai-compatible']).sort()).toEqual([
      'promptCache',
      'reasoning',
      'structuredOutput',
      'toolCall',
      'vision',
    ])
  })

  test('切到更强的模型时差集为空，不该弹确认', () => {
    expect(lostCapabilities(CAPABILITIES['openai-compatible'], CAPABILITIES.openai)).toEqual([])
  })

  test('anthropic → openai 只失去…什么都不失去（anthropic 没声明 structuredOutput）', () => {
    expect(lostCapabilities(CAPABILITIES.anthropic, CAPABILITIES.openai)).toEqual([])
  })
})
