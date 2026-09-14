/**
 * 事件契约 —— 唯一契约来源。见 docs/spec/M0.md §3.1
 *
 * INV-01：事件类型只增不改，任意历史事件永远可解析。
 * 因此本文件有两条硬规则（SPEC-M0-004）：
 *   1. 字段只增不改不删；新增字段必须可选且有默认值
 *   2. 未知事件类型**降级**为 UnknownEvent 保留原文，绝不抛错
 */
import { z } from 'zod'

/**
 * 当前代码认识的 schema 版本。
 *
 * **新增事件类型时 +1，并追加一份 `fixtures/events/legacy-v{n}.jsonl`。**
 * v1 → v2：新增 `fs.snapshot`（文件写入前后指纹），`error` 新增可选的 `counters`。
 * v2 → v3：新增 `model.switch` / `snapshot` / `revert`（M1-002、M1-011）。
 * v3 → v4：新增 `ctx.cleanup`（M2-002 确定性上下文清理）。
 * v4 → v5：新增 `ctx.compact`（M2-003 LLM 压缩）。
 * 旧事件仍然可解析：新增类型不影响已知类型，新增字段是可选的（SPEC-M0-004）。
 */
export const SCHEMA_VERSION = 5

export const RefSchema = z.object({ kind: z.string(), id: z.string() })
export type Ref = z.infer<typeof RefSchema>

/**
 * 每个分支都用 `z.looseObject`（zod 4 里 `.passthrough()` 的替代）：
 * **已知类型 + 未来新增字段**时，字段必须留下来。
 * 严格 object 会 strip 掉新版本写入的字段——payload 还在磁盘上，但内存里没了，
 * 轨迹与导出都看不到。那是 INV-01 的另一种违反方式。
 */
