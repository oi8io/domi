/**
 * TASK-M15-003 · 厂商适配层（PRD-M15-006）
 *
 * render.ts 是纯函数：给定厂商 / 会话档位，产出 providerOptions 与消息渲染参数。
 * 测试断言请求体形状（缓存参数 / 工具结果文本 / 推理回传），不碰真实网络。
 */
import { describe, expect, test } from 'bun:test'
import { renderProviderOptions, toAiMessages } from '../src/index.ts'

const ANTHROPIC = { cacheMode: 'explicit', baseUrl: 'https://api.anthropic.com', official: true } as const
const OPENAI_OFFICIAL = { cacheMode: 'gateway-key', baseUrl: 'https://api.openai.com/v1', official: true } as const
const OPENAI_GATEWAY = { cacheMode: 'gateway-key', baseUrl: 'https://gw.example.com/v1', official: false } as const

describe('renderProviderOptions · 缓存参数', () => {
  test('anthropic：顶层 cache_control（ttl 按会话档位）；task 60 分钟', () => {
    const po = renderProviderOptions(ANTHROPIC, { sessionId: 's1', kind: 'task' })
    expect(po).toMatchObject({
      anthropic: {
        cacheControl: { type: 'ephemeral', ttlSeconds: 3600 },
      },
    })
    // system 末尾显式断点由 AiSdkProvider 组装（它知道 system 文本），见 ai-sdk-provider.spec
  })

  test('自由会话默认 5 分钟；cacheTtlOverride 兜底', () => {
    const chat = renderProviderOptions(ANTHROPIC, { sessionId: 's1', kind: 'chat' }).anthropic as {
      cacheControl: { type: string; ttlSeconds: number }
    }
    expect(chat.cacheControl).toEqual({ type: 'ephemeral', ttlSeconds: 300 })
    const over = renderProviderOptions(ANTHROPIC, { sessionId: 's1', kind: 'task', ttlOverride: 42 }).anthropic as {
      cacheControl: { type: string; ttlSeconds: number }
    }
    expect(over.cacheControl).toEqual({ type: 'ephemeral', ttlSeconds: 42 })
  })

  test('openai 兼容网关发 prompt_cache_key（会话 id）；官方 openai 不发', () => {
    expect(
      (renderProviderOptions(OPENAI_GATEWAY, { sessionId: 's-9', kind: 'task' }).openai as { extraBody: object })
        .extraBody,
    ).toEqual({ prompt_cache_key: 's-9' })
    expect(renderProviderOptions(OPENAI_OFFICIAL, { sessionId: 's-9', kind: 'task' }).openai).toBeUndefined()
  })

  test('deepseek 自动缓存：不发任何缓存参数（能力表已按实际改 true）', () => {
    const po = renderProviderOptions(
      { cacheMode: 'auto', baseUrl: 'https://api.deepseek.com/v1', official: false },
      { sessionId: 's1', kind: 'task' },
    )
    expect(po.openai).toBeUndefined()
  })
})

describe('toAiMessages · 工具结果纯文本（SPEC-M15-006 AC-3 · R3 复测）', () => {
  test('tool.result 走 output:{type:"text"}，原文直发，不再 JSON 双层转义', () => {
    const ai = toAiMessages([{ role: 'tool', toolCallId: 'c1', ok: true, content: '{"lines":3}' }])
    const toolMsg = ai[0] as { content: Array<{ output: { type: string; value: string } }> }
    expect(toolMsg.content[0]?.output.type).toBe('text')
    expect(toolMsg.content[0]?.output.value).toBe('{"lines":3}')
  })
})
