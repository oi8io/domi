/**
 * PRD-M9-002 AC-2 / AC-3 · 厂商模板决定协议、地址、能力与适配器
 */
import { describe, expect, test } from 'bun:test'
import { VENDORS } from '@domi/config'
import { capabilitiesFor, connectionShape, createEmbedder, createProvider, effectiveBaseUrl } from '../src/index.ts'

describe('PRD-M9-002 AC-3 · 适配器由厂商决定', () => {
  test.each([
    ['openai', undefined, 'openai-official'],
    ['anthropic', undefined, 'anthropic'],
    ['deepseek', undefined, 'openai-compatible'],
    ['gemini', undefined, 'openai-compatible'],
    ['custom', 'openai', 'openai-compatible'],
    ['custom', 'anthropic', 'anthropic'],
  ] as const)('%s（协议 %s）→ %s', (vendor, protocol, adapter) => {
    expect(connectionShape({ provider: 'x', vendor, protocol }).adapter).toBe(adapter)
  })

  test('非 custom 的厂商：协议由模板定，配置里写别的也不算', () => {
    expect(connectionShape({ provider: 'x', vendor: 'deepseek', protocol: 'anthropic' }).protocol).toBe('openai')
  })

  test('旧配置没写 vendor：按键名推断（google → gemini，openai-compatible / 其它 → custom）', () => {
    expect(connectionShape({ provider: 'google' }).vendor).toBe('gemini')
    expect(connectionShape({ provider: 'openai-compatible' }).vendor).toBe('custom')
    expect(connectionShape({ provider: 'my-gw' }).vendor).toBe('custom')
    expect(connectionShape({ provider: 'anthropic' }).vendor).toBe('anthropic')
  })
})

describe('地址：填了用填的，没填用模板默认', () => {
  test('anthropic 协议统一规整成带 /v1', () => {
    expect(effectiveBaseUrl({ provider: 'anthropic' })).toBe('https://api.anthropic.com/v1')
    expect(
      effectiveBaseUrl({
        provider: 'gw',
        vendor: 'custom',
        protocol: 'anthropic',
        baseUrl: 'https://api.z.ai/api/anthropic',
      }),
    ).toBe('https://api.z.ai/api/anthropic/v1')
  })

  test('兼容适配器：模板地址 → 否则本地网关老默认', () => {
    expect(effectiveBaseUrl({ provider: 'deepseek' })).toBe('https://api.deepseek.com/v1')
    expect(effectiveBaseUrl({ provider: 'google' })).toBe(VENDORS.gemini.defaultBaseUrl)
    expect(effectiveBaseUrl({ provider: 'local' })).toBe('http://localhost:11434/v1')
  })
})

describe('PRD-M9-002 AC-2 · 能力按厂商模板给，自定义全关', () => {
  test('deepseek 默认能调工具（原来落进 openai-compatible，工具默认关）', () => {
    expect(capabilitiesFor({ provider: 'deepseek', name: 'deepseek-chat' }).toolCall).toBe(true)
  })

  test('自定义厂商 fail-closed，显式覆盖才打开', () => {
    expect(Object.values(capabilitiesFor({ provider: 'gw', name: 'q' })).every((v) => v === false)).toBe(true)
    expect(capabilitiesFor({ provider: 'gw', name: 'q', capabilities: { toolCall: true } }).toolCall).toBe(true)
  })
})

describe('请求真的发到了模板给的地址', () => {
  test('deepseek：没填地址时打 api.deepseek.com，带的是给它的 key', async () => {
    const seen: Array<{ url: string; auth: string | null }> = []
    const fetch = (async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') })
      // 截下就抛（不可重试的错），免得走重试退避
      throw new Error('captured')
    }) as unknown as typeof globalThis.fetch
    const p = createProvider({ provider: 'deepseek', name: 'deepseek-chat', apiKey: 'k-ds', fetch })
    const it = p.generate(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    )
    await (async () => {
      for await (const _ of it) {
        /* 只要请求发出去 */
      }
    })().catch(() => undefined)
    expect(seen[0]?.url.startsWith('https://api.deepseek.com/v1/')).toBe(true)
    expect(seen[0]?.auth).toBe('Bearer k-ds')
  })
})

test('anthropic 协议没有 embedding：构造时就报错', () => {
  expect(() => createEmbedder({ provider: 'anthropic', model: 'x' })).toThrow(/embedding/)
})
