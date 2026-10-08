/**
 * 前缀指纹 —— SPEC-M15-001（尺子 · PRD-M15-001）。
 *
 * **纯函数**（INV-02）：不读时钟、不碰 IO。输入是请求前的原始材料（工具 schema / 层哈希 / 消息），
 * 输出是随 model.request 落盘的指纹与相邻请求的断裂定位。
 *
 * 指纹只记哈希不记内容：定位「工具表 / 哪一层 / 哪一条消息变了」，
 * 归因（cause）由 runtime 结合事件流补齐（这里给默认映射，runtime 可覆盖）。
 */
import { fnv1a, type ModelMessages } from '@domi/protocol'

export interface LayerFingerprint {
  id: string
  hash: string
}

export interface Fingerprint {
  toolHash: string
  layers: LayerFingerprint[]
  /** 每条消息的 FNV-1a（role + content 的稳定序列化），顺序即消息顺序 */
  messages: string[]
}

/** 稳定序列化：数组按序、对象键**排序**（同一 schema 不同声明顺序也逐字节一致，002 工具表稳定） */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'null'
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** 消息内容稳定序列化：数组按序、对象键排序，images 剔除（不进提示词） */
export function stableMessageHash(m: ModelMessages[number]): string {
  const { images, ...rest } = m as { images?: unknown }
  return fnv1a(stableJson({ ...rest, images: undefined }))
}

export function fingerprintOf(input: {
  toolSchemas: readonly unknown[]
  layers?: LayerFingerprint[] | undefined
  messages: ModelMessages
}): Fingerprint {
  return {
    toolHash: fnv1a(input.toolSchemas.map((t) => stableJson(t)).join('\u0000')),
    layers: input.layers ?? [],
    // M15 口径：assistant 回复与 tool 消息是**协议必需**的回灌（永远会追加、不可避免），
    // 不参与「可避免断裂」度量——只比 system / user 段（前缀与用户侧内容）
    messages: input.messages.filter((m) => m.role === 'system' || m.role === 'user').map(stableMessageHash),
  }
}

/** 层 id → 默认归因。runtime 可结合事件流覆盖（例如 session.plan 变化实际由哪条 plan.update 引起） */
export const DEFAULT_LAYER_CAUSES: Record<string, string> = {
  'builtin.identity': 'identity',
  'builtin.guardrail': 'guardrail',
  'builtin.conventions': 'conventions',
  'builtin.soul': 'soul',
  'builtin.skills': 'skills',
  'builtin.workspace': 'env',
  'session.plan': 'plan.update',
  'session.identity': 'session.identity',
  'session.env': 'env',
  'session.rules': 'rules',
}

export interface BreakLocation {
  /** 断在哪一层（层哈希不同时；层清单不同也归到第一个差异层） */
  layer?: string
  /** 断在哪一条消息（index，从 0 起；消息数不同时指向第一条多出来的） */
  msgIndex: number
  /** 默认归因（runtime 可覆盖） */
  cause: string
}

/**
 * 相邻两次请求的前缀指纹对比。完全一致返回 null。
 * 规则（先层后消息）：工具表 → 层清单与哈希 → 消息逐条。
 * 尾部追加（新用户输入 / 新轮）是协议必需，不算可避免断裂，返回 null。
 */
export function locateBreak(prev: Fingerprint, next: Fingerprint): BreakLocation | null {
  if (prev.toolHash !== next.toolHash) return { msgIndex: 0, cause: 'tools' }

  const prevLayers = new Map(prev.layers.map((l) => [l.id, l.hash]))
  for (const l of next.layers) {
    if (prevLayers.get(l.id) !== l.hash)
      return { layer: l.id, msgIndex: 0, cause: DEFAULT_LAYER_CAUSES[l.id] ?? 'layer' }
  }
  if (prev.layers.length !== next.layers.length) {
    const nextIds = new Set(next.layers.map((l) => l.id))
    for (const l of prev.layers) {
      if (!nextIds.has(l.id)) return { layer: l.id, msgIndex: 0, cause: DEFAULT_LAYER_CAUSES[l.id] ?? 'layer' }
    }
  }

  const n = Math.min(prev.messages.length, next.messages.length)
  for (let i = 0; i < n; i++) {
    if (prev.messages[i] !== next.messages[i]) {
      return { msgIndex: i, cause: 'message' }
    }
  }
  if (prev.messages.length !== next.messages.length) {
    // 长的那方是短的那方的**前缀**（尾部追加 = 新输入 / 新轮，协议必需）→ 不算可避免断裂
    const longer = prev.messages.length < next.messages.length ? next : prev
    const shorter = prev.messages.length < next.messages.length ? prev : next
    if (longer.messages.slice(0, shorter.messages.length).every((h, i) => h === shorter.messages[i])) return null
    return { msgIndex: n, cause: 'messages.length' }
  }
  return null
}
