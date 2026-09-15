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
import { EventEnvelopeSchema } from './event.ts'

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
})

const AskSchema = z.object({
  askId: z.string(),
  sessionId: z.string(),
  capabilityId: z.string(),
  detail: z.string(),
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
    summary: '列出会话（不含软删除的）',
    params: z.object({}),
    result: z.object({ sessions: z.array(SessionSummarySchema) }),
  },
  'session.create': {
    summary: '新建会话',
    params: z.object({ cwd: z.string().optional() }),
    result: z.object({ sessionId: z.string() }),
  },
  'session.submit': {
    summary: '提交一次用户输入。同一会话串行处理，正忙时返回 SESSION_BUSY 而不是静默丢弃',
    params: z.object({ sessionId: z.string(), text: z.string() }),
    result: z.object({ accepted: z.literal(true) }),
  },
  'session.subscribe': {
    summary: '订阅事件流。fromSeq 是**断点续订**的锚点：给上次收到的最后一个 seq，不重不漏',
    params: z.object({ sessionId: z.string(), fromSeq: z.number().int().nonnegative().default(0) }),
    result: z.object({ head: z.number().int().nonnegative() }),
  },
  'session.answer': {
    summary: '回答一次权限询问。askId 不存在（已被别的客户端答过）时返回 ok:false',
    params: z.object({ askId: z.string(), allowed: z.boolean() }),
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
