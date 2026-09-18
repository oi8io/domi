/**
 * 某个 provider 的连接参数 —— 运行期唯一的读法（SPEC-M9-002 取舍-2 · BUG-M9-002）
 *
 * 凭据曾有两套来源：默认那一家读 `model.api_key / base_url / capabilities`，别家读 `providers.<id>`；
 * 各处自己拼，拼法还不一样——切到别家而那一家没配 key 时，会**带着默认那一家的 key 发往别家的地址**。
 * 现在所有地方都经这里取：旧写法（`model.*`）只并入默认那一家，别家缺什么就是缺什么，绝不回落。
 */
import type { DomiConfig } from './schema.ts'

export type CapabilityOverrides = NonNullable<DomiConfig['model']['capabilities']>

export interface ProviderConnection {
  id: string
  apiKey?: string | undefined
  baseUrl?: string | undefined
  capabilities?: CapabilityOverrides | undefined
  models: string[]
}

export function providerConnection(config: Pick<DomiConfig, 'model' | 'providers'>, id: string): ProviderConnection {
  const entry = config.providers?.[id]
  const isDefault = id === config.model.provider
  const apiKey = entry?.apiKey ?? (isDefault ? config.model.apiKey : undefined)
  const baseUrl = entry?.baseUrl ?? (isDefault ? config.model.baseUrl : undefined)
  const capabilities = isDefault ? config.model.capabilities : undefined
  return {
    id,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(capabilities ? { capabilities } : {}),
    models: entry?.models ?? [],
  }
}
