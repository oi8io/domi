/**
 * M14 上下文 tab 投影 —— PRD-M14-006（SPEC-M14-006）
 *
 * 纯函数（INV-04）：事件流 + session.metrics（与状态栏同源，AC-8）+ session.context RPC 静态项
 * → 九段堆叠、未归类差额、压缩记录、加载清单、读过的。
 * model.request.ctx 是字符估算（标「约」），真实总量以 m.contextTokens 为准（BUG-M13-002 口径）。
 */
import type { EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import type { MetricsSnapshot } from './store.ts'

export type ContextSegmentId =
  | 'builtin'
  | 'soul'
  | 'rules'
  | 'skills'
  | 'plan'
  | 'tools'
  | 'history'
  | 'compact'
  | 'uploads'
  | 'unclassified'

export interface ContextSegment {
  id: ContextSegmentId
  tokens: number
}

export interface CompactRecord {
  seq: number
  kind: 'compact' | 'cleanup'
  fromSeq: number
  toSeq: number
  tokensBefore: number
  tokensAfter: number
  trigger?: string
  /** 摘要 v2（PRD-M15-005 取舍-8）：新字段为主；旧字段兼容读旧会话 */
  summary?: {
    goal?: string
    userQuotes?: string[]
    keyDecisions: string[]
    files?: Array<{ path: string; note?: string }>
    errors?: string[]
    currentStep?: string
    openQuestions: string[]
    nextSteps: string[]
    intent?: string
    filesModified?: string[]
  }
}

export interface ReadThing {
  path: string
  count: number
  firstSeq: number
}

export interface McpCall {
  server: string
  tools: Array<{ name: string; count: number; firstSeq: number }>
}

export interface LoadedSkill {
  name: string
  seq: number
}

export interface ContextRef {
  seq: number
  sessionId: string
  fromSeq: number
  toSeq: number
}

export interface UploadItem {
  seq: number
  name: string
  mime: string
  size: number
}

/** session.context RPC 的静态项（SPEC-M14-006 取舍-3）；未拉取时端上标「加载中」 */
export interface CtxStatic {
  trusted: boolean | null
  rules: string[]
  skillsTotal: number
  mcp: Array<{ server: string; tools: string[] }>
  strategy: string
  thresholdPercent: number | null
  /** M15（SPEC-M15-003）：相对定格快照的待生效变化（soul / 规矩 / 技能 / 目录） */
  pending: { soul: boolean; rules: boolean; catalog: boolean; skills: boolean }
}

/** 遮蔽记录（PRD-M15-004 AC-6）：哪一步、原始大小、可定位 */
export interface MaskRecord {
  /** ctx.mask 事件自身的 seq */
  seq: number
  /** 被遮蔽的 tool.result seq 列表 */
  seqs: number[]
  reason: string
  freedTokens: number
  /** 可定位明细：工具名 + 原始字符数 */
  items: Array<{ seq: number; tool: string; chars: number }>
}

export interface ContextView {
  /** 与状态栏同源（AC-8）：直接来自 session.metrics，不另算 */
  total: number | null
  window: number | null
  cacheHitPercent: number | null
  cost?: string | undefined
  strategy: string | null
  thresholdPercent: number | null
  /** 最近一次请求的分段；没有 ctx（旧事件）→ 只有 compact / uploads 两段 */
  hasLayers: boolean
  segments: ContextSegment[]
  /** 真实总量 − 估算和（≥0）；deviation = 估算和超过了真实总量（显示「估算偏差」，不硬凑） */
  unclassified: number
  deviation: boolean
  /** 最近一次请求的层清单（含 cacheable，AC-5） */
  layers: Array<{ id: string; role: 'system' | 'user'; cacheable: boolean; approxTokens: number }> | null
  compacts: CompactRecord[]
  masks: MaskRecord[]
  reads: ReadThing[]
  mcpCalls: McpCall[]
  skills: LoadedSkill[]
  skillsTotal: number | null
  rules: string[]
  trusted: boolean | null
  refs: ContextRef[]
  uploads: UploadItem[]
  /** M15（SPEC-M15-011）：累计遮蔽释放量（ctx.mask.freedTokens 汇总）——用量条「已遮蔽」行 */
  maskedTokens: number
  /** M15（SPEC-M15-011）：非预期前缀断裂列表（ctx.prefix.break，可定位 prevSeq/nextSeq + 归因） */
  breaks: BreakRecord[]
  /** M15（SPEC-M15-011）：可避免缓存损失（token，001 session.metrics 扩展） */
  avoidableLoss: number | null
  /** M15（SPEC-M15-011）：当前被钉住的 seq（ctx.pin 最近状态，升序）——遮蔽/压缩跳过 */
  pinned: number[]
  /** M15（SPEC-M15-011）：当前占用离压缩阈值还差多少（百分比点，负 = 已过阈值） */
  thresholdGap: number | null
}

/** 前缀断裂记录（PRD-M15-001 AC-2 / SPEC-M15-011）：断在哪一层、因为什么 */
export interface BreakRecord {
  /** ctx.prefix.break 事件自身的 seq */
  seq: number
  prevSeq: number
  nextSeq: number
  cause: string
  layer?: string | undefined
  msgIndex: number
}

/** 内置四层的 id（SPEC-M14-006 取舍-2） */
const BUILTIN_IDS = new Set(['builtin.identity', 'builtin.guardrail', 'builtin.conventions', 'builtin.workspace'])
const SYSTEM_SEG_IDS: Array<{ id: ContextSegmentId; match: (layerId: string) => boolean }> = [
  { id: 'builtin', match: (id) => BUILTIN_IDS.has(id) },
  { id: 'soul', match: (id) => id === 'builtin.soul' },
  { id: 'rules', match: (id) => id === 'project.rules' },
  { id: 'skills', match: (id) => id === 'builtin.skills' },
  { id: 'plan', match: (id) => id === 'session.plan' },
]

/** 压缩段：最近一次 ctx.compact 的 tokensAfter（约，SPEC 取舍-2） */
function lastCompact(events: readonly EventEnvelope[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e && isKnownEvent(e.ev) && e.ev.t === 'ctx.compact') return e.ev.tokensAfter
  }
  return null
}

