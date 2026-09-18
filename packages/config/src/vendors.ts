/**
 * 厂商模板 —— PRD-M9-002 AC-2/AC-3/AC-6 · SPEC-M9-002 取舍-1
 *
 * **「有哪些厂商」这件知识只在这里**（`guard:providers` 守着）。每个模板是纯数据：
 * 协议、默认地址、默认能力、惯用环境变量名、用哪种适配器。model 包按 `adapter` 选 SDK 构造器，
 * Web 经 `provider.vendors` 拿去画「新增 provider」表单——两边都不再自己写一份厂商名单。
 *
 * 放在 config 而不是 model：apps 不许 import model（那里有 AI SDK），而模板本身不需要 SDK。
 */

export type Protocol = 'openai' | 'anthropic'

/** openai-official 走 OpenAI 官方 SDK（Responses API）；第三方的 OpenAI 协议只认 Chat Completions，走兼容适配器 */
export type Adapter = 'openai-official' | 'anthropic' | 'openai-compatible'

export interface VendorCapabilities {
  toolCall: boolean
  vision: boolean
  reasoning: boolean
  promptCache: boolean
  structuredOutput: boolean
}

export const VENDOR_IDS = ['openai', 'anthropic', 'deepseek', 'gemini', 'custom'] as const
export type VendorId = (typeof VENDOR_IDS)[number]

export interface Vendor {
  id: VendorId
  /** 界面上的厂商名（品牌名，不翻译） */
  label: string
  protocol: Protocol
  adapter: Adapter
  /** 没填 Base URL 时用它；custom 没有官方地址 */
  defaultBaseUrl?: string
  capabilities: VendorCapabilities
  /** 惯用的 key 环境变量（`DOMI_<ID>_API_KEY` 之外再认的） */
  envNames: readonly string[]
  /** key 输入框的占位（只是形状提示） */
  keyHint: string
}

const NONE: VendorCapabilities = {
  toolCall: false,
  vision: false,
  reasoning: false,
  promptCache: false,
  structuredOutput: false,
}

export const VENDORS: Record<VendorId, Vendor> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    adapter: 'openai-official',
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: { toolCall: true, vision: true, reasoning: true, promptCache: true, structuredOutput: true },
    envNames: ['OPENAI_API_KEY'],
    keyHint: 'sk-...',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    adapter: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    capabilities: { toolCall: true, vision: true, reasoning: true, promptCache: true, structuredOutput: false },
    envNames: ['ANTHROPIC_API_KEY'],
    keyHint: 'sk-ant-...',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    capabilities: { toolCall: true, vision: false, reasoning: true, promptCache: false, structuredOutput: false },
    envNames: ['DEEPSEEK_API_KEY'],
    keyHint: 'sk-...',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    protocol: 'openai',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    capabilities: { toolCall: true, vision: true, reasoning: true, promptCache: false, structuredOutput: false },
    envNames: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    keyHint: 'AIza...',
  },
  /**
   * 自定义：LiteLLM / OpenRouter / vLLM / Ollama / 公司网关……后面挂什么只有用户知道。
   * 能力**全关**是有意的保守（fail-closed，和 INV-03 同一立场）：声明 false 的后果是「想用得显式打开」，声明 true 的后果是「运行时才炸」
   */
  custom: {
    id: 'custom',
    label: 'Custom',
    protocol: 'openai',
    adapter: 'openai-compatible',
    capabilities: NONE,
    envNames: [],
    keyHint: '',
  },
}

/** 本地网关的老默认（没填地址的自定义 openai 协议 provider 用它，与 M1 起的行为一致） */
export const CUSTOM_OPENAI_FALLBACK_BASE = 'http://localhost:11434/v1'

/** 零配置时的默认模型 */
export const DEFAULT_MODEL = { provider: 'anthropic', name: 'claude-sonnet-4-5' } as const

export function isVendorId(v: string): v is VendorId {
  return (VENDOR_IDS as readonly string[]).includes(v)
}

/**
 * 旧配置没写 vendor 时按键名推断（PRD-M9-002 AC-7 · SPEC-M9-002 取舍-3）。
 * 推断只发生在读的时候，不改用户文件
 */
export function inferVendor(providerId: string): VendorId {
  if (isVendorId(providerId)) return providerId
  if (providerId === 'google') return 'gemini'
  return 'custom'
}

/** 适配器：厂商决定；自定义厂商按所选协议 */
export function adapterFor(vendor: VendorId, protocol: Protocol): Adapter {
  if (vendor === 'custom') return protocol === 'anthropic' ? 'anthropic' : 'openai-compatible'
  return VENDORS[vendor].adapter
}

/** 某个 provider id 的 key 环境变量：`DOMI_<ID>_API_KEY` + 模板惯用名（PRD-M9-002 AC-6） */
export function providerEnvNames(providerId: string, vendor: VendorId = inferVendor(providerId)): string[] {
  const own = `DOMI_${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`
  return [...new Set([...VENDORS[vendor].envNames, own])]
}
