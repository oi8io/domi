/**
 * 事件契约 —— 唯一契约来源。见 docs/spec/M0.md §3.1
 *
 * INV-01：事件类型只增不改，任意历史事件永远可解析。
 * 因此本文件有两条硬规则（SPEC-M0-004）：
 *   1. 字段只增不改不删；新增字段必须可选且有默认值
 *   2. 未知事件类型**降级**为 UnknownEvent 保留原文，绝不抛错
 */
import { z } from 'zod'

/** 当前代码认识的 schema 版本。新增事件类型时 +1，并追加一份 fixtures/events/legacy-v{n}.jsonl */
export const SCHEMA_VERSION = 1

export const RefSchema = z.object({ kind: z.string(), id: z.string() })
export type Ref = z.infer<typeof RefSchema>

/**
 * 每个分支都 .passthrough()：**已知类型 + 未来新增字段**时，字段必须留下来。
 * zod 默认 strip 会让 read() 静默丢掉新版本写入的字段——payload 还在磁盘上，
 * 但内存里没了，轨迹与导出都看不到。那是 INV-01 的另一种违反方式。
 */
export const DomiEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('user.input'), text: z.string(), attachments: z.array(RefSchema).optional() }).passthrough(),
  z.object({ t: z.literal('model.request'), provider: z.string(), model: z.string(), tokensIn: z.number().int().nonnegative() }).passthrough(),
  z.object({ t: z.literal('model.delta'), text: z.string() }).passthrough(),
  z.object({ t: z.literal('model.reason'), text: z.string() }).passthrough(),
  // ADR-004：原始 usage 原样透传，不做字段归一——压缩 × prompt cache 那一块要用
  z.object({ t: z.literal('model.usage'), raw: z.record(z.unknown()) }).passthrough(),
  z.object({ t: z.literal('tool.call'), id: z.string(), name: z.string(), args: z.unknown() }).passthrough(),
  z.object({
    t: z.literal('tool.result'),
    id: z.string(),
    ok: z.boolean(),
    payload: z.unknown(),
    ms: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }).passthrough(),
  z.object({
    t: z.literal('permission'),
    capabilityId: z.string(),
    decision: z.enum(['allow', 'deny', 'ask']),
    source: z.enum(['default', 'config', 'user']),
    matchedRule: z.string().nullable(),
  }).passthrough(),
  z.object({ t: z.literal('error'), scope: z.string(), message: z.string(), recoverable: z.boolean() }).passthrough(),
])
export type DomiEvent = z.infer<typeof DomiEventSchema>

/** 未知事件降级壳：保留原文，永不丢弃。这是 INV-01「永远可解析」的实现 */
export const UnknownEventSchema = z.object({
  t: z.string(),
  __unparsed: z.unknown(),
  __schemaVersion: z.number().int(),
})
export type UnknownEvent = z.infer<typeof UnknownEventSchema>

export type AnyEvent = DomiEvent | UnknownEvent

export const EventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  sessionId: z.string(),
  parentSeq: z.number().int().positive().nullable(),
  ts: z.number().int(),
  schemaVersion: z.number().int(),
  ev: z.union([DomiEventSchema, UnknownEventSchema]),
})
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

export function isUnknownEvent(ev: AnyEvent): ev is UnknownEvent {
  return '__unparsed' in ev
}

/**
 * 与 isUnknownEvent 互补。
 * 必须显式写成 `ev is DomiEvent` —— 用 `Exclude<AnyEvent, UnknownEvent>` 收窄是不行的：
 * `__unparsed` 是 z.unknown()，推出来的字段是**可选**的，Exclude 匹配不上，
 * 于是 else 分支拿不到具体字段。这个坑在运行时看不出来，只有 tsc 会说话。
 */
export function isKnownEvent(ev: AnyEvent): ev is DomiEvent {
  return !('__unparsed' in ev)
}

/**
 * 宽容解析：已知类型走严格 schema，其余一律降级。
 * **本函数永不抛错** —— 抛错就违反 INV-01。
 */
export function parseEvent(raw: unknown, schemaVersion: number = SCHEMA_VERSION): AnyEvent {
  const parsed = DomiEventSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const t = typeof raw === 'object' && raw !== null && 't' in raw && typeof (raw as { t: unknown }).t === 'string'
    ? (raw as { t: string }).t
    : 'unknown'
  return { t, __unparsed: raw, __schemaVersion: schemaVersion }
}
