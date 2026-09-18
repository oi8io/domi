/**
 * 某个 provider 的连接参数 —— 运行期唯一的读法（SPEC-M9-002 取舍-2 · BUG-M9-002）
 *
 * 凭据曾有两套来源：默认那一家读 `model.api_key / base_url / capabilities`，别家读 `providers.<id>`；
 * 各处自己拼，拼法还不一样——切到别家而那一家没配 key 时，会**带着默认那一家的 key 发往别家的地址**。
 * 现在所有地方都经这里取：旧写法（`model.*`）只并入默认那一家，别家缺什么就是缺什么，绝不回落。
 *
 * M9 起每一家还带上厂商模板、协议、启停（PRD-M9-002 AC-1）；旧配置没写的按键名推断（AC-7），`inferred` 标出来给 doctor 看。
 */
import type { DomiConfig } from './schema.ts'
import { inferVendor, type Protocol, VENDORS, type VendorId } from './vendors.ts'

export type CapabilityOverrides = NonNullable<DomiConfig['model']['capabilities']>

/** provider id 的形状（PRD-M9-002 AC-1）。只在新建时强制；旧配置里已有的键照读 */
export const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

export interface ProviderConnection {
  id: string
  /** 界面上的名字：写了用写的，没写用 id */
  name: string
  vendor: VendorId
  protocol: Protocol
  enabled: boolean
  apiKey?: string | undefined
  baseUrl?: string | undefined
  capabilities?: CapabilityOverrides | undefined
  models: string[]
  /** vendor / protocol 是推断出来的（旧配置没写） */
  inferred: boolean
}

type ConfigLike = Pick<DomiConfig, 'model' | 'providers'>

export function providerConnection(config: ConfigLike, id: string): ProviderConnection {
  const entry = config.providers?.[id]
  const isDefault = id === config.model.provider
  const apiKey = entry?.apiKey ?? (isDefault ? config.model.apiKey : undefined)
  const baseUrl = entry?.baseUrl ?? (isDefault ? config.model.baseUrl : undefined)
  // 旧写法的覆盖（model.capabilities）打底，provider 自己写的优先
  const legacyCaps = isDefault ? config.model.capabilities : undefined
  const capabilities = legacyCaps || entry?.capabilities ? { ...legacyCaps, ...entry?.capabilities } : undefined
  const vendor = entry?.vendor ?? inferVendor(id)
  const protocol = vendor === 'custom' ? (entry?.protocol ?? VENDORS.custom.protocol) : VENDORS[vendor].protocol
  return {
    id,
    // 没写名字：键名就是厂商名（anthropic / deepseek …）时用厂商的品牌名，其余用 id
    name: entry?.name ?? (vendor !== 'custom' && id === vendor ? VENDORS[vendor].label : id),
    vendor,
    protocol,
    enabled: entry?.enabled ?? true,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(capabilities ? { capabilities } : {}),
    models: entry?.models ?? [],
    inferred: entry?.vendor === undefined,
  }
}

/**
 * 全部 provider：配置里写了的 + 默认模型所在的那一家（没写也隐式存在——零配置 + 环境变量就能跑）。
 * 顺序：默认那一家在前，其余按配置里的顺序
 */
export function listProviders(config: ConfigLike): ProviderConnection[] {
  const ids = [config.model.provider, ...Object.keys(config.providers ?? {})]
  return [...new Set(ids)].map((id) => providerConnection(config, id))
}
