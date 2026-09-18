/**
 * 模型探测的协议细节 —— PRD-M9-001 AC-1 / AC-4 · SPEC-M9-001 取舍-6
 *
 * 这里只有纯函数：「给协议 + 地址 + key → 请求」「给响应 JSON → 模型 id 与下一页游标」「这个 id 是不是对话模型」。
 * 发请求、超时、并发、缓存、降级都在 runtime 的 ModelCatalog 里——那边能注入 fetch 与时钟，这边不碰 IO。
 *
 * 两种协议都用 `GET {base}/models`：
 *   - openai：`Authorization: Bearer <key>`，一次返回全部（`{ data: [{ id }] }`）
 *   - anthropic：`x-api-key` + `anthropic-version`，**默认一页只有 20 条**，要带 `limit=1000` 并按 `has_more / last_id` 翻页——
 *     只取第一页会静默丢模型（复核 B5）
 */
import type { Protocol } from '@domi/config'

export const ANTHROPIC_VERSION = '2023-06-01'
/** Anthropic 单页上限 */
export const ANTHROPIC_PAGE = 1000
/** 最多翻几页。1000 × 5 已经远超任何一家的模型数；防的是网关回错的 has_more 让我们无限翻 */
export const MAX_PAGES = 5

export interface ProbeRequest {
  url: string
  headers: Record<string, string>
}

export function probeRequest(opts: {
  protocol: Protocol
  /** 已经规整过的地址（effectiveBaseUrl）：anthropic 带 /v1，openai 兼容的带各家自己的前缀 */
  baseUrl: string
  apiKey?: string | undefined
  /** 上一页的 last_id（只有 anthropic 用） */
  after?: string | undefined
}): ProbeRequest {
  const base = opts.baseUrl.replace(/\/+$/, '')
  if (opts.protocol === 'anthropic') {
    const q = new URLSearchParams({ limit: String(ANTHROPIC_PAGE) })
    if (opts.after !== undefined) q.set('after_id', opts.after)
    return {
      url: `${base}/models?${q}`,
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
      },
    }
  }
  return {
    url: `${base}/models`,
    headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
  }
}

export class ProbeShapeError extends Error {
  constructor(what: string) {
    super(`响应形状不对：${what}`)
    this.name = 'ProbeShapeError'
  }
}

/** 解析一页。形状不对抛 ProbeShapeError（调用方把它当探测失败、走降级） */
export function parseProbe(protocol: Protocol, body: unknown): { ids: string[]; next?: string } {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { data?: unknown }).data)) {
    throw new ProbeShapeError('没有 data 数组')
  }
  const b = body as { data: unknown[]; has_more?: unknown; last_id?: unknown }
  const ids = b.data
    .map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id !== '')
    // Gemini 的兼容端点回的是 `models/gemini-…`，而对话接口要的是不带前缀的名字
    .map((id) => id.replace(/^models\//, ''))
  const next = protocol === 'anthropic' && b.has_more === true && typeof b.last_id === 'string' ? b.last_id : undefined
  return next === undefined ? { ids } : { ids, next }
}

/**
 * 非对话模型的规则表（PRD-M9-001 AC-4）。只有这一份；探测结果过一遍它再进下拉。
 * 按名字认：各家的 /models 都不说「这是不是对话模型」，名字是唯一稳定的线索
 */
export const NON_CHAT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/embed/i, 'embedding'],
  [/(^|[-_/])tts([-_]|$)/i, '语音合成'],
  [/whisper|transcri/i, '语音转写'],
  [/dall-e|(^|[-_/])image([-_]|$)|imagen/i, '图像生成'],
  [/moderation/i, '内容审核'],
  [/realtime/i, '实时语音'],
  [/(^|[-_/])audio([-_]|$)/i, '音频'],
  [/(^|[-_/])(davinci|babbage)/i, '旧补全模型'],
  [/(^|[-_/])sora/i, '视频生成'],
  [/(^|[-_/])veo([-_]|$)/i, '视频生成'],
]

/** 这个 id 是对话模型吗 */
export function isChatModel(id: string): boolean {
  return !NON_CHAT_PATTERNS.some(([re]) => re.test(id))
}
