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
 * v5 → v6：新增 `ctx.ref`（M3-005 跨会话引用）。
 * v6 → v7：新增 `memory.write`（M4 语义记忆与 Soul）。
 * v7 → v8：新增 `task.spawn` / `task.run` / `task.node` / `task.resume` / `task.retry` / `task.end`（M5 编排）；
 *          `permission` 新增可选的 `channel`（M5-007 审批从哪来）。
 * v8 → v9：新增 `plugin.error`（M6-003 插件崩溃 / 超时 / 协议错乱）。
 * v9 → v10：M7 会写代码——新增 `workspace.trust` `hook.run` `verify.required` `mode.switch` `plan.proposed` `plan.decided`
 *          `worktree.create` `worktree.discard` `worktree.restore` `worktree.apply` `budget.warn` `budget.decided` `review.findings`；
 *          `permission.source` 新增取值 `mode`（计划模式拒绝的）。
 * v10 → v11：M8 工作台——新增 `session.kind`（自由会话 / 任务）`project.assign`（任务归到哪个项目）`schedule.fire`（定时触发）。
 * 旧事件仍然可解析：新增类型不影响已知类型，新增字段是可选的（SPEC-M0-004）。
 */
export const SCHEMA_VERSION = 11

export const RefSchema = z.object({ kind: z.string(), id: z.string() })
export type Ref = z.infer<typeof RefSchema>

/**
 * 指向另一个会话里一段事件的链接（PRD-M3-005 AC-2）。seq 是那个会话的**视图**编号（含父链，见 session.subscribe），
 * 闭区间。事件只增不改，所以这段内容永远不会变——存链接就够了，不必拷贝
 */
export const RefLinkSchema = z.object({
  sessionId: z.string(),
  fromSeq: z.number().int().min(1),
  toSeq: z.number().int().min(1),
})
export type RefLink = z.infer<typeof RefLinkSchema>

/** L3 语义记忆的一条（PRD-M4-001）。sourceRefs 指回支撑它的原始事件（AC-2） */
export const SemanticItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['fact', 'preference', 'entity']),
  text: z.string(),
  sourceRefs: z.array(z.object({ sessionId: z.string(), seq: z.number().int().min(1) })),
})
export type SemanticItem = z.infer<typeof SemanticItemSchema>

export const SOUL_SECTIONS = ['工作习惯', '技术偏好', '沟通风格', '领域知识', '对用户的模型', '失败教训'] as const
export type SoulSection = (typeof SOUL_SECTIONS)[number]

/**
 * Soul 的一处改动（PRD-M4-002 / 003 · docs/adr/019）。before / after 是那一行的完整文字（含 src 注释），
 * add 没有 before，remove 没有 after
 */