/** 附件段：窗口内 user.input.uploads 的 size/4 + 图片数 ×1600（约，SPEC 取舍-2） */
function uploadTokens(events: readonly EventEnvelope[]): number {
  let tokens = 0
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'user.input') continue
    for (const u of e.ev.uploads ?? []) {
      tokens += Math.floor(u.size / 4)
      if (u.mime.startsWith('image/')) tokens += 1_600
    }
  }
  return tokens
}

export function contextView(
  events: readonly EventEnvelope[],
  metrics: Partial<
    Pick<
      MetricsSnapshot,
      'contextTokens' | 'contextMaxTokens' | 'cacheHitPercent' | 'cost' | 'avoidableLoss' | 'contextPercent'
    >
  > | null,
  static_?: CtxStatic | null,
): ContextView {
  const m = metrics ?? {}
  // 最近一次带 ctx 的 model.request（旧事件没有 ctx 照常解析，AC-2）
  let lastCtx: {
    layers: Array<{ id: string; role: 'system' | 'user'; cacheable: boolean; approxTokens: number }>
    tools: number
    history: number
  } | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e && isKnownEvent(e.ev) && e.ev.t === 'model.request' && e.ev.ctx !== undefined) {
      lastCtx = e.ev.ctx
      break
    }
  }

  const segments: ContextSegment[] = []
  if (lastCtx !== null) {
    const layerTokens = new Map<ContextSegmentId, number>()
    for (const l of lastCtx.layers) {
      const hit = SYSTEM_SEG_IDS.find((s) => s.match(l.id))
      const id: ContextSegmentId = hit?.id ?? 'builtin' // 未映射层并入内置段（都是 system 前缀的一部分）
      layerTokens.set(id, (layerTokens.get(id) ?? 0) + l.approxTokens)
    }
    for (const s of SYSTEM_SEG_IDS) {
      const t = layerTokens.get(s.id) ?? 0
      if (t > 0) segments.push({ id: s.id, tokens: t })
    }
    if (lastCtx.tools > 0) segments.push({ id: 'tools', tokens: lastCtx.tools })
    if (lastCtx.history > 0) segments.push({ id: 'history', tokens: lastCtx.history })
  }
  const compact = lastCompact(events)
  if (compact !== null) segments.push({ id: 'compact', tokens: compact })
  const uploads = uploadTokens(events)
  if (uploads > 0) segments.push({ id: 'uploads', tokens: uploads })

  const total = m.contextTokens ?? null
  const est = segments.reduce((n, s) => n + s.tokens, 0)
  const deviation = total !== null && est > total

  // 读过的：fs.read / fs.glob / fs.grep 路径去重按次数排序；MCP 工具调用按 server 分组
  const readCount = new Map<string, { count: number; firstSeq: number }>()
  const mcpByServer = new Map<string, Map<string, { count: number; firstSeq: number }>>()
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'tool.call') continue
    const { name, args } = e.ev
    if (name === 'fs.read' || name === 'fs.glob' || name === 'fs.grep') {
      const path = (args as { path?: string; pattern?: string })?.path ?? (args as { pattern?: string })?.pattern
      if (typeof path !== 'string' || path === '') continue
      const cur = readCount.get(path)
      readCount.set(
        path,
        cur === undefined ? { count: 1, firstSeq: e.seq } : { count: cur.count + 1, firstSeq: cur.firstSeq },
      )
    } else if (name.startsWith('mcp.')) {
      const dot = name.indexOf('.', 4)
      const server = dot < 0 ? name.slice(4) : name.slice(4, dot)
      const m = mcpByServer.get(server) ?? new Map()
      const cur = m.get(name)
      m.set(name, cur === undefined ? { count: 1, firstSeq: e.seq } : { count: cur.count + 1, firstSeq: cur.firstSeq })
      mcpByServer.set(server, m)
    }
  }
  const reads: ReadThing[] = [...readCount.entries()]
    .map(([path, r]) => ({ path, count: r.count, firstSeq: r.firstSeq }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
  const mcpCalls: McpCall[] = [...mcpByServer.entries()]
    .map(([server, m]) => ({
      server,
      tools: [...m.entries()].map(([name, r]) => ({ name, count: r.count, firstSeq: r.firstSeq })),
    }))
    .sort((a, b) => a.server.localeCompare(b.server))

  // skill.load 过的 / ctx.ref / 附件
  const skills: LoadedSkill[] = []
  const refs: ContextRef[] = []
  const uploadItems: UploadItem[] = []
  for (const e of events) {
    if (!isKnownEvent(e.ev)) continue
    if (e.ev.t === 'tool.call' && e.ev.name === 'skill.load') {
      const n = (e.ev.args as { name?: string })?.name
      if (typeof n === 'string') skills.push({ name: n, seq: e.seq })
    } else if (e.ev.t === 'ctx.ref') {
      refs.push({ seq: e.seq, sessionId: e.ev.sessionId, fromSeq: e.ev.fromSeq, toSeq: e.ev.toSeq })
    } else if (e.ev.t === 'user.input') {
      for (const u of e.ev.uploads ?? []) uploadItems.push({ seq: e.seq, name: u.name, mime: u.mime, size: u.size })
    }
  }

  // M15（SPEC-M15-011）：累计遮蔽释放量、前缀断裂列表、钉住状态
  let maskedTokens = 0
  const breaks: BreakRecord[] = []
  const pinnedSet = new Map<number, boolean>()
  for (const e of events) {
    if (!isKnownEvent(e.ev)) continue
    if (e.ev.t === 'ctx.mask') maskedTokens += e.ev.freedTokens
    else if (e.ev.t === 'ctx.prefix.break') {
      breaks.push({
        seq: e.seq,
        prevSeq: e.ev.prevSeq,
        nextSeq: e.ev.nextSeq,
        cause: e.ev.cause,
        ...(e.ev.layer === undefined ? {} : { layer: e.ev.layer }),
        msgIndex: e.ev.msgIndex,
      })
    } else if (e.ev.t === 'ctx.pin') pinnedSet.set(e.ev.seq, e.ev.pinned)
  }
  const pinned = [...pinnedSet.entries()]
    .filter(([, v]) => v)
    .map(([seq]) => seq)
    .sort((a, b) => a - b)

  return {
    total,
    window: m.contextMaxTokens ?? null,
    cacheHitPercent: m.cacheHitPercent ?? null,
    ...(m.cost === undefined ? {} : { cost: m.cost }),
    strategy: static_?.strategy ?? null,
    thresholdPercent: static_?.thresholdPercent ?? null,
    hasLayers: lastCtx !== null,
    segments,
    unclassified: deviation ? 0 : Math.max(0, (total ?? 0) - est),
    deviation,
    layers: lastCtx?.layers ?? null,
    compacts: compactRecords(events),
    masks: maskRecords(events),
    reads,
    mcpCalls,
    skills,
    skillsTotal: static_?.skillsTotal ?? null,
    rules: static_?.rules ?? [],
    trusted: static_?.trusted ?? null,
    refs,
    uploads: uploadItems,
    maskedTokens,
    breaks,
    avoidableLoss: m.avoidableLoss ?? null,
    pinned,
    // 离压缩阈值还差多少：阈值百分比 − 当前占用百分比（负 = 已过阈值）
    thresholdGap:
      static_?.thresholdPercent != null && m.contextPercent != null
        ? static_.thresholdPercent - m.contextPercent
        : null,
  }
}

/** 压缩记录：ctx.compact / ctx.cleanup 按时间一行（AC-4） */
export function compactRecords(events: readonly EventEnvelope[]): CompactRecord[] {
  const out: CompactRecord[] = []
  for (const e of events) {
    if (!isKnownEvent(e.ev)) continue
    if (e.ev.t === 'ctx.compact') {
      out.push({
        seq: e.seq,
        kind: 'compact',
        fromSeq: e.ev.fromSeq,
        toSeq: e.ev.toSeq,
        tokensBefore: e.ev.tokensBefore,
        tokensAfter: e.ev.tokensAfter,
        trigger: e.ev.trigger,
        ...(e.ev.summary !== undefined ? { summary: e.ev.summary as NonNullable<CompactRecord['summary']> } : {}),
      })
    } else if (e.ev.t === 'ctx.cleanup') {
      out.push({
        seq: e.seq,
        kind: 'cleanup',
        fromSeq: e.ev.fromSeq,
        toSeq: e.ev.toSeq,
        tokensBefore: e.ev.tokensBefore,
        tokensAfter: e.ev.tokensAfter,
      })
    }
  }
  return out
}

/** 遮蔽记录（PRD-M15-004 AC-6）：ctx.mask 一批一行；items 带工具名与原始大小，可定位 */
export function maskRecords(events: readonly EventEnvelope[]): MaskRecord[] {
  const calls = new Map<string, { name: string; seq: number }>()
  for (const e of events) {
    if (!isKnownEvent(e.ev)) continue
    if (e.ev.t === 'tool.call') calls.set(e.ev.id, { name: e.ev.name, seq: e.seq })
  }
  const out: MaskRecord[] = []
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'ctx.mask') continue
    const bySeq = new Map(e.ev.seqs.map((s) => [s, s]))
    const items: MaskRecord['items'] = []
    for (const env of events) {
      if (!bySeq.has(env.seq) || !isKnownEvent(env.ev) || env.ev.t !== 'tool.result') continue
      const raw = typeof env.ev.payload === 'string' ? env.ev.payload : JSON.stringify(env.ev.payload)
      items.push({
        seq: env.seq,
        tool: calls.get(env.ev.id)?.name ?? 'tool',
        chars: raw.length,
      })
    }
    out.push({ seq: e.seq, seqs: e.ev.seqs, reason: e.ev.reason, freedTokens: e.ev.freedTokens, items })
  }
  return out
}
