/**
 * 子 agent —— PRD-M5-001 · docs/adr/020 · INV-03 / INV-05
 *
 * 就是一个 Tool：`task.spawn {goal, tools?}`。执行时开一个新会话（上下文与父会话完全隔离，AC-2），
 * 用父会话收窄后的权限跑一轮，把最后一段回答当作工具结果交回去。
 * 子会话的中间过程只在子会话里；父会话里留下的是 `task.spawn` 事件与这段结论（AC-1）。
 */
import { PARENT_SCOPE_RULE, type Tool } from '@domi/capability'
import type { EventEnvelope } from '@domi/protocol'
import { z } from 'zod'

/** 子 agent 最多嵌两层，再深就不给 task.spawn 了 */
export const MAX_SPAWN_DEPTH = 2

export const SpawnArgs = z.object({
  goal: z.string().min(1).describe('子任务要完成什么。写清楚完成的标准——子 agent 看不到你这边的对话'),
  tools: z
    .array(z.string())
    .optional()
    .describe(
      '子 agent 可以用的能力（如 fs.read、shell.exec、mcp.github.*）。不给就是你自己能用的全部；只能更少，不能更多',
    ),
})
export type SpawnArgs = z.infer<typeof SpawnArgs>

export interface SpawnResult {
  childSessionId: string
  ok: boolean
  conclusion: string
}

export const SPAWN_PROMPT = (goal: string): string =>
  [
    '你是被派来完成一个子任务的 agent。你看不到派你来的那段对话，只有下面这个目标。',
    `目标：${goal}`,
    '',
    '做完之后，用一段话给出结论：做了什么、结果如何、还有什么没解决。这段话会原样交给派你来的 agent，其余过程它看不到。',
    '有些能力可能不在你的范围里；被拒绝时不要重试，在结论里说明还需要什么。',
  ].join('\n')

/** 子会话需要的最小接口（不 import session.ts：两边互相引用会成环） */
export interface ChildSession {
  on(k: 'onAsk', fn: (ask: PendingAskLike | null) => void): unknown
  on(k: 'onEvents', fn: (envs: EventEnvelope[]) => void): unknown
  /** signal：父轮被中断时一起停（PRD-M13-002 · SPEC-M13-002 取舍-4） */
  submit(text: string, opts?: { signal?: AbortSignal }): Promise<{ stopReason: string }>
  lastAnswer(): Promise<string>
  flushAndClose(): Promise<void>
}

export interface PendingAskLike {
  capabilityId: string
  args: unknown
  grantable?: boolean
  answer(allowed: boolean, content?: Record<string, unknown>, channel?: string, grant?: boolean): void
}

export interface SpawnParent {
  readonly id: string
  forwardAsk(ask: PendingAskLike | null): void
  /** 用自己的配置建子会话；scope 为 undefined 时沿用父范围 */
  createChild(opts: { sessionId: string; title: string; tools: readonly string[] | undefined; depth?: number }): {
    child: ChildSession
    childEvents: ((id: string, envs: EventEnvelope[]) => void) | undefined
  }
}

let counter = 0

/** 开一个子会话跑到结束。编排的 sub-agent 节点也用它 */
export async function runSubAgent(
  parent: SpawnParent,
  args: SpawnArgs,
  opts: { sessionId?: string; depth?: number; signal?: AbortSignal } = {},
): Promise<SpawnResult> {
  counter += 1
  const childSessionId = opts.sessionId ?? `${parent.id}.sub-${Date.now().toString(36)}${counter}`
  const { child, childEvents } = parent.createChild({
    sessionId: childSessionId,
    title: args.goal.slice(0, 60),
    tools: args.tools,
    ...(opts.depth === undefined ? {} : { depth: opts.depth }),
  })
  child.on('onAsk', (ask) => parent.forwardAsk(ask))
  if (childEvents) child.on('onEvents', (envs) => childEvents(childSessionId, envs))
  try {
    const r = await child.submit(SPAWN_PROMPT(args.goal), opts.signal === undefined ? {} : { signal: opts.signal })
    if (r.stopReason === 'interrupted') {
      return { childSessionId, ok: false, conclusion: '子 agent 被用户中断，没有做完。' }
    }
    const conclusion = await child.lastAnswer()
    return {
      childSessionId,
      ok: r.stopReason === 'completed',
      conclusion:
        conclusion ||
        (r.stopReason === 'completed' ? '（子 agent 没有给出结论）' : `子 agent 中途停止：${r.stopReason}`),
    }
  } finally {
    await child.flushAndClose()
  }
}

export function makeSpawnTool(parent: SpawnParent): Tool<SpawnArgs, SpawnResult> {
  return {
    name: 'task.spawn',
    capability: 'task.spawn',
    description:
      '派一个子 agent 去完成一个独立的子任务。它有自己的上下文（看不到这段对话），权限不会比你大；' +
      '你只会收到它最后的结论。适合「读一堆文件后总结」这类会把上下文撑大的活。',
    schema: SpawnArgs,
    async execute(args, ctx) {
      // 父轮被中断时子 agent 一起停，不让父轮干等它跑完（SPEC-M13-002 取舍-4）
      const r = await runSubAgent(parent, args, { signal: ctx.signal })
      ctx.emit({
        t: 'task.spawn',
        childSessionId: r.childSessionId,
        goal: args.goal,
        ...(args.tools === undefined ? {} : { tools: args.tools }),
      })
      return r
    },
  }
}

export { PARENT_SCOPE_RULE }
