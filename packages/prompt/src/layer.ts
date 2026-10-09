/**
 * 分层提示词 —— PRD-M1-003 / PRD-M1-004 · SPEC-M1-004
 *
 * 这是 M1 最要紧的一条，因为它同时是三件事的地基：
 * 提示词可组合、prompt cache 能打对、以及压缩时不打坏 cache（compact 原样保留 system 前缀，见 memory/compact.ts）。
 *
 * **核心约束只有一条**：prompt cache 按**前缀**匹配。
 * 一旦前面混进会变的内容，它后面所有 cacheable 层的缓存全部作废。
 * 这个错误在运行时表现为「命中率莫名其妙很低」，极难排查——
 * 所以必须在**构建期**就炸，而不是等 nightly 的趋势文件告诉你。
 */
import type { ModelMessages } from '@domi/protocol'
import { estimateTextTokens, fnv1a } from '@domi/protocol'

export interface PromptCtx {
  cwd: string
  model: string
  /**
   * M15（SPEC-M15-010 AC-1）：身份分段模式。默认 chat（通用身份）；
   * task=任务模式（先写计划）、subagent=子 agent（只回结论、控制长度）。全在冻结前缀里。
   */
  mode?: 'chat' | 'task' | 'subagent' | undefined
  /**
   * M15（SPEC-M15-010 AC-2）：环境定格快照（会话开始采集一次）。
   * 会变的一半（日期/git 分支与改动文件数）不走这里——由 runtime 以 ctx.note 追加送达。
   */
  env?: PromptEnv | undefined
  /** 会变的东西一律从 ctx 进来，且只允许出现在非 cacheable 层 */
  dynamic?: Record<string, unknown>
}

/** 环境定格：与会话同生的字段。采集在 runtime（collectEnv），这里只定义形状 */
export interface PromptEnv {
  /** 例如 darwin arm64 */
  os: string
  /** 例如 /bin/zsh */
  shell: string
  /** 项目根（向上找到 package.json 等） */
  projectRoot: string
  /** 项目类型：node / rust / go / python / unknown… */
  projectType: string
  /** 包管理器：pnpm / yarn / npm / bun / cargo…（按锁文件与工具推断） */
  pkgManager: string
  /** git 远端（origin）；没有 git 或没有远端时为 null */
  gitRemote: string | null
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
  /** 粗估（`estimateTextTokens` 口径：CJK 每字 1、其余每 4 字符 1）。ADR-008 决定不引 tokenizer，这个数只用于人看 */
  approxTokens: number
}

export interface AssembledPrompt {
  messages: ModelMessages
  layers: LayerDump[]
  /** 稳定前缀：所有 cacheable 层拼起来的原文。cache 能不能打中，看的就是它稳不稳 */
  prefixText: string
  /** 前缀到第几层为止。目前只给 `domi prompt dump` 标前缀边界用（压缩没有用它，而是整段保留 system 前缀） */
  prefixLayerCount: number
  /**
   * M15（SPEC-M15-001）：每层渲染文本的 FNV-1a 哈希。
   * 只记哈希不记文本——前缀指纹（model.request.fingerprint）用它定位「断在哪一层」。
   * 不落盘（ctx.layers 仍只带估算，不带文本与哈希）
   */
  layerFingerprints: Array<{ id: string; hash: string }>
}

/** 与 `@domi/protocol` 的 `estimateTextTokens` 同口径（BUG-M14-001） */
export function approxTokens(s: string): number {
  return estimateTextTokens(s)
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
    layerFingerprints: rendered.map((r) => ({ id: r.layer.id, hash: fnv1a(r.text) })),
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
