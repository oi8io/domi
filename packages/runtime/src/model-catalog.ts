/**
 * 模型清单 —— PRD-M9-001 · PRD-M9-003 AC-2 · SPEC-M9-001 取舍-6
 *
 * 每个启用的 provider：探测 `GET /models`（并发、10s 超时、结果缓存 10 分钟）→ 过滤非对话模型 → 并上手填的与默认模型。
 * 探测失败的那一家降级为「手填 + 默认模型」，并标出原因；一家失败不影响别家（AC-2）。
 *
 * 这里是 runtime 里唯一发探测请求的地方。fetch 与时钟都能注入：测试全部用假 fetch（INV-08），
 * 请求只发往那一家配置的地址或其厂商模板的默认地址（INV-11，AC-5）。
 */
import { createHash } from 'node:crypto'
import { type DomiConfig, listProviders, type ProviderConnection } from '@domi/config'
import {
  capabilitiesFor,
  connectionShape,
  effectiveBaseUrl,
  isChatModel,
  MAX_PAGES,
  parseProbe,
  probeRequest,
  providerConfigOf,
} from '@domi/model'

export type ModelSource = 'probe' | 'manual' | 'fallback'

export interface ModelEntry {
  /** provider id */
  provider: string
  /** provider 的显示名 */
  providerName: string
  name: string
  source: ModelSource
  vision: boolean
  toolCall: boolean
}

export interface ProviderStatus {
  id: string
  name: string
  status: 'ok' | 'fallback'
  /** 探测失败的原因（不含 key） */
  error?: string
}

export interface ModelList {
  models: ModelEntry[]
  providers: ProviderStatus[]
  current: { provider: string; name: string }
}

export const PROBE_TIMEOUT_MS = 10_000
export const PROBE_TTL_MS = 10 * 60_000

type Fetch = (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>

interface CacheEntry {
  fingerprint: string
  at: number
  ids?: string[]
  error?: string
}

export interface ModelCatalogOptions {
  fetch?: Fetch
  now?: () => number
  timeoutMs?: number
  ttlMs?: number
}

export class ModelCatalog {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly fetch: Fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly ttlMs: number

  constructor(opts: ModelCatalogOptions = {}) {
    this.fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.now = opts.now ?? Date.now
    this.timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
    this.ttlMs = opts.ttlMs ?? PROBE_TTL_MS
  }

  async list(config: DomiConfig, opts: { refresh?: boolean } = {}): Promise<ModelList> {
    const current = { provider: config.model.provider, name: config.model.name }
    // 停用的不探测、不展示（AC-6）
    const providers = listProviders(config).filter((p) => p.enabled)
    const probed = await Promise.all(providers.map((p) => this.probe(p, opts.refresh === true)))
    const models: ModelEntry[] = []
    const statuses: ProviderStatus[] = []
    providers.forEach((p, i) => {
      const r = probed[i] as CacheEntry
      statuses.push({
        id: p.id,
        name: p.name,
        status: r.ids === undefined ? 'fallback' : 'ok',
        ...(r.error === undefined ? {} : { error: r.error }),
      })
      const names = new Map<string, ModelSource>()
      for (const id of r.ids ?? []) if (isChatModel(id)) names.set(id, 'probe')
      for (const m of p.models) if (!names.has(m)) names.set(m, 'manual')
      if (p.id === current.provider && !names.has(current.name)) names.set(current.name, 'fallback')
      for (const [name, source] of names) {
        const caps = capabilitiesFor(providerConfigOf(p, name))
        models.push({
          provider: p.id,
          providerName: p.name,
          name,
          source,
          vision: caps.vision,
          toolCall: caps.toolCall,
        })
      }
    })
    return { models, providers: statuses, current }
  }

  /** 丢掉全部缓存（配置整体换了的时候用；平常靠指纹自己失效） */
  invalidate(): void {
    this.cache.clear()
  }

  private async probe(p: ProviderConnection, refresh: boolean): Promise<CacheEntry> {
    const fingerprint = fingerprintOf(p)
    const hit = this.cache.get(p.id)
    if (!refresh && hit && hit.fingerprint === fingerprint && this.now() - hit.at < this.ttlMs) return hit
    const entry: CacheEntry = { fingerprint, at: this.now() }
    // 官方厂商没 key 必然 401，不白发一次请求；自定义（本地网关）可以没有 key
    if (!p.apiKey && p.vendor !== 'custom') {
      entry.error = '还没有配置 API key'
      this.cache.set(p.id, entry)
      return entry
    }
    try {
      entry.ids = await this.fetchAll(p)
    } catch (e) {
      entry.error = redact(e instanceof Error ? e.message : String(e), p.apiKey)
    }
    this.cache.set(p.id, entry)
    return entry
  }

  private async fetchAll(p: ProviderConnection): Promise<string[]> {
    const { protocol } = connectionShape(providerConfigOf(p, ''))
    const baseUrl = effectiveBaseUrl(providerConfigOf(p, ''))
    if (!baseUrl) throw new Error('没有地址')
    const ids: string[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const req = probeRequest({ protocol, baseUrl, apiKey: p.apiKey, after })
      const res = await this.fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(this.timeoutMs) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const r = parseProbe(protocol, await res.json())
      ids.push(...r.ids)
      if (r.next === undefined) break
      after = r.next
    }
    return [...new Set(ids)]
  }
}

/** 协议 / 地址 / key / 启停任一变了，缓存就不作数（AC-3）。key 只进哈希 */
function fingerprintOf(p: ProviderConnection): string {
  const key = p.apiKey ? createHash('sha256').update(p.apiKey).digest('hex').slice(0, 16) : ''
  return [p.vendor, p.protocol, p.baseUrl ?? '', key, p.enabled].join('|')
}

/** 失败原因要给界面看，里面不能有 key（网关偶尔会把请求头回显在错误里） */
function redact(msg: string, key: string | undefined): string {
  const m = msg.split('\n')[0]?.slice(0, 200) ?? ''
  return key ? m.split(key).join('***') : m
}