export const DomiEventSchema = z.discriminatedUnion('t', [
  z.looseObject({ t: z.literal('user.input'), text: z.string(), attachments: z.array(RefSchema).optional() }),
  z.looseObject({
    t: z.literal('model.request'),
    provider: z.string(),
    model: z.string(),
    tokensIn: z.number().int().nonnegative(),
  }),
  z.looseObject({ t: z.literal('model.delta'), text: z.string() }),
  z.looseObject({ t: z.literal('model.reason'), text: z.string() }),
  // ADR-004：原始 usage 原样透传，不做字段归一——压缩 × prompt cache 那一块要用
  z.looseObject({ t: z.literal('model.usage'), raw: z.record(z.string(), z.unknown()) }),
  z.looseObject({ t: z.literal('tool.call'), id: z.string(), name: z.string(), args: z.unknown() }),
  /**
   * 文件写入前后的内容指纹（PRD-M0-004 AC-2）。
   * before 的 sha256 为 null 表示文件原本不存在。
   * 有了这两条，任意一步的文件变更都能重建 diff——M1-011 的步级快照直接吃这个。
   */
  z.looseObject({
    t: z.literal('fs.snapshot'),
    path: z.string(),
    phase: z.enum(['before', 'after']),
    sha256: z.string().nullable(),
    bytes: z.number().int().nonnegative(),
  }),
  z.looseObject({
    t: z.literal('tool.result'),
    id: z.string(),
    ok: z.boolean(),
    payload: z.unknown(),
    ms: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  z.looseObject({
    t: z.literal('permission'),
    capabilityId: z.string(),
    decision: z.enum(['allow', 'deny', 'ask']),
    source: z.enum(['default', 'config', 'user']),
    matchedRule: z.string().nullable(),
  }),
  /** M1-002：切换模型。事件流一条不动，上下文按新模型窗口重拼是 buildContext 的事 */
  z.looseObject({
    t: z.literal('model.switch'),
    from: z.string(),
    to: z.string(),
    reason: z.string().optional(),
    lostCapabilities: z.array(z.string()).optional(),
  }),
  /** M1-011：一次影子仓库快照 */
  z.looseObject({
    t: z.literal('snapshot'),
    id: z.string(),
    label: z.string(),
    files: z.number().int().nonnegative(),
    /** 超过阈值只记指纹没存内容的文件数（AC-5） */
    largeFilesSkipped: z.number().int().nonnegative().optional(),
  }),
  /**
   * M1-011：回滚。**append-only** —— 它不删除任何事件，
   * 只是声明「从 toSeq 之后的那一段作废」（INV-01 / INV-12）。
   */
  z.looseObject({
    t: z.literal('revert'),
    toSeq: z.number().int().positive(),
    scope: z.enum(['files', 'conversation', 'both']),
    snapshotId: z.string().nullable(),
    /** 回滚前对当前状态打的那一个快照，让回滚本身可回滚（AC-4） */
    undoSnapshotId: z.string().nullable(),
  }),
  /**
   * 确定性上下文清理 —— PRD-M2-002 AC-4。
   *
   * 它记的是**投影层**发生了什么，事件流本身一条没动（INV-12）：
   * 清理只改「这一轮送给模型的上下文长什么样」，不改磁盘上的历史。
   * 各类别单独记 token 数，是为了让人能回答「到底是哪一类在省钱」——
   * 只给一个总数的话，调清理规则时无从下手。
   */
  z.looseObject({
    t: z.literal('ctx.cleanup'),
    fromSeq: z.number().int().nonnegative(),
    toSeq: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    /** 各类别削减的 token 数。键是清理规则的 id，值只增不减 */
    saved: z.object({
      dedupe: z.number().int().nonnegative(),
      verbose: z.number().int().nonnegative(),
      resolvedError: z.number().int().nonnegative(),
      stack: z.number().int().nonnegative(),
    }),
    /** 被显式标注为「后续引用过」因而整条保留的 seq —— 逐条可查（AC-2） */
    preserved: z.array(z.number().int().positive()),
  }),
  /**
   * LLM 压缩 —— PRD-M2-003 AC-4。
   *
   * **它只是一条追加的事件**：原始事件一条没动、一个字节没改（INV-12）。
   * 压缩改的是「拼上下文时中间那段用什么代替」，而不是「历史变成了什么」。
   * 所以 AC-5 的重放等价性是免费得到的——从原始事件流重放，压缩前后一模一样。
   *
   * `summary` 是**固定字段结构**而不是自由文本（AC-3）：
   * 自由文本摘要没法断言、没法比较、下一次压缩还要把它再压一遍。
   */
  z.looseObject({
    t: z.literal('ctx.compact'),
    /** 被摘要覆盖的事件区间（闭区间）。区间之外的逐字保留 */
    fromSeq: z.number().int().nonnegative(),
    toSeq: z.number().int().nonnegative(),
    /** 逐字保留的最近轮数（AC-2） */
    keptTurns: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    trigger: z.enum(['threshold', 'manual']),
    summary: z.object({
      intent: z.string(),
      filesModified: z.array(z.string()),
      keyDecisions: z.array(z.string()),
      openQuestions: z.array(z.string()),
      nextSteps: z.array(z.string()),
    }),
  }),
  z.looseObject({
    t: z.literal('error'),
    scope: z.string(),
    message: z.string(),
    recoverable: z.boolean(),
    /**
     * 终止时三个计数器的当时值（SPEC-M0-007）。可选——旧事件没有这个字段照样解析。
     * 放进契约而不是塞在 looseObject 的额外字段里，是为了让它出现在 .api.md 快照里：
     * 轨迹排查时人要能知道"到底是哪个上限触发的"。
     */
    counters: z
      .object({
        toolCalls: z.number().int().nonnegative(),
        argParseRetries: z.number().int().nonnegative(),
        elapsedMs: z.number().int().nonnegative(),
      })
      .optional(),
  }),
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
  // 先判类型再用 `in`：对非对象用 `in` 会抛 TypeError，而 INV-01 说这条路径上永不抛错。
  // 正常路径（parseEvent）永远给对象，但这两个函数是**导出**的，谁都能拿脏数据来调
  return typeof ev === 'object' && ev !== null && '__unparsed' in ev
}

/**
 * 与 isUnknownEvent 互补。
 * 必须显式写成 `ev is DomiEvent` —— 用 `Exclude<AnyEvent, UnknownEvent>` 收窄是不行的：
 * `__unparsed` 是 z.unknown()，推出来的字段是**可选**的，Exclude 匹配不上，
 * 于是 else 分支拿不到具体字段。这个坑在运行时看不出来，只有 tsc 会说话。
 */
export function isKnownEvent(ev: AnyEvent): ev is DomiEvent {
  return typeof ev === 'object' && ev !== null && !('__unparsed' in ev)
}

/**
 * 宽容解析：已知类型走严格 schema，其余一律降级。
 * **本函数永不抛错** —— 抛错就违反 INV-01。
 */
export function parseEvent(raw: unknown, schemaVersion: number = SCHEMA_VERSION): AnyEvent {
  const parsed = DomiEventSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const t =
    typeof raw === 'object' && raw !== null && 't' in raw && typeof (raw as { t: unknown }).t === 'string'
      ? (raw as { t: string }).t
      : 'unknown'
  return { t, __unparsed: raw, __schemaVersion: schemaVersion }
}
