/**
 * Provider 工厂 —— PRD-M1-001 AC-1/AC-4
 *
 * AC-4 要求"新增 provider 只需实现接口 + 注册"，判据是
 * **kernel 与 model/core 的 diff 为 0**。所以这个文件是唯一知道
 * 「有哪些 provider」的地方，kernel 一无所知。
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { AiSdkProvider } from './ai-sdk-provider.ts'
import { CAPABILITIES, type ModelCapabilities, type ProviderKind } from './capability.ts'
import type { ModelProvider } from './provider.ts'

export interface ProviderConfig {
  provider: string
  name: string
  apiKey?: string | undefined
  baseUrl?: string | undefined
  /** 允许在配置里覆盖能力矩阵——openai-compatible 后面挂什么只有用户知道 */
  capabilities?: { [K in keyof ModelCapabilities]?: boolean | undefined } | undefined
  /**
   * 自定义 fetch。两个真实用途：
   *   1. 企业代理 / mTLS —— 出站要走自己的通道
   *   2. 测试里截下请求看「发到哪、带了什么」
   * 不能靠改 globalThis.fetch：AI SDK 在模块加载时就把它抓走了，后改的看不见。
   */
  fetch?: typeof globalThis.fetch | undefined
}

export function isKnownProvider(p: string): p is ProviderKind {
  return p in CAPABILITIES
}

export function capabilitiesFor(cfg: ProviderConfig): ModelCapabilities {
  const base = isKnownProvider(cfg.provider) ? CAPABILITIES[cfg.provider] : CAPABILITIES['openai-compatible']
  // 只覆盖显式给了值的项：undefined 不是 false，不能把默认值冲掉
  const overrides = Object.entries(cfg.capabilities ?? {}).filter(([, v]) => typeof v === 'boolean')
  return { ...base, ...Object.fromEntries(overrides) }
}

export class InvalidApiKeyError extends Error {
  readonly messageKey = 'error.invalid_api_key'
  constructor(why: string) {
    super(
      `error.invalid_api_key: API key ${why}。\n` +
        'HTTP header 只接受 ASCII，粘贴时混进全角字符或换行就会变成一句看不懂的 Headers 报错——' +
        '所以在这里先拦住。检查一下有没有多复制到空格、引号或中文标点。',
    )
    this.name = 'InvalidApiKeyError'
  }
}

/**
 * key 必须是可打印 ASCII。
 * 这不是洁癖：非 ASCII 或含空白的 header 值会在**构造 Headers 时**抛错，
 * 请求压根发不出去，而报错信息完全指不到「你的 key 粘错了」。
 */
export function assertAsciiKey(key: string): void {
  if (key === '') return
  if (/[^\x20-\x7E]/.test(key)) throw new InvalidApiKeyError('含非 ASCII 字符')
  if (/\s/.test(key)) throw new InvalidApiKeyError('含空白字符')
}

/**
 * anthropic 协议的 base_url 两种写法都认 —— 统一成 AI SDK 要的「带 /v1」。
 *
 * Anthropic 官方 SDK（以及 Claude Code、几乎所有兼容网关的文档）的 base **不带** /v1，
 * SDK 自己拼 `/v1/messages`；AI SDK 的 base **要带** /v1，只拼 `/messages`。
 * 照网关文档填 `https://api.z.ai/api/anthropic`，请求就打到一个不存在的路径上，
 * 而有的网关对不存在的路径回 200 + JSON——于是用户看到的只是「流里什么都没有」。
 * 用户不该需要知道我们底下用的是哪个 SDK。
 */
export function normalizeAnthropicBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export class GatewayResponseError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly contentType: string,
    readonly bodySnippet: string,
  ) {
    super(
      `网关回了 HTTP ${status}，但不是事件流（content-type: ${contentType || '无'}）。` +
        `请求地址：POST ${url}\n响应正文：${bodySnippet}\n` +
        '多半是 base_url 路径不对或网关不支持流式。先跑 `domi doctor --ping` 看是哪一环。',
    )
    this.name = 'GatewayResponseError'
  }
}

/** 最近一次出站请求。空流时拿它告诉用户「发到了哪」 */
export interface RequestTrace {
  lastUrl: string | undefined
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as { url?: string }).url ?? String(input)
}

/**
 * 包一层 fetch，只做诊断，不改请求：
 * 流式请求拿到 2xx 却不是 text/event-stream 时，把正文读出来直接报错。
 * 否则 SDK 会把一段 JSON 当成「零个事件的流」，最后只剩一句没有信息量的 NoOutputGenerated。
 */
type FetchLike = (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>

export function diagnosticFetch(base: FetchLike, trace: RequestTrace): typeof globalThis.fetch {
  const wrapped = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input)
    trace.lastUrl = url
    const res = await base(input as Parameters<typeof globalThis.fetch>[0], init)
    const streaming = typeof init?.body === 'string' && /"stream"\s*:\s*true/.test(init.body)
    const contentType = res.headers.get('content-type') ?? ''
    if (streaming && res.ok && !contentType.includes('text/event-stream')) {
      const body = (await res.text()).slice(0, 300)
      throw new GatewayResponseError(url, res.status, contentType, body)
    }
    return res
  }
  return wrapped as unknown as typeof globalThis.fetch
}

export function createProvider(cfg: ProviderConfig): ModelProvider {
  const capabilities = capabilitiesFor(cfg)
  const apiKey = cfg.apiKey ?? ''
  assertAsciiKey(apiKey)

  const trace: RequestTrace = { lastUrl: undefined }
  const baseUrl = cfg.baseUrl && cfg.provider === 'anthropic' ? normalizeAnthropicBaseUrl(cfg.baseUrl) : cfg.baseUrl
  const common = {
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    fetch: diagnosticFetch(cfg.fetch ?? ((input, init) => globalThis.fetch(input, init)), trace),
  }

  const model = (() => {
    switch (cfg.provider) {
      case 'anthropic':
        return createAnthropic(common)(cfg.name)
      case 'openai':
        return createOpenAI(common)(cfg.name)
      case 'google':
        return createGoogleGenerativeAI(common)(cfg.name)
      default:
        // 未知 provider 一律按 openai-compatible 处理——LiteLLM / OpenRouter / Ollama
        // 都走这条（DESIGN §5：网关只作为可选后端，不作为依赖）
        return createOpenAICompatible({
          ...common,
          name: cfg.provider,
          baseURL: cfg.baseUrl ?? 'http://localhost:11434/v1',
        })(cfg.name)
    }
  })()

  return new AiSdkProvider({ id: cfg.provider, model: model as never, capabilities, trace })
}
