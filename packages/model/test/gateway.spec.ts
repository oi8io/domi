/**
 * PRD-M1-001 AC-1 · Anthropic 兼容网关（自定义 base_url）
 *
 * 现实里拿不到官方 key 的情况很常见：公司统一走网关、地区限制、或者只是还没批下来。
 * 「能用自定义 URL + 兼容 key」不是边缘场景，是**多数人的第一次使用路径**——
 * 所以它必须有测试，不能靠「应该能跑」。
 *
 * 不打真接口（INV-08）：这里验的是**请求发到哪、带了什么**，用一个假 fetch 截下来看。
 *
 * fetch 是**注入**进工厂的，不是改 globalThis——AI SDK 在模块加载时就把 globalThis.fetch
 * 抓进了自己的闭包，后改的它看不见。第一版就是在这里栽的，测试拿到空数组。
 * 顺带这条也是真需求：企业代理 / mTLS 场景要的就是自定义 fetch。
 */
import { describe, expect, test } from 'bun:test'
import { VENDORS } from '@domi/config'
import { assertAsciiKey, capabilitiesFor, createProvider } from '../src/index.ts'

interface Captured {
  url: string
  headers: Record<string, string>
  body: string
}

/** 截下出站请求后直接抛错，免得真的等超时 */
function captureFetch(): { calls: Captured[]; fetch: typeof globalThis.fetch } {
  const calls: Captured[] = []
  const impl = async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }): Promise<never> => {
    const req = input as { url?: string; headers?: Record<string, string> }
    const url = typeof input === 'string' ? input : (req.url ?? String(input))
    const headers: Record<string, string> = {}
    new Headers(init?.headers ?? req.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })
    calls.push({ url, headers, body: typeof init?.body === 'string' ? init.body : '' })
    throw new Error('captured')
  }
  return { calls, fetch: impl as unknown as typeof globalThis.fetch }
}

async function drainQuietly(it: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of it) {
    /* 我们只关心请求发出去的样子，产出什么无所谓 */
  }
}

describe('自定义 base_url 走 anthropic 协议', () => {
  test('请求打到自定义网关，不是官方域名', async () => {
    const { calls, fetch } = captureFetch()
    const p = createProvider({
      provider: 'anthropic',
      name: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-gateway-key-0123456789',
      baseUrl: 'https://my-gateway.internal/v1',
      fetch,
    })
    await drainQuietly(
      p.generate(
        { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('my-gateway.internal')
    expect(calls[0]?.url).not.toContain('api.anthropic.com')
  })

  test('key 以 anthropic 的方式带上（x-api-key），网关才认得', async () => {
    const { calls, fetch } = captureFetch()
    const p = createProvider({
      provider: 'anthropic',
      name: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-abc123',
      baseUrl: 'https://my-gateway.internal/v1',
      fetch,
    })
    await drainQuietly(
      p.generate(
        { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    )
    const h = calls[0]?.headers ?? {}
    expect(h['x-api-key'] ?? h.authorization).toContain('sk-ant-abc123')
  })

  test('兼容网关仍然拿到 anthropic 的完整能力矩阵 —— 它说的是协议，不是域名', () => {
    const caps = capabilitiesFor({
      provider: 'anthropic',
      name: 'claude-sonnet-4-5',
      baseUrl: 'https://my-gateway.internal/v1',
      fetch,
    })
    expect(caps).toEqual(VENDORS.anthropic.capabilities)
    expect(caps.toolCall).toBe(true)
    expect(caps.promptCache).toBe(true)
  })

  test('不给 base_url 时打官方域名（默认路径没被改坏）', async () => {
    const { calls, fetch } = captureFetch()
    const p = createProvider({ provider: 'anthropic', name: 'claude-sonnet-4-5', apiKey: 'k', fetch })
    await drainQuietly(
      p.generate(
        { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    )
    expect(calls[0]?.url).toContain('api.anthropic.com')
  })

  test('网关不可达时变成 recoverable 的 error 事件，不是裸异常', async () => {
    const { fetch } = captureFetch()
    const p = createProvider({
      provider: 'anthropic',
      name: 'm',
      apiKey: 'k',
      baseUrl: 'https://不存在的网关.internal/v1',
      fetch,
    })
    const out = []
    for await (const e of p.generate(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    )) {
      out.push(e)
    }
    const err = out.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { recoverable: boolean }).recoverable).toBe(true)
  })
})

describe('非 ASCII 的 key', () => {
  test('粘贴时混进全角字符会被当场拦下，而不是给一句看不懂的 Headers 报错', () => {
    // 这条是写测试时真撞上的：第一版我把 key 写成 'sk-ant-兼容网关的key'，
    // 请求压根没发出去——非 ASCII 的 header 值在构造 Headers 时就抛错。
    // 用户粘贴 key 时混进一个全角字符就是这个下场，所以要在配置层就拦住。
    expect(() => assertAsciiKey('sk-ant-正常的key')).toThrow(/非 ASCII/)
    expect(() => assertAsciiKey('sk-ant-abc123')).not.toThrow()
    expect(() => assertAsciiKey('sk-ant-abc 123')).toThrow(/空白/)
  })
})

describe('OpenAI 兼容网关（本地模型）', () => {
  test('默认指向 Ollama 的地址，但能被 base_url 覆盖', async () => {
    const { calls, fetch } = captureFetch()
    const p = createProvider({
      provider: 'openai-compatible',
      name: 'qwen2.5-coder',
      apiKey: '',
      baseUrl: 'http://192.168.1.10:8000/v1',
      fetch,
    })
    await drainQuietly(
      p.generate({ model: 'qwen2.5-coder', messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal),
    )
    expect(calls[0]?.url).toContain('192.168.1.10:8000')
  })
})
