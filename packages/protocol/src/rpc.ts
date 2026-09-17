/**
 * Domi Protocol —— PRD-M3-001 · 守 INV-01 / INV-04
 *
 * **这是 daemon 与三端之间唯一的契约。** 它一旦定死，加一个端就是纯前端工作，零内核改动
 * （`docs/DESIGN.md` §4 表里第 1 项）。所以这个文件的形状比它的代码量重要得多。
 *
 * 三条硬规则：
 *
 * 1. **zod 是唯一来源**（AC-1）。方法表里每个方法的 params 与 result 都是 zod schema，
 *    TypeScript 类型由它推导、JSON Schema 由它生成、文档由它生成。
 *    手写任何一份副本，就等于有了两个真相，而它们迟早会分叉。
 * 2. **版本不兼容就断开，不降级**（AC-2）。「兼容一下老客户端」听起来是体贴，
 *    实际是把两个版本的行为差异permanently搬进代码里，而且没人说得清哪些路径还在被谁用。
 *    宁可让人看见一条清楚的错误，也不要一个**看起来能用**的半残连接。
 * 3. **事件推送是通知（没有 id），不是响应**。订阅之后 daemon 主动推，
 *    客户端不轮询——轮询会把「断开期间发生了什么」这个问题变成不可解。
 */
import { z } from 'zod'
import { EventEnvelopeSchema, RefLinkSchema, SemanticItemSchema, SoulChangeSchema } from './event.ts'

/**
 * 协议版本。**只在不兼容变更时 +1。**
 * 加一个可选字段、加一个新方法都不算不兼容（老客户端不调它就是了）；
 * 改一个已有方法的参数含义、删一个方法才算。
 */
export const PROTOCOL_VERSION = 1

// ── 错误 ──────────────────────────────────────────────────────────────────

/**
 * 结构化错误码。**不用数字**（JSON-RPC 传统的 -32601 之类），用可读的字符串：
 * 错误码最终会出现在用户的终端里和 issue 里，`SESSION_BUSY` 比 -32001 省一次查表。
 */
export const ErrorCode = z.enum([
  'PROTOCOL_VERSION_MISMATCH',
  'UNKNOWN_METHOD',
  'INVALID_PARAMS',
  'SESSION_NOT_FOUND',
  'SESSION_BUSY',
  'NOT_HANDSHAKED',
  'INTERNAL',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const RpcErrorSchema = z.object({
  code: ErrorCode,
  message: z.string(),
  /** 结构化细节。版本不匹配时这里装双方版本号（AC-2 点名要求） */
  data: z.record(z.string(), z.unknown()).optional(),
})
export type RpcError = z.infer<typeof RpcErrorSchema>

// ── 方法表：唯一来源 ──────────────────────────────────────────────────────

const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  updatedAt: z.number().int(),
  eventCount: z.number().int().nonnegative(),
  /** 软删除的会话只在 includeDeleted 时出现，并标上这个 */
  deleted: z.boolean(),
  /** 分支会话：从哪个会话分出来的（TASK-M3-014） */
  parentId: z.string().optional(),
  /** 自由会话 / 任务（PRD-M8-004）。老 daemon 不给 */
  kind: z.enum(['chat', 'task']).optional(),
  /** 任务所属的项目（PRD-M8-003） */
  projectId: z.string().optional(),
  /** 工作目录 */
  cwd: z.string().optional(),
  /** 正在处理（PRD-M8-009） */
  busy: z.boolean().optional(),
})

/** 项目（PRD-M8-003） */
export const ProjectSettingsSchema = z.object({
  /** 任务要不要在隔离工作区里做（PRD-M8-006） */
  isolation: z.enum(['auto', 'always', 'never']).default('auto'),
  /** 计划要不要先给人审（PRD-M8-005） */
  planReview: z.enum(['auto', 'always', 'never']).default('auto'),
})
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 规范化后的绝对路径 */
  path: z.string(),
  createdAt: z.number().int(),
  archived: z.boolean(),
  taskCount: z.number().int().nonnegative(),
  lastActivity: z.number().int().nullable(),
  settings: ProjectSettingsSchema,
  /** 最近的几个任务（侧栏项目树用，免得逐个项目再查） */
  recentTasks: z.array(z.object({ id: z.string(), title: z.string(), busy: z.boolean(), updatedAt: z.number().int() })),
})

