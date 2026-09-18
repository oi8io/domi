/**
 * 模型下拉的清单 —— PRD-M8-010 AC-5 · SPEC-M8-010
 *
 * 来源：配了凭据的供应商（默认那一家总在）× 已知的模型名（该家 providers.<p>.models + 价目表里按前缀认得出的 + 当前默认模型）。
 * 能力按 model 包的静态矩阵给（默认那一家带上 model.capabilities 的覆盖）。
 */
import { type DomiConfig, providerConnection } from '@domi/config'
import { capabilitiesFor, providerConfigOf } from '@domi/model'

export interface ModelEntry {
  provider: string
  name: string
  vision: boolean
  toolCall: boolean
}

export function modelCatalog(config: DomiConfig): {
  models: ModelEntry[]
  current: { provider: string; name: string }
} {
  const current = { provider: config.model.provider, name: config.model.name }
  const providers = new Set<string>([current.provider])
  for (const [p, v] of Object.entries(config.providers ?? {})) {
    // 本地网关可以没有 key，给了地址也算配好了
    if (v.apiKey || v.baseUrl || v.models.length > 0) providers.add(p)
  }
  const out: ModelEntry[] = []
  for (const provider of providers) {
    const names = new Set<string>()
    if (provider === current.provider) names.add(current.name)
    for (const m of config.providers?.[provider]?.models ?? []) names.add(m)
    for (const name of names) {
      const caps = capabilitiesFor(providerConfigOf(providerConnection(config, provider), name))
      out.push({ provider, name, vision: caps.vision, toolCall: caps.toolCall })
    }
  }
  return { models: out, current }
}
