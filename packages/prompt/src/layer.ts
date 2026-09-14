/**
 * 分层提示词 —— PRD-M1-003 / PRD-M1-004 · SPEC-M1-004
 *
 * 这是 M1 最要紧的一条，因为它同时是三件事的地基：
 * 提示词可组合、prompt cache 能打对、以及 M2 的「压缩 × cache 交叉」。
 *
 * **核心约束只有一条**：prompt cache 按**前缀**匹配。
 * 一旦前面混进会变的内容，它后面所有 cacheable 层的缓存全部作废。
 * 这个错误在运行时表现为「命中率莫名其妙很低」，极难排查——
 * 所以必须在**构建期**就炸，而不是等 nightly 的趋势文件告诉你。
 */
import type { ModelMessages } from '@domi/protocol'

export interface PromptCtx {
  cwd: string
  model: string
  /** 会变的东西一律从 ctx 进来，且只允许出现在非 cacheable 层 */
  dynamic?: Record<string, unknown>
}

export interface PromptLayer {
  id: string
  role: 'system' | 'user'
  /** 拼装顺序**只由它决定**，与注册顺序无关 */
  priority: number
  /** 内容会变的层必须声明 false，否则它后面所有 cacheable 层的缓存都作废 */
  cacheable: boolean
  render(ctx: PromptCtx): string
}

export class CacheBoundaryError extends Error {
  readonly messageKey = 'error.cache_boundary'
  constructor(
    readonly cacheableLayer: string,
    readonly afterVolatileLayer: string,
  ) {
    super(
      `error.cache_boundary: 层 "${cacheableLayer}"(cacheable) 排在 "${afterVolatileLayer}"(非 cacheable) 之后。\n` +
        'prompt cache 按前缀匹配——前面一旦有会变的内容，后面所有 cacheable 层的缓存都作废。\n' +
        `修法：把 "${cacheableLayer}" 的 priority 调到 "${afterVolatileLayer}" 之前，或把它标成 cacheable: false。`,
    )
    this.name = 'CacheBoundaryError'
  }
}

export class DuplicateLayerError extends Error {
  constructor(readonly id: string) {
    super(`提示词层 id 重复：${id}。id 是覆盖的依据，重复会让「覆盖哪一层」变成运气。`)
    this.name = 'DuplicateLayerError'
  }
}

export interface LayerDump {
  id: string
  role: 'system' | 'user'
  priority: number
  cacheable: boolean
  chars: number
  /** 粗估，字符数 / 4。ADR-008 决定不引 tokenizer，这个数只用于人看 */
  approxTokens: number
}

export interface AssembledPrompt {
  messages: ModelMessages
  layers: LayerDump[]
  /** 稳定前缀：所有 cacheable 层拼起来的原文。cache 能不能打中，看的就是它稳不稳 */
  prefixText: string
  /** 前缀到第几层为止。M2 选压缩点时要用 */
  prefixLayerCount: number
}

export function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

/**
 * 拼装。违反 cache 边界时抛错，不是警告——
 * 警告会被忽略，而这个错误的代价是每一轮都多花几倍的钱。
 */
export function assemble(layers: readonly PromptLayer[], ctx: PromptCtx): AssembledPrompt {
  const seen = new Set<string>()
  for (const l of layers) {
    if (seen.has(l.id)) throw new DuplicateLayerError(l.id)
    seen.add(l.id)
  }

  const sorted = [...layers].sort((a, b) =>
    a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority,
  )

  let firstVolatile: PromptLayer | null = null
  for (const l of sorted) {
    if (!l.cacheable) {
      firstVolatile ??= l
      continue
    }
    if (firstVolatile) throw new CacheBoundaryError(l.id, firstVolatile.id)
  }

  const rendered = sorted.map((l) => ({ layer: l, text: l.render(ctx) }))
  const prefixLayers = rendered.filter((r) => r.layer.cacheable)
  const prefixText = prefixLayers.map((r) => r.text).join('\n\n')

  const systemText = rendered
    .filter((r) => r.layer.role === 'system')
    .map((r) => r.text)
    .join('\n\n')
  const userText = rendered
    .filter((r) => r.layer.role === 'user')
    .map((r) => r.text)
    .join('\n\n')

  const messages: ModelMessages = []
  if (systemText !== '') messages.push({ role: 'system', content: systemText })
  // 动态内容只出现在最后一条 user message（PRD-M1-004 AC-3）——
  // 这不是风格问题：它决定了稳定前缀到哪里为止
  if (userText !== '') messages.push({ role: 'user', content: userText })

  return {
    messages,
    prefixText,
    prefixLayerCount: prefixLayers.length,
    layers: rendered.map((r) => ({
      id: r.layer.id,
      role: r.layer.role,
      priority: r.layer.priority,
      cacheable: r.layer.cacheable,
      chars: r.text.length,
      approxTokens: approxTokens(r.text),
    })),
  }
}

/** 人看的 dump —— `domi prompt dump` 的输出（PRD-M1-003 AC-4） */
export function formatDump(a: AssembledPrompt): string {
  const lines = ['# 提示词拼装结果', '']
  let inPrefix = true
  for (const l of a.layers) {
    if (inPrefix && !l.cacheable) {
      lines.push(`── 稳定前缀到此为止（${a.prefixLayerCount} 层，${approxTokens(a.prefixText)} tok）──`, '')
      inPrefix = false
    }
    lines.push(`[${l.priority}] ${l.id} · ${l.role} · ${l.cacheable ? 'cacheable' : '会变'} · ~${l.approxTokens} tok`)
  }
  if (inPrefix) lines.push('', `── 全部 ${a.prefixLayerCount} 层都可缓存 ──`)
  return lines.join('\n')
}
