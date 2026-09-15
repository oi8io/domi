/**
 * Embedding —— PRD-M4-001 AC-3 的「语义检索」那一半 · docs/adr/018
 *
 * 这里只有类型；「哪个 provider 怎么建 embedding 模型」和 createProvider 一样只在 factory.ts 里（PRD-M1-001 AC-4）。
 */

export interface EmbeddingConfig {
  provider: string
  model: string
  apiKey?: string | undefined
  baseUrl?: string | undefined
}

export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>

export class EmbeddingUnsupportedError extends Error {
  constructor(provider: string) {
    super(
      `provider "${provider}" 没有 embedding 接口。memory.embedding 换一个支持的 provider（或 openai 兼容的网关），` +
        '或者删掉这一节——没有 embedding 时记忆检索只用关键词。',
    )
    this.name = 'EmbeddingUnsupportedError'
  }
}
