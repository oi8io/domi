/**
 * PRD-M9-001 · 模型探测：请求头 / 路径 / 翻页 / 降级 / 缓存 / 过滤 / 停用
 *
 * 全部用注入的 fetch（INV-08）：断言的是「发到哪、带了什么」，以及拿到各种响应之后清单长什么样。
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema } from '@domi/config'
import { isChatModel, NON_CHAT_PATTERNS, parseProbe, probeRequest } from '@domi/model'
import { ModelCatalog } from '../src/index.ts'

type Call = { url: string; headers: Record<string, string> }

function fakeFetch(routes: Record<string, (url: URL) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetch = async (input: string, init: { headers: Record<string, string> }) => {
    calls.push({ url: input, headers: init.headers })
    const u = new URL(input)
    const handler = routes[u.host]
    if (!handler) throw new Error(`unexpected host ${u.host}`)
    return handler(u)
  }
  return { calls, fetch }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function config(providers: Record<string, unknown>, model = { provider: 'anthropic', name: 'claude-sonnet-4-5' }) {
  return ConfigSchema.parse({ model, providers })
}

describe('PRD-M9-001 AC-1 · 两种协议的请求', () => {
  test('openai：GET {base}/models + Bearer', () => {
    expect(probeRequest({ protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'k' })).toEqual({
      url: 'https://api.deepseek.com/v1/models',
      headers: { authorization: 'Bearer k' },
    })
  })

  test('anthropic：x-api-key + anthropic-version，limit=1000，翻页带 after_id', () => {
    const r = probeRequest({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', after: 'm2' })
    expect(r.url).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=m2')
    expect(r.headers).toEqual({ 'anthropic-version': '2023-06-01', 'x-api-key': 'k' })
  })

  test('解析：Gemini 的 models/ 前缀去掉；anthropic 按 has_more / last_id 给下一页', () => {
    expect(parseProbe('openai', { data: [{ id: 'models/gemini-2.5-pro' }, { id: 'x' }, {}] })).toEqual({
      ids: ['gemini-2.5-pro', 'x'],
    })
    expect(parseProbe('anthropic', { data: [{ id: 'a' }], has_more: true, last_id: 'a' })).toEqual({
      ids: ['a'],
      next: 'a',
    })
    expect(() => parseProbe('openai', { models: [] })).toThrow(/data/)
  })

  test('真实的一轮：anthropic 翻两页、按地址规整、请求头齐全；清单并上默认模型', async () => {
    const { calls, fetch } = fakeFetch({
      'gw.example': (u) =>
        u.searchParams.get('after_id') === null
          ? json({ data: [{ id: 'claude-opus-4-1' }], has_more: true, last_id: 'claude-opus-4-1' })
          : json({ data: [{ id: 'claude-haiku-4-5' }], has_more: false }),
    })
    const cat = new ModelCatalog({ fetch })
    const r = await cat.list(config({ anthropic: { apiKey: 'sk-ant-1', baseUrl: 'https://gw.example/api/anthropic' } }))
    expect(calls.map((c) => c.url)).toEqual([
      'https://gw.example/api/anthropic/v1/models?limit=1000',
      'https://gw.example/api/anthropic/v1/models?limit=1000&after_id=claude-opus-4-1',
    ])
    expect(calls[0]?.headers['x-api-key']).toBe('sk-ant-1')
    expect(r.models.map((m) => [m.name, m.source])).toEqual([
      ['claude-opus-4-1', 'probe'],
      ['claude-haiku-4-5', 'probe'],
      ['claude-sonnet-4-5', 'fallback'],
    ])
    expect(r.providers).toEqual([{ id: 'anthropic', name: 'Anthropic', status: 'ok' }])
  })
})

describe('PRD-M9-001 AC-2 · 探测失败降级，一家失败不影响别家', () => {
  test('401 / 非 2xx / 网络错误 / 形状不对 → 这一家降级为手填 + 默认模型，原因里没有 key', async () => {
    for (const bad of [
      () => json({ error: 'nope' }, 401),
      () => json({}, 503),
      () => {
        throw new Error('connect ECONNREFUSED sk-gw-secret')
      },
      () => json({ models: [] }),
    ]) {
      const { fetch } = fakeFetch({
        'gw.example': bad,
        'api.deepseek.com': () => json({ data: [{ id: 'deepseek-chat' }] }),
      })
      const r = await new ModelCatalog({ fetch }).list(
        config(
          {
            gw: { apiKey: 'sk-gw-secret', baseUrl: 'https://gw.example/v1', models: ['qwen3'] },
            deepseek: { apiKey: 'k-ds' },
          },
          { provider: 'gw', name: 'glm-4.6' },
        ),
      )
      const gw = r.providers.find((p) => p.id === 'gw')
      expect(gw?.status).toBe('fallback')
      expect(gw?.error).toBeDefined()
      expect(JSON.stringify(r)).not.toContain('sk-gw-secret')
      expect(r.models.filter((m) => m.provider === 'gw').map((m) => [m.name, m.source])).toEqual([
        ['qwen3', 'manual'],
        ['glm-4.6', 'fallback'],
      ])
      expect(r.models.filter((m) => m.provider === 'deepseek').map((m) => m.name)).toEqual(['deepseek-chat'])
    }
  })

  test('超时：挂住的那一家按超时降级，不拖住整张清单', async () => {
    const { fetch } = fakeFetch({ 'gw.example': () => new Promise<Response>(() => undefined) })
    const slow = async (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
      Promise.race([
        fetch(input, init),
        new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))),
      ])
    const r = await new ModelCatalog({ fetch: slow, timeoutMs: 20 }).list(
      config({ gw: { baseUrl: 'https://gw.example/v1' } }, { provider: 'gw', name: 'm' }),
    )
    expect(r.providers[0]).toMatchObject({ status: 'fallback', error: 'timeout' })
  })

  test('官方厂商没 key：不发请求，直接降级', async () => {
    const { calls, fetch } = fakeFetch({})
    const r = await new ModelCatalog({ fetch }).list(config({}))
    expect(calls).toEqual([])
    expect(r.providers[0]).toMatchObject({ id: 'anthropic', status: 'fallback' })
    expect(r.models.map((m) => m.name)).toEqual(['claude-sonnet-4-5'])
  })
})

describe('PRD-M9-001 AC-3 · 缓存 10 分钟，配置一变就失效，refresh 强制重探', () => {
  test('同一份配置十分钟内只探一次；过期、换 key、refresh 都会重探', async () => {
    let t = 0
    const { calls, fetch } = fakeFetch({ 'gw.example': () => json({ data: [{ id: 'm' }] }) })
    const cat = new ModelCatalog({ fetch, now: () => t })
    const a = config({ gw: { apiKey: 'k1', baseUrl: 'https://gw.example/v1' } }, { provider: 'gw', name: 'm' })
    await cat.list(a)
    await cat.list(a)
    expect(calls.length).toBe(1)
    t = 10 * 60_000 + 1
    await cat.list(a)
    expect(calls.length).toBe(2)
    await cat.list(config({ gw: { apiKey: 'k2', baseUrl: 'https://gw.example/v1' } }, { provider: 'gw', name: 'm' }))
    expect(calls.length).toBe(3)
    await cat.list(a, { refresh: true })
    expect(calls.length).toBe(4)
  })
})

describe('PRD-M9-001 AC-4 · 过滤非对话模型', () => {
  test.each([
    'text-embedding-3-small',
    'tts-1-hd',
    'gpt-4o-mini-tts',
    'whisper-1',
    'gpt-4o-transcribe',
    'dall-e-3',
    'gpt-image-1',
    'omni-moderation-latest',
    'gpt-4o-realtime-preview',
    'gpt-4o-audio-preview',
    'davinci-002',
    'babbage-002',
    'sora-2',
    'imagen-4.0-generate-001',
    'veo-3.0-generate-001',
  ])('%s 不是对话模型', (id) => {
    expect(isChatModel(id)).toBe(false)
  })

  test.each([
    'gpt-4o',
    'gpt-5',
    'o3-mini',
    'claude-sonnet-4-5',
    'deepseek-chat',
    'deepseek-reasoner',
    'gemini-2.5-pro',
    'qwen3-coder',
    'glm-4.6',
    'gpt-4o-mini-search-preview',
  ])('%s 是对话模型', (id) => {
    expect(isChatModel(id)).toBe(true)
  })

  test('规则表每一条都有被上面的用例命中（规则只有一份，删一条就会有用例变红）', () => {
    const bad = [
      'text-embedding-3-small',
      'tts-1-hd',
      'whisper-1',
      'dall-e-3',
      'omni-moderation-latest',
      'gpt-4o-realtime-preview',
      'gpt-4o-audio-preview',
      'davinci-002',
      'sora-2',
      'veo-3.0-generate-001',
    ]
    for (const [re] of NON_CHAT_PATTERNS) expect(bad.some((id) => re.test(id))).toBe(true)
  })
})

describe('PRD-M9-001 AC-5 / AC-6 · 只打配置的地址；停用的不探测不展示', () => {
  test('请求地址只有配置的地址与模板默认地址', async () => {
    const { calls, fetch } = fakeFetch({
      'gw.example': () => json({ data: [] }),
      'api.deepseek.com': () => json({ data: [] }),
    })
    await new ModelCatalog({ fetch }).list(
      config({ gw: { baseUrl: 'https://gw.example/v1' }, deepseek: { apiKey: 'k' } }, { provider: 'gw', name: 'm' }),
    )
    expect(calls.map((c) => new URL(c.url).host).sort()).toEqual(['api.deepseek.com', 'gw.example'])
  })

  test('停用的 provider：不发请求，清单里也没有它', async () => {
    const { calls, fetch } = fakeFetch({ 'gw.example': () => json({ data: [{ id: 'm' }] }) })
    const r = await new ModelCatalog({ fetch }).list(
      config({ gw: { baseUrl: 'https://gw.example/v1', enabled: false } }, { provider: 'anthropic', name: 'c' }),
    )
    expect(calls).toEqual([])
    expect(r.models.some((m) => m.provider === 'gw')).toBe(false)
    expect(r.providers.some((p) => p.id === 'gw')).toBe(false)
  })
})
