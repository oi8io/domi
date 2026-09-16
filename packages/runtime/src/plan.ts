/**
 * 计划模式 —— PRD-M7-005 · SPEC-M7-005
 *
 * 计划模式是权限的一种范围（SPEC 取舍-7）：只读之外一律拒绝。模型想清楚之后调 plan.submit，
 * 用户在确认框里批准 / 驳回（可附意见、可选转成长任务）。批准 → 切回执行模式。
 */
import { PLAN_SUBMIT_CAPABILITY, type Tool } from '@domi/capability'
import type { DomiEvent } from '@domi/protocol'
import { z } from 'zod'

export const PlanStep = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'id 只许字母、数字、_ 和 -'),
  goal: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
})

export const PlanSubmitArgs = z.object({
  plan: z.string().min(1).describe('给用户看的计划全文：要改哪些文件、怎么改、怎么验证、有什么风险'),
  steps: z.array(PlanStep).optional().describe('可选：拆好的步骤。用户选择「转成长任务」时，每一步成为一个节点'),
})
export type PlanSubmitArgs = z.infer<typeof PlanSubmitArgs>

/** 确认框里的表单 */
export const PLAN_DECISION_SCHEMA = {
  type: 'object',
  /** 字段都可选：终端里 y 直接批准（不带意见、不转长任务） */
  'x-domi-accept-empty': true,
  properties: {
    comment: { type: 'string', title: '意见（可选）' },
    asTask: { type: 'boolean', title: '批准后转成长任务（按步骤逐个执行）' },
  },
} as const

export interface PlanHost {
  /** 批准之后：切回执行模式（返回要落的事件） */
  approved(): DomiEvent[]
  /** 转长任务：返回 runId；做不了时抛错 */
  startTask?(spec: unknown): Promise<string>
}

/** 计划步骤 → DAG 定义（agent-step 节点），经 orchestrator 同一套校验 */
export function stepsToDag(plan: string, steps: z.infer<typeof PlanStep>[]): unknown {
  return {
    name: plan.split('\n')[0]?.slice(0, 60) || '按计划执行',
    description: plan,
    nodes: steps.map((s) => ({
      id: s.id,
      type: 'agent-step',
      needs: s.dependsOn ?? [],
      prompt: `这是已经批准的计划里的一步：${s.goal}\n\n完整计划：\n${plan}`,
    })),
  }
}

export function makePlanSubmitTool(host: PlanHost): Tool<PlanSubmitArgs, Record<string, unknown>> {
  return {
    name: 'plan.submit',
    capability: PLAN_SUBMIT_CAPABILITY,
    description: '计划模式下，把想好的方案提交给用户审批。批准后才能动手改；驳回时会带上用户的意见。',
    schema: PlanSubmitArgs,
    async execute(args, ctx) {
      ctx.emit({ t: 'plan.proposed', plan: args.plan, ...(args.steps ? { steps: args.steps } : {}) })
      const answer = ctx.elicit
        ? await ctx.elicit({ message: `审批计划：\n\n${args.plan}`, requestedSchema: PLAN_DECISION_SCHEMA })
        : { action: 'decline' as const }
      const approved = answer.action === 'accept'
      const comment =
        typeof answer.content?.comment === 'string' && answer.content.comment.trim() !== ''
          ? answer.content.comment.trim()
          : undefined
      const wantTask = approved && answer.content?.asTask === true
      let runId: string | undefined
      let taskError: string | undefined
      if (wantTask) {
        if (!args.steps || args.steps.length === 0) taskError = '计划里没有拆好的步骤，没法转成长任务'
        else if (!host.startTask) taskError = '这个环境不能启动长任务'
        else {
          try {
            runId = await host.startTask(stepsToDag(args.plan, args.steps))
          } catch (e) {
            taskError = e instanceof Error ? e.message : String(e)
          }
        }
      }
      ctx.emit({
        t: 'plan.decided',
        approved,
        ...(comment === undefined ? {} : { comment }),
        ...(wantTask ? { asTask: true } : {}),
        ...(runId === undefined ? {} : { runId }),
      })
      if (!approved) {
        return {
          approved: false,
          ...(comment === undefined ? {} : { comment }),
          next: ctx.elicit
            ? '用户没有批准。按意见修改计划后再提交；仍然只能读，不能改。'
            : '现在没有人能审批，计划没有被批准。',
        }
      }
      for (const ev of host.approved()) ctx.emit(ev)
      if (runId !== undefined) {
        return {
          approved: true,
          runId,
          ...(comment === undefined ? {} : { comment }),
          next: `计划已转成长任务 ${runId}，会在后台按步骤执行。不要在这里重复做这些步骤，简短说明后结束这一轮。`,
        }
      }
      return {
        approved: true,
        ...(comment === undefined ? {} : { comment }),
        ...(taskError === undefined ? {} : { taskError }),
        next: '计划已批准，现在是执行模式，按计划动手（结合用户意见）。',
      }
    },
  }
}
