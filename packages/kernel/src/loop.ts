/**
 * Agent loop —— PRD-M0-002 · SPEC-M0-007
 *
 * 形状：buildContext → provider.generate → 事件落盘 → tool 执行 → 回灌 → 再来一轮。
 *
 * 三个终止条件是**独立计数器**，任一触发即停并产出 `error{recoverable:true}`，
 * 且终止事件必须带上三个计数器的当时值——否则轨迹里只能看到"它停了"，
 * 看不到"为什么停"，排查时等于没记。
 *
 * 计数器本身**不进事件流**：它们是投影，能从事件流算出来。
 * 进事件流的只有终止那一刻的快照。
 */
import type { DomiEvent, EventEnvelope, RefLink } from '@domi/protocol'
import { buildContext, type ContextPolicy } from './build-context.ts'
import type { Clock, EventSink, ToolCallRequest, ToolRunner } from './ports.ts'
import { type PromptParts, withPrompt } from './preamble.ts'
import { notRunResult } from './recovery.ts'
import { type RefResolver, refKey } from './refs.ts'

export interface LoopLimits {
  /** 单轮工具调用次数上限（PRD-M0-002 AC-2） */
  maxToolCalls: number
  /** 同一轮里参数解析失败的重试上限；第 N+1 次终止（AC-3） */
  maxArgParseRetries: number
  /** 单轮墙钟上限。M0 新增的护栏，防止 spike 期挂死 */
  maxWallClockMs: number
}

export const DEFAULT_LIMITS: LoopLimits = {
  maxToolCalls: 20,
  maxArgParseRetries: 3,
  maxWallClockMs: 10 * 60_000,
}

export interface ModelEventLike {
  type: string
  [k: string]: unknown
}

export interface ProviderLike {
  readonly id: string
  generate(
    req: { model: string; messages: ReturnType<typeof buildContext>; tools?: unknown; providerOptions?: unknown },
    signal: AbortSignal,
  ): AsyncIterable<ModelEventLike>
}

export interface LoopDeps {
  sink: EventSink
  provider: ProviderLike
  tools: ToolRunner
  clock: Clock
  policy: ContextPolicy
  model: string
  limits?: Partial<LoopLimits>
  providerOptions?: Record<string, unknown>
  /** 跨会话引用的读取端口（PRD-M3-005）。事件流里有 ctx.ref 时用它把内容读出来 */
  refs?: RefResolver
  /** 拼好的提示词（BUG-M3-015）。不给就只发对话本身（回放与大部分单测走这条） */
  prompt?: PromptParts
}

/** 一次用户输入。refs 是这句话引用的其他会话片段 */
export interface TurnInput {
  text: string
  refs?: readonly RefLink[]
}

export type StopReason = 'completed' | 'max_tool_calls' | 'max_arg_parse_retries' | 'wall_clock' | 'stream_error'

export interface TurnResult {
  stopReason: StopReason
  counters: { toolCalls: number; argParseRetries: number; elapsedMs: number }
}

