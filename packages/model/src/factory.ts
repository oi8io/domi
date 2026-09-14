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
}

export function isKnownProvider(p: string): p is ProviderKind {
  return p in CAPABILITIES
}

export function capabilitiesFor(cfg: ProviderConfig): ModelCapabilities {
  const base = isKnownProvider(cfg.provider) ? CAPABILITIES[cfg.provider] : CAPABILITIES['openai-compatible']
  return { ...base, ...cfg.capabilities }
}

export function createProvider(cfg: ProviderConfig): ModelProvider {
  const capabilities = capabilitiesFor(cfg)
  const apiKey = cfg.apiKey ?? ''

  const model = (() => {
    switch (cfg.provider) {
      case 'anthropic':
        return createAnthropic({ apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) })(cfg.name)
      case 'openai':
        return createOpenAI({ apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) })(cfg.name)
      case 'google':
        return createGoogleGenerativeAI({ apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) })(cfg.name)
      default:
        // 未知 provider 一律按 openai-compatible 处理——LiteLLM / OpenRouter / Ollama
        // 都走这条（DESIGN §5：网关只作为可选后端，不作为依赖）
        return createOpenAICompatible({
          name: cfg.provider,
          apiKey,
          baseURL: cfg.baseUrl ?? 'http://localhost:11434/v1',
        })(cfg.name)
    }
  })()

  return new AiSdkProvider({ id: cfg.provider, model: model as never, capabilities })
}
