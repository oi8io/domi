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
import { FileStamps } from './tools/stamps.ts'
import type { ElicitRequest, ElicitResponse, JobStarter, Tool, ToolCtx } from './types.ts'

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

/** 一次调用的描述（给钩子与预算闸门看） */
export interface ToolCallInfo {
  id: string
  name: string
  capability: string
  args: unknown
}

/**
 * 钩子端口（PRD-M7-003）。pre 在权限允许之后、执行之前；post 在执行之后。
 * 实现在 runtime（它要起进程），这里只定形状
 */
export interface ToolHooks {
  pre?(call: ToolCallInfo): Promise<{ block: boolean; reason?: string; events: DomiEvent[] }>
  post?(
    call: ToolCallInfo,
    result: { ok: boolean; payload: unknown },
  ): Promise<{ events: DomiEvent[]; notes: Array<{ hook: string; exitCode: number | null; output: string }> }>
}

/**
 * 预算闸门（PRD-M7-009）：每次调用之前、权限之前问一次。stop = 这次不执行，本轮该结束了
 */
export type ToolGate = (call: ToolCallInfo) => Promise<{ stop: boolean; message?: string; events: DomiEvent[] }>

export interface ToolRegistryOptions {
  cwd: string
  permissions: PermissionEngine
  /** 工具向用户要输入时走这里；带上是哪个工具在问，确认框才能说清楚 */
  elicit?: (tool: { name: string; capability: string }, req: ElicitRequest) => Promise<ElicitResponse>
  /** 后台命令表（M7-001）。不给就不支持 background */
  jobs?: JobStarter
  /** 超长输出落盘目录 */
  outputDir?: string
  hooks?: ToolHooks
  gate?: ToolGate
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<never, unknown>>()
  /** 本会话读写过的文件指纹：同一个 registry 的所有调用共用一份 */
  readonly stamps = new FileStamps()

  constructor(private readonly opts: ToolRegistryOptions) {}

  /** INV-05：注册的必须是 Tool —— 没有 capability 字段的对象类型上就过不去 */
  register<A, R>(tool: Tool<A, R>): this {
    this.tools.set(tool.name, tool as unknown as Tool<never, unknown>)
    return this
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  unregister(name: string): void {
    this.tools.delete(name)
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

    const info: ToolCallInfo = { id: call.id, name: call.name, capability: tool.capability, args: parsed.data }
    const gateEvents: DomiEvent[] = []
    if (this.opts.gate) {
      const g = await this.opts.gate(info)
      gateEvents.push(...g.events)
      if (g.stop) {
        return {
          ok: false,
          reason: 'budget_stop',
          events: gateEvents,
          payload: { message: g.message ?? '用量到了上限，用户选择停止。不要再调用工具，总结目前的进展后结束。' },
        }
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
      ...(decision.grant === undefined ? {} : { grant: decision.grant }),
    }

    if (decision.decision !== 'allow') {
      const byUser = decision.source === 'user'
      return {
        ok: false,
        // PRD-M0-003 AC-2 的 user_denied 只给**用户当场拒绝**。规则拒绝、默认拒绝另起一个名字——
        // 说成「用户拒绝了」，用户会以为自己误操作，模型会以为用户不想让它做（BUG-M3-013）
        reason: byUser ? 'user_denied' : 'permission_denied',
        events: [...gateEvents, permissionEvent],
        // 给模型的是一句人话，不是异常——它需要知道"被拒了"、被谁拒的，并据此改计划
        payload: {
          message: denialMessage(tool.capability, decision.source, decision.matchedRule),
          capability: tool.capability,
          source: decision.source,
          ...(decision.matchedRule === null ? {} : { rule: decision.matchedRule }),
        },
      }
    }

    const events: DomiEvent[] = [...gateEvents, permissionEvent]
    if (this.opts.hooks?.pre) {
      const pre = await this.opts.hooks.pre(info)
      events.push(...pre.events)
      if (pre.block) {
        return {
          ok: false,
          reason: 'hook_blocked',
          events,
          payload: {
            message: `${pre.reason ?? '被钩子拦下'}\n（这是用户配置的检查，不是权限问题。按它说的改，不要原样重试。）`,
          },
        }
      }
    }
    const elicit = this.opts.elicit
    const ctx: ToolCtx = {
      cwd: this.opts.cwd,
      signal,
      emit: (ev) => {
        events.push(ev)
      },
      stamps: this.stamps,
      callId: call.id,
      ...(this.opts.jobs ? { jobs: this.opts.jobs } : {}),
      ...(this.opts.outputDir ? { outputDir: this.opts.outputDir } : {}),
      ...(elicit
        ? { elicit: (req: ElicitRequest) => elicit({ name: tool.name, capability: tool.capability }, req) }
        : {}),
    }

    let outcome: ToolOutcome
    try {
      const payload = await (tool as Tool<unknown, unknown>).execute(parsed.data, ctx)
      outcome = { ok: true, payload, events }
    } catch (e) {
      outcome = {
        ok: false,
        reason: e instanceof Error ? e.name : 'tool_threw',
        events,
        payload: { message: e instanceof Error ? e.message : String(e) },
      }
    }
    if (this.opts.hooks?.post) {
      const post = await this.opts.hooks.post(info, { ok: outcome.ok, payload: outcome.payload })
      events.push(...post.events)
      // 钩子输出附在结果上：它和结果一样是数据（INV-06），在上下文里同样带边界
      if (post.notes.length > 0) {
        const p = outcome.payload
        outcome.payload =
          p !== null && typeof p === 'object' && !Array.isArray(p)
            ? { ...(p as Record<string, unknown>), hooks: post.notes }
            : { result: p, hooks: post.notes }
      }
    }
    return outcome
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
