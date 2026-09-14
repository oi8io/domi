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
  capabilities?: Partial<ModelCapabilities> | undefined
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
  return { ...base, ...cfg.capabilities }
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

export function createProvider(cfg: ProviderConfig): ModelProvider {
  const capabilities = capabilitiesFor(cfg)
  const apiKey = cfg.apiKey ?? ''
  assertAsciiKey(apiKey)

  const common = {
    apiKey,
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
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

  return new AiSdkProvider({ id: cfg.provider, model: model as never, capabilities })
}
