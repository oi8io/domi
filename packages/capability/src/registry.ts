/**
 * ToolRegistry —— 把 Tool 集合变成 kernel 的 `ToolRunner` 端口实现。
 *
 * 这里是三件事的汇合点，顺序不能乱：
 *   1. 参数校验（失败 → invalid_args，回灌给模型重试，不是抛异常打断会话）
 *   2. 权限检查（每次都产生一条事件，INV-03；拒绝 → user_denied）
 *   3. 才是执行
 *
 * 权限检查放在参数校验**之后**是有意的：参数都没解析出来，确认框没法告诉用户
 * 「要写什么内容 / 要执行哪条命令」（PRD-M0-003 AC-1）。
 */
import type { DomiEvent, ToolSchema } from '@domi/protocol'
import { z } from 'zod'
import type { PermissionEngine } from './permission.ts'
import type { Tool, ToolCtx } from './types.ts'

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
      inputSchema: z.toJSONSchema(t.schema as z.ZodType) as Record<string, unknown>,
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
    }

    if (decision.decision !== 'allow') {
      return {
        ok: false,
        reason: 'user_denied',
        events: [permissionEvent],
        // 给模型的是一句人话，不是异常——它需要知道"被拒了"并据此改计划
        payload: {
          message: `用户拒绝了 ${tool.capability}。不要重试同一个调用；换一种做法或询问用户。`,
          capability: tool.capability,
          source: decision.source,
        },
      }
    }

    const events: DomiEvent[] = [permissionEvent]
    const ctx: ToolCtx = {
      cwd: this.opts.cwd,
      signal,
      emit: (ev) => {
        events.push(ev)
      },
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