export async function runTurn(
  deps: LoopDeps,
  sessionId: string,
  input: string | TurnInput,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const { text: userText, refs = [] } = typeof input === 'string' ? { text: input } : input
  if (refs.length > 0 && !deps.refs) {
    throw new Error('这一轮带了跨会话引用，但 LoopDeps 没有 refs 端口，读不出引用的内容')
  }
  const limits = { ...DEFAULT_LIMITS, ...deps.limits }
  const ac = new AbortController()
  signal?.addEventListener('abort', () => ac.abort(), { once: true })

  const startedAt = deps.clock.now()
  let toolCalls = 0
  let argParseRetries = 0

  const counters = (): TurnResult['counters'] => ({
    toolCalls,
    argParseRetries,
    elapsedMs: deps.clock.now() - startedAt,
  })

  const stop = async (
    reason: Exclude<StopReason, 'completed'>,
    message: string,
    skipped: readonly ToolCallRequest[] = [],
  ): Promise<TurnResult> => {
    const c = counters()
    // 停下时还没跑的调用也要配上结果：悬空的 tool_use 会让下一轮请求被 provider 拒掉（BUG-M3-014）
    await deps.sink.append(sessionId, [
      ...skipped.map((call) => notRunResult(call.id, `本轮已停止（${reason}）`)),
      { t: 'error', scope: 'loop', message, recoverable: true, counters: c },
    ])
    ac.abort()
    return { stopReason: reason, counters: c }
  }

  // 引用紧挨在它所属的那句话前面，同一批落盘：轨迹里看得见是哪句话引用了什么（AC-3）
  await deps.sink.append(sessionId, [
    ...refs.map((r) => ({ t: 'ctx.ref' as const, sessionId: r.sessionId, fromSeq: r.fromSeq, toSeq: r.toSeq })),
    { t: 'user.input', text: userText },
  ])
  /** 同一轮里多次拼上下文，引用内容只读一次（它不会变：事件只增不改） */
  const resolved = new Map<string, readonly EventEnvelope[]>()

  for (;;) {
    if (deps.clock.now() - startedAt >= limits.maxWallClockMs) {
      return stop('wall_clock', `单轮墙钟超过 ${limits.maxWallClockMs}ms，已终止。`)
    }

    const events = await deps.sink.read(sessionId)
    if (deps.refs) {
      for (const { ev } of events) {
        if (ev.t !== 'ctx.ref') continue
        const { sessionId: from, fromSeq, toSeq } = ev as unknown as RefLink
        const link: RefLink = { sessionId: from, fromSeq, toSeq }
        const key = refKey(link)
        if (resolved.has(key)) continue
        // 读不到（会话被清除了）不让这一轮失败：buildContext 会在那个位置放一句说明
        const got = await deps.refs.resolve(link).catch(() => undefined)
        if (got !== undefined) resolved.set(key, got)
      }
    }
    const history = buildContext(events, resolved.size > 0 ? { ...deps.policy, refs: resolved } : deps.policy)
    const messages = deps.prompt ? withPrompt(history, deps.prompt) : history

    const pending: ToolCallRequest[] = []
    const produced: DomiEvent[] = []
    produced.push({ t: 'model.request', provider: deps.provider.id, model: deps.model, tokensIn: messages.length })

    let streamError: { message: string; recoverable: boolean } | null = null
    try {
      for await (const ev of deps.provider.generate(
        { model: deps.model, messages, tools: deps.tools.schemas(), providerOptions: deps.providerOptions },
        ac.signal,
      )) {
        switch (ev.type) {
          case 'delta':
            produced.push({ t: 'model.delta', text: String(ev.text) })
            break
          case 'reason':
            produced.push({ t: 'model.reason', text: String(ev.text) })
            break
          case 'usage':
            produced.push({ t: 'model.usage', raw: (ev.raw ?? {}) as Record<string, unknown> })
            break
          case 'tool-call': {
            const call = { id: String(ev.id), name: String(ev.name), args: ev.args }
            pending.push(call)
            produced.push({ t: 'tool.call', ...call })
            break
          }
          case 'error':
            streamError = { message: String(ev.message), recoverable: Boolean(ev.recoverable) }
            break
          default:
            break
        }
      }
    } catch (e) {
      // provider 约定用 error 事件报错，但出流之前的检查（能力不满足、参数非法）是直接抛的。
      // 穿出去的话，事件流里只剩一条 user.input，用户什么都看不到。
      // recoverable：会话本身没坏，改完配置可以接着用
      streamError = { message: e instanceof Error ? e.message : String(e), recoverable: true }
    }

    await deps.sink.append(sessionId, produced)

    if (streamError) {
      // 流中途截断：会话事件流仍然完整，用户可以继续输入（PRD-M0-002 AC-4）
      return stop('stream_error', `模型流中断：${streamError.message}`, pending)
    }

    if (pending.length === 0) return { stopReason: 'completed', counters: counters() }

    for (const [i, call] of pending.entries()) {
      if (toolCalls >= limits.maxToolCalls) {
        return stop('max_tool_calls', `单轮工具调用达到上限 ${limits.maxToolCalls} 次，已终止。`, pending.slice(i))
      }
      toolCalls++

      const t0 = deps.clock.now()
      let outcome: Awaited<ReturnType<ToolRunner['run']>>
      try {
        outcome = await deps.tools.run(call, ac.signal)
      } catch (e) {
        outcome = { ok: false, payload: { error: String(e) }, reason: 'tool_threw' }
      }
      const ms = deps.clock.now() - t0

      const result: DomiEvent = outcome.reason
        ? { t: 'tool.result', id: call.id, ok: outcome.ok, payload: outcome.payload, ms, reason: outcome.reason }
        : { t: 'tool.result', id: call.id, ok: outcome.ok, payload: outcome.payload, ms }
      // 工具产生的事件排在 tool.result 之前：权限决策与文件指纹都发生在结果之前，
      // 轨迹按 seq 读下来必须还原成真实的因果顺序
      await deps.sink.append(sessionId, [...(outcome.events ?? []), result])

      if (outcome.reason === 'invalid_args') {
        argParseRetries++
        if (argParseRetries > limits.maxArgParseRetries) {
          return stop(
            'max_arg_parse_retries',
            `参数解析连续失败超过 ${limits.maxArgParseRetries} 次，已终止。`,
            pending.slice(i + 1),
          )
        }
      } else {
        // 成功一次就清零：连续失败才是信号，累计失败不是
        argParseRetries = 0
      }
    }
  }
}