/** L3 条目（带时间与删除状态） */
const MemoryItemSchema = SemanticItemSchema.extend({
  createdAt: z.number().int(),
  deleted: z.boolean(),
  score: z.number().optional(),
})

const PendingChangeSchema = SoulChangeSchema.extend({ at: z.number().int(), diff: z.string() })

const RunStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled'])
const RunSummarySchema = z.object({
  runId: z.string(),
  name: z.string(),
  status: RunStatusSchema,
  updatedAt: z.number().int(),
})
const RunDetailSchema = z.object({
  runId: z.string(),
  name: z.string(),
  status: RunStatusSchema,
  /** 进程里是不是真的在跑（status 是 running 但 daemon 没在跑它 = 等待恢复） */
  active: z.boolean(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string().optional(),
      needs: z.array(z.string()),
      status: z.enum(['pending', 'running', 'done', 'failed', 'blocked']),
      attempt: z.number().int(),
      output: z.string().optional(),
      error: z.string().optional(),
      sessionId: z.string().optional(),
      ms: z.number().int().optional(),
    }),
  ),
})

/** 状态栏指标。**由 runtime 算好推过来**，客户端不自己算（PRD-M1-007 AC-3） */
const MetricsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
  }),
  /** 已格式化；未知模型是 `—`，不是 $0（PRD-M1-007 AC-4） */
  cost: z.string(),
  contextPercent: z.number(),
  contextLevel: z.enum(['ok', 'warn', 'danger']),
  unpricedModels: z.array(z.string()),
  /** 最近一轮用了多久（毫秒）；进行中的一轮算到推送那一刻（PRD-M1-007 AC-1） */
  turnMs: z.number().int().nonnegative().optional(),
  /** 本轮的验证状态（PRD-M7-004 AC-3）：clean 没改文件 / unverified 改了没验 / verified / failed */
  verify: z.enum(['clean', 'unverified', 'verified', 'failed']).optional(),
  /** 计划模式 / 执行模式（PRD-M7-005） */
  mode: z.enum(['plan', 'act']).optional(),
  /** PRD-M8-008 AC-2：轮数、模型请求次数、最近一轮输出速度、缓存命中率（老 daemon 不推） */
  turns: z.number().int().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional(),
  tokPerSec: z.number().nonnegative().nullable().optional(),
  cacheHitPercent: z.number().min(0).max(100).nullable().optional(),
})

const AskSchema = z.object({
  askId: z.string(),
  sessionId: z.string(),
  capabilityId: z.string(),
  detail: z.string(),
  /** 工具要输入时带上（TASK-M3-016）：客户端按 schema 画表单，回答时把内容放进 session.answer 的 content */
  form: z.object({ message: z.string(), schema: z.unknown() }).optional(),
  /** 可以答「本会话始终允许」（PRD-M8-016）。命令、MCP、插件工具没有这个选项 */
  grantable: z.boolean().optional(),
})

/**
 * 方法表。加方法就在这里加一行——客户端类型、服务端类型、JSON Schema、文档全都跟着走。
 */
