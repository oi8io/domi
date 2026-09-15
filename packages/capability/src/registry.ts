/**
 * ToolRegistry —— 把 Tool 集合变成 kernel 的 `ToolRunner` 端口实现。
 *
 * 这里是三件事的汇合点，顺序不能乱：
 *   1. 参数校验（失败 → invalid_args，回灌给模型重试，不是抛异常打断会话）
 *   2. 权限检查（每次都产生一条事件，INV-03；用户拒绝 → user_denied，规则/默认拒绝 → permission_denied）
 *   3. 才是执行
 *
 * 权限检查放在参数校验**之后**是有意的：参数都没解析出来，确认框没法告诉用户
 * 「要写什么内容 / 要执行哪条命令」（PRD-M0-003 AC-1）。
 */
import type { DomiEvent, ToolSchema } from '@domi/protocol'
import { z } from 'zod'
import type { PermissionEngine } from './permission.ts'
import type { ElicitRequest, ElicitResponse, Tool, ToolCtx } from './types.ts'

export interface ToolCallRequest {
  id: string
  name: string
  args: unknown
}

export interface ToolOutcome {
  ok: boolean
  payload: unknown
  reason?: string
  /** 工具执行过程中产生的事件，由 loop 统一落盘 */
  events?: DomiEvent[]
}

export interface ToolRegistryOptions {
  cwd: string
  permissions: PermissionEngine
  /** 工具向用户要输入时走这里；带上是哪个工具在问，确认框才能说清楚 */
  elicit?: (tool: { name: string; capability: string }, req: ElicitRequest) => Promise<ElicitResponse>
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<never, unknown>>()

  constructor(private readonly opts: ToolRegistryOptions) {}

  /** INV-05：注册的必须是 Tool —— 没有 capability 字段的对象类型上就过不去 */
  register<A, R>(tool: Tool<A, R>): this {
    this.tools.set(tool.name, tool as unknown as Tool<never, unknown>)
    return this
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      // JSON Schema 由 zod 生成，不手写——手写的那份一定会和校验用的那份漂移
      inputSchema: t.inputJsonSchema ?? (z.toJSONSchema(t.schema as z.ZodType) as Record<string, unknown>),
    }))
  }

  async run(call: ToolCallRequest, signal: AbortSignal): Promise<ToolOutcome> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      return {
        ok: false,
        reason: 'unknown_tool',
        payload: { message: `没有名为 ${call.name} 的工具`, available: [...this.tools.keys()] },
      }
    }

    const parsed = (tool.schema as z.ZodType).safeParse(call.args)
    if (!parsed.success) {
      return {
        ok: false,
        reason: 'invalid_args',
        payload: {
          message: `${call.name} 的参数不合法`,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      }
    }

    const decision = await this.opts.permissions.check(tool.capability, parsed.data)
    const permissionEvent: DomiEvent = {
      t: 'permission',
      capabilityId: tool.capability,
      decision: decision.decision,
      source: decision.source,
      matchedRule: decision.matchedRule,
      ...(decision.channel === undefined ? {} : { channel: decision.channel }),
    }

    if (decision.decision !== 'allow') {
      const byUser = decision.source === 'user'
      return {
        ok: false,
        // PRD-M0-003 AC-2 的 user_denied 只给**用户当场拒绝**。规则拒绝、默认拒绝另起一个名字——
        // 说成「用户拒绝了」，用户会以为自己误操作，模型会以为用户不想让它做（BUG-M3-013）
        reason: byUser ? 'user_denied' : 'permission_denied',
        events: [permissionEvent],
        // 给模型的是一句人话，不是异常——它需要知道"被拒了"、被谁拒的，并据此改计划
        payload: {
          message: denialMessage(tool.capability, decision.source, decision.matchedRule),
          capability: tool.capability,
          source: decision.source,
          ...(decision.matchedRule === null ? {} : { rule: decision.matchedRule }),
        },
      }
    }

    const events: DomiEvent[] = [permissionEvent]
    const elicit = this.opts.elicit
    const ctx: ToolCtx = {
      cwd: this.opts.cwd,
      signal,
      emit: (ev) => {
        events.push(ev)
      },
      ...(elicit
        ? { elicit: (req: ElicitRequest) => elicit({ name: tool.name, capability: tool.capability }, req) }
        : {}),
    }

    try {
      const payload = await (tool as Tool<unknown, unknown>).execute(parsed.data, ctx)
      return { ok: true, payload, events }
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.name : 'tool_threw',
        events,
        payload: { message: e instanceof Error ? e.message : String(e) },
      }
    }
  }
}

/** 拒绝说明：说清楚是谁拒的、要不要找用户。四种情况都让模型别原样重试 */
export function denialMessage(capability: string, source: string, rule: string | null): string {
  const noRetry = '不要重试同一个调用'
  if (source === 'user') return `用户拒绝了 ${capability}。${noRetry}；换一种做法或询问用户。`
  if (source === 'config') {
    return `${capability} 被权限规则 "${rule}" 禁止（不是用户当场拒绝的）。${noRetry}；不用这个能力完成任务，或说明需要它的原因。`
  }
  if (rule === 'parent-scope') {
    return `${capability} 不在派你来的任务给你的能力范围里（子 agent 的权限只能比父会话小）。${noRetry}；用范围内的能力完成，或在结论里说明还需要它。`
  }
  if (rule !== null) {
    return `${capability} 需要用户确认（规则 "${rule}"），但现在没有人可以确认，按拒绝处理。${noRetry}；稍后在交互界面里再试。`
  }
  return (
    `${capability} 没有被任何权限规则允许，按默认拒绝处理（不是用户当场拒绝的）。${noRetry}。` +
    `如果确实需要，告诉用户在 ~/.domi/config.yaml 的 permissions.rules 里加一条 capability: ${capability}（decision: allow 或 ask）。`
  )
}
