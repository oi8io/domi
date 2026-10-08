/**
 * `domi doctor` 的厂商能力块 —— SPEC-M15-006 AC-6
 *
 * 列出「这家支持什么、开了什么」：能力矩阵、缓存参数实际在用的哪套、服务端能力开关。
 * 纪律：只读配置与静态表，不联网、不探测厂商端点（探测是 model 包 probe 的职责）。
 */

import type { Vendor } from '@domi/config'
import { type MessageKey, tr } from '@domi/i18n'
import { CACHE_TTL_SECONDS } from '@domi/model'

export interface CapabilityReportInput {
  provider: string
  modelName: string
  baseUrl?: string | undefined
  /** config.context.cacheTtlOverride（秒）；缺省按会话档位 */
  ttlOverride?: number | undefined
  /** config.context.serverSide（SPEC-M15-006 AC-5，P1 骨架） */
  serverSide: boolean
}

export function capabilityLines(cfg: CapabilityReportInput, vendor: Vendor | undefined): string[] {
  const lines: string[] = []
  lines.push(
    tr('cli.doctor.cap.vendor', {
      provider: cfg.provider,
      model: cfg.modelName,
      baseUrl: cfg.baseUrl ?? '—',
    }),
  )
  if (!vendor) {
    lines.push(tr('cli.doctor.cap.unknown'))
    return lines
  }
  const caps = vendor.capabilities
  const capKeys: Array<[boolean, MessageKey]> = [
    [caps.toolCall, 'cli.doctor.cap.toolCall'],
    [caps.vision, 'cli.doctor.cap.vision'],
    [caps.reasoning, 'cli.doctor.cap.reasoning'],
    [caps.promptCache, 'cli.doctor.cap.promptCache'],
    [caps.structuredOutput, 'cli.doctor.cap.structuredOutput'],
  ]
  const supported = capKeys.filter(([on]) => on).map(([, k]) => tr(k))
  lines.push(
    tr('cli.doctor.cap.supported', { caps: supported.length > 0 ? supported.join(' / ') : tr('cli.doctor.cap.none') }),
  )

  // 开了什么：当前实际走的缓存参数（数据驱动：cacheMode 来自 VENDORS 表）
  const ttl = cfg.ttlOverride ?? CACHE_TTL_SECONDS.task
  const cacheLine = (() => {
    if (vendor.cacheMode === 'explicit') return tr('cli.doctor.cap.cacheExplicit', { ttl: String(ttl) })
    if (vendor.cacheMode === 'gateway-key' && cfg.baseUrl !== vendor.defaultBaseUrl)
      return tr('cli.doctor.cap.cacheGatewayKey')
    if (vendor.cacheMode === 'auto') return tr('cli.doctor.cap.cacheAuto')
    return tr('cli.doctor.cap.cacheNone')
  })()
  lines.push(cacheLine)
  lines.push(
    tr('cli.doctor.cap.serverSide', {
      state: tr(cfg.serverSide ? 'cli.doctor.cap.serverSideOn' : 'cli.doctor.cap.serverSideOff'),
    }),
  )
  return lines
}