export const METHODS = {
  /** 握手。**必须是第一个调用**，没握手的其它请求一律 NOT_HANDSHAKED */
  handshake: {
    summary: '版本协商。不兼容时返回 PROTOCOL_VERSION_MISMATCH，不进入任何降级路径',
    params: z.object({
      protocolVersion: z.number().int().positive(),
      /** 客户端自报家门，只用于日志与轨迹，不参与协商 */
      client: z.string(),
    }),
    result: z.object({
      protocolVersion: z.number().int().positive(),
      serverVersion: z.string(),
      /** 服务端支持的方法名，客户端可据此禁用未实现的 UI */
      methods: z.array(z.string()),
    }),
  },
  'session.list': {
    summary: '列出会话。默认不含软删除的；includeDeleted 给回收站用；kind / projectId 过滤（PRD-M8-004）',
    params: z.object({
      includeDeleted: z.boolean().optional(),
      kind: z.enum(['chat', 'task']).optional(),
      projectId: z.string().optional(),
    }),
    result: z.object({ sessions: z.array(SessionSummarySchema) }),
  },
  'session.delete': {
    summary: '软删除会话：事件一条不删，只是不再出现在默认列表里（INV-01）。正在处理的会话不许删',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'session.restore': {
    summary: '恢复软删除的会话',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'session.branch': {
    summary:
      '从会话的第 atSeq 条（订阅里看到的 seq）分出一个新会话（PRD-M1-006 AC-3）。' +
      '新会话带着到这一条为止的历史，之后两边各走各的，事件一条不复制；越界 → INVALID_PARAMS',
    params: z.object({ sessionId: z.string(), atSeq: z.number().int().min(1) }),
    result: z.object({ sessionId: z.string() }),
  },
  'memory.list': {
    summary: '列出 L3 语义记忆（PRD-M4-001）。includeDeleted 给「看看删过什么」用',
    params: z.object({ includeDeleted: z.boolean().optional() }),
    result: z.object({ items: z.array(MemoryItemSchema) }),
  },
  'memory.search': {
    summary: '检索 L3：关键词，配了 embedding 时再加语义。mode 说明实际用了哪种',
    params: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }),
    result: z.object({ mode: z.enum(['keyword', 'semantic+keyword']), items: z.array(MemoryItemSchema) }),
  },
  'memory.delete': {
    summary: '删除一条 L3（追加删除事件，之后检索不到）。不存在或已删 → ok:false',
    params: z.object({ id: z.string() }),
    result: z.object({ ok: z.boolean() }),
  },
  'memory.extract': {
    summary: '立刻从某个会话抽取 L3（不等攒够轮数），有新条目时顺带更新 Soul',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ added: z.array(SemanticItemSchema), soulChanges: z.array(SoulChangeSchema) }),
  },
  'soul.get': {
    summary: 'Soul 的全文（Markdown）与它在 daemon 机器上的路径（PRD-M4-002）',
    params: z.object({}),
    result: z.object({ path: z.string(), text: z.string() }),
  },
  'soul.changes': {
    summary: '上次审阅以来 Soul 的改动（PRD-M4-003 AC-2）',
    params: z.object({}),
    result: z.object({ changes: z.array(PendingChangeSchema) }),
  },
  'soul.review': {
    summary: '接受或否决一处改动。否决会撤回文件里的那一处并记进 .rejected，之后不再提议（AC-3）',
    params: z.object({ changeId: z.string(), decision: z.enum(['accept', 'reject']) }),
    result: z.object({ ok: z.boolean(), detail: z.string() }),
  },
  'soul.update': {
    summary: '用现有的全部 L3 条目重新过一遍 Soul（一次最多改 10 处）',
    params: z.object({}),
    result: z.object({ changes: z.array(SoulChangeSchema) }),
  },
  'task.start': {
    summary:
      '开始一次 DAG 运行（PRD-M5-002）。spec 是 YAML 原文；不合法（含环）→ INVALID_PARAMS，什么都不落。' +
      '返回的 runId 就是运行会话的 id，订阅它就能看到 task.* 事件',
    params: z.object({ spec: z.string().min(1), cwd: z.string().optional() }),
    result: z.object({ runId: z.string(), name: z.string(), nodes: z.array(z.string()) }),
  },
  'task.list': {
    summary: '列出运行（最近的在前）',
    params: z.object({}),
    result: z.object({ runs: z.array(RunSummarySchema) }),
  },
  'task.get': {
    summary: '一次运行的各节点状态（事件的投影，PRD-M5-002 AC-3）',
    params: z.object({ runId: z.string() }),
    result: RunDetailSchema,
  },
  'task.retry': {
    summary: '只重跑一个失败节点及其被挡住的下游，已完成的不动（AC-4）。运行还在跑或节点不是失败 → INVALID_PARAMS',
    params: z.object({ runId: z.string(), nodeId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'task.cancel': {
    summary: '取消一次还在跑的运行。已经结束的返回 ok:false',
    params: z.object({ runId: z.string() }),
    result: z.object({ ok: z.boolean() }),
  },
  'plugin.list': {
    summary: '已安装的插件、它们提供的东西、没加载上的原因，以及这台机器的沙箱（PRD-M6-001 / 003）',
    params: z.object({}),
    result: z.object({
      sandbox: z.enum(['bwrap', 'sandbox-exec', 'none']),
      plugins: z.array(
        z.object({
          name: z.string(),
          version: z.string(),
          description: z.string(),
          tools: z.array(z.string()),
          skills: z.number().int(),
          mcp: z.array(z.string()),
          ui: z.array(z.object({ id: z.string(), title: z.string() })),
        }),
      ),
      problems: z.array(z.object({ name: z.string(), message: z.string() })),
    }),
  },
  'plugin.ui': {
    summary: '插件 UI 面板的 HTML。客户端必须放进无同源的沙箱 iframe（sandbox="allow-scripts"）里渲染',
    params: z.object({ plugin: z.string(), id: z.string() }),
    result: z.object({ html: z.string() }),
  },
  'audit.record': {
    summary: '端上发生、daemon 看不到的安全相关事情（比如桥接收到未绑定 chat 的消息），记进审计会话（M5-007 AC-4）',
    params: z.object({
      kind: z
        .string()
        .regex(/^[a-z0-9_.-]+$/)
        .max(60),
      detail: z.string().max(500),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  'session.switchModel': {
    summary: '会话中途切换模型（PRD-M1-002）。只追加一条 model.switch，历史不动；返回会失去的能力',
    params: z.object({ sessionId: z.string(), model: z.string().min(1), provider: z.string().min(1).optional() }),
    result: z.object({ lost: z.array(z.string()) }),
  },
  'review.start': {
    summary:
      '派一个只读的审阅会话（PRD-M7-010）：输入是相对 base 的 diff 与需求文档，不带任何会话历史。立刻返回会话 id，发现以 review.findings 事件出现',
    params: z.object({
      cwd: z.string().optional(),
      base: z.string().optional(),
      specs: z.array(z.string()).optional(),
      /** 从哪个会话发起：审阅会话挂在它的轨迹下；没给 cwd 时用它的目录 */
      fromSessionId: z.string().optional(),
    }),
    result: z.object({ sessionId: z.string() }),
  },
  'session.rename': {
    summary: '改会话标题（PRD-M8-008 AC-4）。只改列表里的元数据，不进事件流',
    params: z.object({ sessionId: z.string(), title: z.string().min(1).max(200) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'session.toTask': {
    summary:
      '自由会话转任务（PRD-M8-004 AC-4）：在项目下新建任务，首条输入是 goal 并引用原会话全文；原会话一条事件不动。返回新任务的会话 id',
    params: z.object({ sessionId: z.string(), projectId: z.string(), goal: z.string().min(1) }),
    result: z.object({ sessionId: z.string() }),
  },
  'project.list': {
    summary: '列出项目（PRD-M8-003），按最近活动排序。recent：每个项目带几个最近任务（默认 5）',
    params: z.object({
      includeArchived: z.boolean().optional(),
      recent: z.number().int().min(0).max(50).optional(),
    }),
    result: z.object({ projects: z.array(ProjectSchema) }),
  },
  'project.create': {
    summary: '登记项目。path 必须是已存在的目录（同一目录只登记一次，重复登记返回已有的）；name 缺省取目录名',
    params: z.object({ path: z.string().min(1), name: z.string().min(1).max(100).optional() }),
    result: z.object({ project: ProjectSchema }),
  },
  'project.update': {
    summary: '改项目名或设置',
    params: z.object({
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      settings: ProjectSettingsSchema.partial().optional(),
    }),
    result: z.object({ project: ProjectSchema }),
  },
  'project.archive': {
    summary: '归档 / 取消归档。归档的项目不出现在默认列表里，它的任务仍在',
    params: z.object({ id: z.string(), archived: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'project.resolve': {
    summary:
      '这个目录属于哪个项目（PRD-M8-017）。只判断不登记：projectLike = 是 git 仓库或有 AGENT.md，root = 按这个目录建项目时会用的路径',
    params: z.object({ cwd: z.string() }),
    result: z.object({
      project: ProjectSchema.optional(),
      projectLike: z.boolean(),
      root: z.string(),
    }),
  },
  'config.get': {
    summary:
      '设置页要显示的配置（PRD-M8-011 AC-1）：白名单里各键的当前值，各家 key 只给掩码与来源（env / secrets / config），绝不回原文',
    params: z.object({}),
    result: z.object({
      values: z.record(z.string(), z.unknown()),
      secrets: z.record(
        z.string(),
        z.object({
          set: z.boolean(),
          masked: z.string().optional(),
          source: z.enum(['env', 'secrets', 'config']).optional(),
        }),
      ),
      paths: z.object({ config: z.string(), secrets: z.string() }),
      secretsTooOpen: z.boolean(),
      writable: z.array(z.string()),
    }),
  },
  'config.set': {
    summary:
      '改配置（PRD-M8-011 AC-2 / AC-3）。patch 的键是 config.get 的 writable 里的点分路径，值为 null 表示删掉；' +
      '有一个键不在白名单就整体拒绝（INVALID_PARAMS），文件不动。key 写进 secrets.yaml。改完下一轮生效；restartRequired 列出要重启 domid 才生效的键',
    params: z.object({ patch: z.record(z.string(), z.unknown()) }),
    result: z.object({ ok: z.literal(true), restartRequired: z.array(z.string()) }),
  },
  'session.budget': {
    summary: '设这个会话的用量上限（PRD-M7-009）：到 80% 提醒，到顶暂停问人。落成 budget.decided，重开会话后照样生效',
    params: z.object({
      sessionId: z.string(),
      budget: z
        .object({
          tokens: z.number().int().positive().optional(),
          costUsd: z.number().positive().optional(),
          toolCalls: z.number().int().positive().optional(),
        })
        .strict(),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  'session.mode': {
    summary: '切换计划模式 / 执行模式（PRD-M7-005）。只追加一条 mode.switch；和当前一样时什么都不写',
    params: z.object({ sessionId: z.string(), mode: z.enum(['plan', 'act']) }),
    result: z.object({ mode: z.enum(['plan', 'act']), changed: z.boolean() }),
  },
  'session.create': {
    summary:
      '新建会话。isolate：在 cwd 所在的 git 仓库里建隔离工作区（PRD-M7-006），会话在 worktree 里干活。' +
      'kind（PRD-M8-004）：chat = 不属于任何项目，工作目录是 ~/.domi/scratch/<会话>；task = 属于 projectId 或 cwd 所在的项目（没登记就自动登记）。' +
      '不给 kind 时：给了 projectId、或 cwd 在已登记项目里 / 是 git 仓库 / 有 AGENT.md，就是 task；否则是 chat（PRD-M8-017 AC-1）',
    params: z.object({
      cwd: z.string().optional(),
      isolate: z.boolean().optional(),
      kind: z.enum(['chat', 'task']).optional(),
      projectId: z.string().optional(),
    }),
    result: z.object({
      sessionId: z.string(),
      worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
    }),
  },
  'worktree.diff': {
    summary: '隔离会话相对起点的改动，按文件（含未跟踪文件）。不是隔离会话 → INVALID_PARAMS',
    params: z.object({ sessionId: z.string() }),
    result: z.object({
      repo: z.string(),
      branch: z.string(),
      base: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          status: z.enum(['added', 'modified', 'deleted', 'renamed']),
          patch: z.string(),
          truncated: z.boolean().optional(),
        }),
      ),
    }),
  },
  'worktree.discard': {
    summary: '丢弃一个文件的改动（恢复成起点）。内容先进回收站，返回编号，可以用 worktree.restore 撤销',
    params: z.object({ sessionId: z.string(), path: z.string().min(1) }),
    result: z.object({ trash: z.string() }),
  },
  'worktree.restore': {
    summary: '撤销一次丢弃',
    params: z.object({ sessionId: z.string(), trash: z.string() }),
    result: z.object({ path: z.string() }),
  },
  'worktree.apply': {
    summary:
      '把改动带回原仓库：squash（默认，压成一个提交）/ merge / branch（只留分支）。会先问人（worktree.apply 询问），没批准原仓库一个字节不动',
    params: z.object({
      sessionId: z.string(),
      mode: z.enum(['squash', 'merge', 'branch']).optional(),
      message: z.string().min(1).optional(),
    }),
    result: z.object({ ok: z.boolean(), commit: z.string().optional(), message: z.string() }),
  },
  'session.submit': {
    summary:
      '提交一次用户输入。同一会话串行处理，正忙时返回 SESSION_BUSY 而不是静默丢弃。' +
      'refs 引用其他会话的片段（PRD-M3-005）：接受之前校验，会话不存在或起点越界 → INVALID_PARAMS；终点超出时截到末尾',
    params: z.object({ sessionId: z.string(), text: z.string(), refs: z.array(RefLinkSchema).max(20).optional() }),
    result: z.object({ accepted: z.literal(true) }),
  },
  'session.subscribe': {
    summary:
      '订阅事件流。fromSeq 是**断点续订**的锚点：给上次收到的最后一个 seq，不重不漏。' +
      '分支会话的 seq 是**视图编号**：父链到分叉点的那一段排在前面、从 1 连续编下来，自己的事件接在后面',
    params: z.object({ sessionId: z.string(), fromSeq: z.number().int().nonnegative().default(0) }),
    result: z.object({ head: z.number().int().nonnegative() }),
  },
  'session.answer': {
    summary: '回答一次权限询问。askId 不存在（已被别的客户端答过）时返回 ok:false',
    params: z.object({
      askId: z.string(),
      allowed: z.boolean(),
      /** 表单型询问的填写内容；权限确认不用带 */
      content: z.record(z.string(), z.unknown()).optional(),
      /** 在哪个端上答的（M5-007）。不给就用握手时的客户端名 */
      channel: z.string().max(40).optional(),
      /** 本会话内始终允许（PRD-M8-016）。只在 allowed 且询问 grantable 时生效 */
      grant: z.boolean().optional(),
    }),
    result: z.object({ ok: z.boolean() }),
  },
  'session.compact': {
    summary: '手动触发上下文压缩（PRD-M2-003 AC-1 的 /compact）',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.boolean(), detail: z.string() }),
  },
} as const

export type MethodName = keyof typeof METHODS
export const METHOD_NAMES = Object.keys(METHODS) as MethodName[]

export type ParamsOf<M extends MethodName> = z.infer<(typeof METHODS)[M]['params']>
export type ResultOf<M extends MethodName> = z.infer<(typeof METHODS)[M]['result']>

// ── 通知：daemon 主动推给客户端的东西 ────────────────────────────────────

export const NOTIFICATIONS = {
  /** 订阅之后的事件推送。一次可以推一批，seq 连续 */
  'session.events': {
    summary: '事件流增量推送',
    params: z.object({ sessionId: z.string(), events: z.array(EventEnvelopeSchema) }),
  },
  /** 需要用户确认。客户端渲染确认框，然后调 session.answer */
  'session.ask': {
    summary: '权限询问',
    params: AskSchema,
  },
  /**
   * 一次询问已经有了答案（不管是哪个客户端答的）。
   * 同一会话可能开着好几个客户端，其余的据此关掉自己的确认框
   */
  'session.askDone': {
    summary: '权限询问已被回答',
    params: z.object({ sessionId: z.string(), askId: z.string(), allowed: z.boolean() }),
  },
  /** 状态栏指标。订阅时补发最近一份，之后每次变化推一次 */
  'session.metrics': {
    summary: '状态栏指标（模型、token、花费、工具次数、上下文占用）',
    params: z.object({ sessionId: z.string(), metrics: MetricsSchema }),
  },
  /** 忙闲状态，给状态栏用 */
  'session.busy': {
    summary: '会话忙闲变化',
    params: z.object({ sessionId: z.string(), busy: z.boolean() }),
  },
} as const

export type NotificationName = keyof typeof NOTIFICATIONS
export const NOTIFICATION_NAMES = Object.keys(NOTIFICATIONS) as NotificationName[]
export type NotifyParamsOf<N extends NotificationName> = z.infer<(typeof NOTIFICATIONS)[N]['params']>

// ── 线上格式（JSON-RPC 2.0 的子集） ──────────────────────────────────────

export const RequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
})
export type RpcRequest = z.infer<typeof RequestSchema>

export const ResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: RpcErrorSchema.optional(),
})
export type RpcResponse = z.infer<typeof ResponseSchema>

export const NotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown(),
})
export type RpcNotification = z.infer<typeof NotificationSchema>

export const MessageSchema = z.union([ResponseSchema, NotificationSchema, RequestSchema])

export function isRequest(m: unknown): m is RpcRequest {
  return RequestSchema.safeParse(m).success
}
export function isNotification(m: unknown): m is RpcNotification {
  return !isRequest(m) && NotificationSchema.safeParse(m).success
}
export function isResponse(m: unknown): m is RpcResponse {
  return ResponseSchema.safeParse(m).success
}

export function ok(id: string | number, result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, result }
}
export function fail(
  id: string | number,
  code: ErrorCode,
  message: string,
  data?: Record<string, unknown>,
): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}
export function notify(method: NotificationName, params: unknown): RpcNotification {
  return { jsonrpc: '2.0', method, params }
}

/**
 * 版本协商的**唯一**判据。故意做成纯函数：
 * 「什么算兼容」这个判断必须只有一处，否则服务端和客户端会各自理解一遍。
 */
export function versionMismatch(clientVersion: number, serverVersion = PROTOCOL_VERSION): RpcError | null {
  if (clientVersion === serverVersion) return null
  return {
    code: 'PROTOCOL_VERSION_MISMATCH',
    message:
      `协议版本不匹配：客户端 v${clientVersion}，服务端 v${serverVersion}。\n` +
      '不做降级兼容——升级其中一端。（PRD-M3-001 AC-2）',
    data: { clientVersion, serverVersion },
  }
}