export const SoulChangeSchema = z.object({
  id: z.string(),
  section: z.enum(SOUL_SECTIONS),
  op: z.enum(['add', 'update', 'remove']),
  before: z.string().optional(),
  after: z.string().optional(),
  sources: z.array(z.string()),
})
export type SoulChange = z.infer<typeof SoulChangeSchema>

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
    /** mode：计划模式下只读之外的能力一律拒绝（M7-005） */
    source: z.enum(['default', 'config', 'user', 'mode']),
    matchedRule: z.string().nullable(),
    /** 用户是在哪个端上回答的（tui / web / telegram）。只有 source:'user' 时才有 */
    channel: z.string().optional(),
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
  /**
   * M3-005：这一轮引用了另一个会话的一段轨迹。紧挨在它引用给的那条 user.input 前面落盘。
   * 只存链接；内容在拼上下文时按链接读出来（AC-2）
   */
  z.looseObject({
    t: z.literal('ctx.ref'),
    sessionId: z.string(),
    fromSeq: z.number().int().min(1),
    toSeq: z.number().int().min(1),
  }),
  /**
   * M4：记忆层的写入。事件是真相，L3 表与 soul.md 的「domi 写过什么」都是它的投影（INV-01 · docs/adr/018/019）。
   *   L3 add        新增一条（item）          L3 delete  删除一条（itemId）
   *   L3 extracted  某会话抽取到了第几条（range），不重复抽
   *   L4 update     Soul 的一批改动（changes）  L4 review  审阅结论（reviews）
   * diff 是给人看的文字版，轨迹里直接能读
   */
  z.looseObject({
    t: z.literal('memory.write'),
    layer: z.enum(['L3', 'L4']),
    op: z.enum(['add', 'delete', 'extracted', 'update', 'review']),
    diff: z.string(),
    item: SemanticItemSchema.optional(),
    itemId: z.string().optional(),
    range: RefLinkSchema.optional(),
    changes: z.array(SoulChangeSchema).optional(),
    reviews: z.array(z.object({ changeId: z.string(), decision: z.enum(['accept', 'reject']) })).optional(),
  }),
  /** M5-001：派生子 agent。随工具结果落在父会话里；子会话的事件只在子会话里 */
  z.looseObject({
    t: z.literal('task.spawn'),
    childSessionId: z.string(),
    goal: z.string(),
    tools: z.array(z.string()).optional(),
  }),
  /** M5-002：一次 DAG 运行的开头。spec 是当时的快照，之后改 YAML 文件不影响这次运行 */
  z.looseObject({ t: z.literal('task.run'), name: z.string(), spec: z.unknown(), cwd: z.string().optional() }),
  /** 节点状态变化。状态本身是这些事件的投影（INV-01） */
  z.looseObject({
    t: z.literal('task.node'),
    nodeId: z.string(),
    status: z.enum(['started', 'done', 'failed']),
    attempt: z.number().int().min(1),
    output: z.string().optional(),
    error: z.string().optional(),
    /** agent-step / sub-agent 节点自己的会话 */
    sessionId: z.string().optional(),
    ms: z.number().int().nonnegative().optional(),
  }),
  /** M5-003：daemon 重启后接着跑。completed 是恢复点；rerun 是中断时正在跑、要重跑的节点 */
  z.looseObject({
    t: z.literal('task.resume'),
    completed: z.array(z.string()),
    rerun: z.array(z.string()),
  }),
  z.looseObject({ t: z.literal('task.retry'), nodeId: z.string() }),
  /** M6-003：插件进程出了问题（崩溃、超时、输出不是协议）。daemon 不受影响，这一次工具调用失败 */
  z.looseObject({ t: z.literal('plugin.error'), plugin: z.string(), tool: z.string().optional(), message: z.string() }),
  z.looseObject({ t: z.literal('task.end'), status: z.enum(['done', 'failed', 'cancelled']) }),
  /** M7-002：这个仓库的规矩文件与项目目录能不能进提示词。stored = 以前答过；default = 没人能回答，按不信任 */
  z.looseObject({
    t: z.literal('workspace.trust'),
    root: z.string(),
    trusted: z.boolean(),
    source: z.enum(['user', 'stored', 'default']),
  }),
  /** M7-003：跑了一个用户配置的钩子 */
  z.looseObject({
    t: z.literal('hook.run'),
    name: z.string(),
    on: z.enum(['pre', 'post', 'stop']),
    capabilityId: z.string().optional(),
    ms: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    blocked: z.boolean(),
    timedOut: z.boolean(),
    output: z.string().optional(),
  }),
  /** M7-004：改了文件还没验证，模型却要结束这一轮——运行时追加的提示。final = 到上限了，如实结束 */
  z.looseObject({
    t: z.literal('verify.required'),
    attempt: z.number().int().nonnegative(),
    message: z.string(),
    final: z.boolean().optional(),
  }),
  /** M7-005：计划模式 / 执行模式 */
  z.looseObject({ t: z.literal('mode.switch'), to: z.enum(['plan', 'act']), reason: z.string().optional() }),
  z.looseObject({
    t: z.literal('plan.proposed'),
    plan: z.string(),
    steps: z
      .array(z.object({ id: z.string(), goal: z.string(), dependsOn: z.array(z.string()).optional() }))
      .optional(),
  }),
  z.looseObject({
    t: z.literal('plan.decided'),
    approved: z.boolean(),
    comment: z.string().optional(),
    asTask: z.boolean().optional(),
    runId: z.string().optional(),
  }),
  /** M7-006：隔离会话的 git worktree */
  z.looseObject({
    t: z.literal('worktree.create'),
    repo: z.string(),
    path: z.string(),
    branch: z.string(),
    base: z.string(),
  }),
  z.looseObject({ t: z.literal('worktree.discard'), path: z.string(), trash: z.string() }),
  z.looseObject({ t: z.literal('worktree.restore'), path: z.string(), trash: z.string() }),
  z.looseObject({
    t: z.literal('worktree.apply'),
    mode: z.enum(['squash', 'merge', 'branch']),
    ok: z.boolean(),
    commit: z.string().optional(),
    message: z.string().optional(),
  }),
  /** M7-009：用量到了上限的 80%（每种各一次）与到顶后用户的决定 */
  z.looseObject({
    t: z.literal('budget.warn'),
    kind: z.enum(['tokens', 'costUsd', 'toolCalls']),
    used: z.number(),
    limit: z.number(),
  }),
  z.looseObject({
    t: z.literal('budget.decided'),
    action: z.enum(['continue', 'stop', 'raise']),
    kind: z.enum(['tokens', 'costUsd', 'toolCalls']),
    limit: z.number().optional(),
  }),
  /** M8-004：会话是自由会话还是任务；任务的工作目录与隔离决定（M8-006） */
  z.looseObject({
    t: z.literal('session.kind'),
    kind: z.enum(['chat', 'task']),
    cwd: z.string(),
    isolation: z.object({ isolate: z.boolean(), reason: z.string() }).optional(),
  }),
  /** M8-003：任务归到哪个项目；auto = 这次顺带自动登记的 */
  z.looseObject({ t: z.literal('project.assign'), projectId: z.string(), path: z.string(), auto: z.boolean() }),
  /** M8-007：定时任务触发（落在触发出来的任务会话里）；late = domid 没开、启动后补跑的 */
  z.looseObject({
    t: z.literal('schedule.fire'),
    scheduleId: z.string(),
    due: z.number().int(),
    late: z.boolean(),
  }),
  /** M7-010：审阅子 agent 的结构化发现 */
  z.looseObject({
    t: z.literal('review.findings'),
    findings: z.array(
      z.object({
        file: z.string(),
        line: z.number().int().positive().optional(),
        severity: z.enum(['high', 'medium', 'low']),
        problem: z.string(),
        basis: z.string(),
      }),
    ),
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
