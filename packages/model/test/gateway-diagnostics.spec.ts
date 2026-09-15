/**
 * PRD-M1-001 AC-1 的续篇 · 兼容网关「请求发出去了，但什么都没回来」
 *
 * 真实现场（2026-09-15，M3 骨架轮后第一次用 Web 端）：
 *   DOMI_BASE_URL=https://api.z.ai/api/anthropic   ← Claude Code 的写法，不带 /v1
 *   Web 输入 "Hi" → 事件流里只有一句
 *   「模型流中断：No output generated. The model stream ended without a finish chunk.」
 *
 * 两个问题叠在一起：
 * 1. **base_url 有两种写法**。Anthropic 官方 SDK（以及 Claude Code、各家网关文档）的 base 不带 /v1，
 *    SDK 自己拼 /v1/messages；AI SDK 的 base 要带 /v1，只拼 /messages。
 *    照网关文档填，请求就打到了 .../anthropic/messages——一个不存在的路径。
 * 2. **错误信息没指到任何一环**。「没有 finish chunk」既说不出请求发到了哪，也说不出回来的是什么。
 *
 * 不打真接口（INV-08）：用一个假网关 fetch 复现，只有 /v1/messages 说 SSE，
 * 其它路径学某些网关的样子，回 HTTP 200 + 一段 JSON 错误。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createProvider, normalizeAnthropicBaseUrl } from '../src/index.ts'
import type { ModelEvent } from '../src/provider.ts'

const SSE = [
  [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'glm',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
  ],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
  ],
  ['message_stop', { type: 'message_stop' }],
]
  .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  .join('')

type Mode = 'sse' | 'json-200' | 'empty-sse'

/** 假网关：记下请求 URL；按 mode 决定 /v1/messages 回什么，其它路径一律 200 + JSON */
function fakeGateway(mode: Mode = 'sse') {
  const urls: string[] = []
  const fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input))
    urls.push(url)
    const path = new URL(url).pathname
    if (path.endsWith('/v1/messages') && mode === 'sse') {
      return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (path.endsWith('/v1/messages') && mode === 'empty-sse') {
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ code: 500, msg: '404 NOT_FOUND', success: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { urls, fetch }
}

async function collect(baseUrl: string, mode?: Mode) {
  const gw = fakeGateway(mode)
  const p = createProvider({ provider: 'anthropic', name: 'glm', apiKey: 'k', baseUrl, fetch: gw.fetch })
  const out: ModelEvent[] = []
  for await (const e of p.generate(
    { model: 'glm', messages: [{ role: 'user', content: 'Hi' }] },
    new AbortController().signal,
  )) {
    out.push(e)
  }
  return { out, urls: gw.urls }
}

const text = (out: ModelEvent[]) =>
  out
    .filter((e): e is Extract<ModelEvent, { type: 'delta' }> => e.type === 'delta')
    .map((e) => e.text)
    .join('')
const errors = (out: ModelEvent[]) =>
  out.filter((e): e is Extract<ModelEvent, { type: 'error' }> => e.type === 'error').map((e) => e.message)

describe('base_url 两种写法都认', () => {
  test('Claude Code 写法（不带 /v1）→ 请求打到 /v1/messages，能拿到回答', async () => {
    const { out, urls } = await collect('https://api.z.ai/api/anthropic')
    expect(urls[0]).toBe('https://api.z.ai/api/anthropic/v1/messages')
    expect(errors(out)).toEqual([])
    expect(text(out)).toBe('你好')
  })

  test('AI SDK 写法（带 /v1）不会被拼成 /v1/v1', async () => {
    const { out, urls } = await collect('https://my-gateway.internal/v1/')
    expect(urls[0]).toBe('https://my-gateway.internal/v1/messages')
    expect(text(out)).toBe('你好')
  })

  test('规范化规则本身', () => {
    expect(normalizeAnthropicBaseUrl('https://api.z.ai/api/anthropic')).toBe('https://api.z.ai/api/anthropic/v1')
    expect(normalizeAnthropicBaseUrl('https://api.z.ai/api/anthropic/')).toBe('https://api.z.ai/api/anthropic/v1')
    expect(normalizeAnthropicBaseUrl('https://gw.internal/v1')).toBe('https://gw.internal/v1')
    expect(normalizeAnthropicBaseUrl('http://localhost:4000')).toBe('http://localhost:4000/v1')
  })
})

describe('什么都没回来时，错误要指到是哪一环', () => {
  let logged: unknown[] = []
  const original = console.error
  beforeEach(() => {
    logged = []
    console.error = (...args: unknown[]) => {
      logged.push(args)
    }
  })
  afterEach(() => {
    console.error = original
  })

  test('网关回了 200 但不是事件流 → 错误里有请求地址、content-type 和响应正文', async () => {
    // 规范化救不回来的情况：前缀本身就错了
    const gw = fakeGateway('json-200')
    const p = createProvider({
      provider: 'anthropic',
      name: 'glm',
      apiKey: 'k',
      baseUrl: 'https://gw.internal/wrong/v1',
      fetch: gw.fetch,
    })
    const out: ModelEvent[] = []
    for await (const e of p.generate(
      { model: 'glm', messages: [{ role: 'user', content: 'Hi' }] },
      new AbortController().signal,
    )) {
      out.push(e)
    }
    // 只有一个错误：真正的原因不能被 SDK 收尾时补的那句盖掉（loop 记的是最后一个）
    expect(errors(out)).toHaveLength(1)
    const [msg] = errors(out)
    expect(msg).toContain('https://gw.internal/wrong/v1/messages')
    expect(msg).toContain('application/json')
    expect(msg).toContain('404 NOT_FOUND')
    expect(msg).not.toContain('No output generated')
  })

  test('事件流是空的 → 说人话，并指向 doctor --ping', async () => {
    const { out } = await collect('https://gw.internal/v1', 'empty-sse')
    const [msg] = errors(out)
    expect(msg).toContain('https://gw.internal/v1/messages')
    expect(msg).toContain('domi doctor --ping')
    expect(msg).not.toContain('No output generated')
  })

  test('错误只走事件，不往 daemon 的终端里再打一遍堆栈', async () => {
    await collect('https://gw.internal/v1', 'empty-sse')
    expect(logged).toEqual([])
  })
})
