/**
 * 计划 —— PRD-M12-004 AC-5 / AC-8 / AC-9 · SPEC-M12-004 第二轮 取舍-2 / 3
 *
 * 计划必须：任务会话里，动手（只读之外的工具）之前必须先有计划——「不然中间中断就凉了」。
 * 计划是一个工具（plan.update，整份替换，同 Claude Code 的 TodoWrite）+ 一条事件（plan.update），
 * 常驻上下文，重开会话从事件流恢复。审批跟确认模式走：每次都问 → 要批准；按需 → 用户说了「先别动」才要；
 * 全部放行 → 不审批。审批本身是问题框（批准 / 批准并转长任务 / 其他 = 修改意见）。
 *
 * 「没计划 / 没批准不许动手」由 ToolRegistry 的闸门执行（makePlanGate），不进权限引擎——这不是权限决定。
 */
import type { Tool, ToolCallInfo } from '@domi/capability'
import { tr } from '@domi/i18n'
import { type EventEnvelope, normalizeAnswers, type Question, questionsToForm } from '@domi/protocol'
import { z } from 'zod'

export const PLAN_CAPABILITY = 'plan.update'

export const PlanStepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'id 只许字母、数字、_ 和 -'),
  text: z.string().min(1).max(400),
  status: z.enum(['pending', 'in_progress', 'done', 'skipped']).default('pending'),
  dependsOn: z.array(z.string()).optional(),
})
export type PlanStep = z.infer<typeof PlanStepSchema>

export const PlanUpdateArgs = z.object({
  steps: z
    .array(PlanStepSchema)
    .min(1)
    .max(40)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, { message: '步骤 id 不能重复' })
    .describe(
      '整份计划（每次都给全量）：每步 id、text、status（pending / in_progress / done / skipped），可选 dependsOn',
    ),
  note: z.string().max(2000).optional().describe('可选：计划的补充说明（风险、验证方式、用户的意见怎么落实）'),
})
export type PlanUpdateArgs = z.infer<typeof PlanUpdateArgs>

/** 没计划 / 没批准也能用的：只读，以及和用户说话 */
const FREE_EXACT: ReadonlySet<string> = new Set([
  'fs.read',
  'memory.search',
  'memory.recall',
  'skill.load',
  'ask.user',
  PLAN_CAPABILITY,
  'review.report',
])
const FREE_PREFIX: readonly string[] = ['code.']

export function isPlanFree(capability: string): boolean {
  return FREE_EXACT.has(capability) || FREE_PREFIX.some((p) => capability.startsWith(p))
}

/**
 * 阻止提示（PRD-M12-004 AC-9）：用户这句话里明说「先别动 / 先给方案 / 等我确认」。
 * 宁可多问：误判的代价只是多点一次批准。返回命中的片段；没有 → null
 */
const BLOCKING: readonly RegExp[] = [
  /先别(动|改|碰|执行|开始|急|写|做)/,
  /别(急着|先)?(动手|动代码|改代码|执行)/,
  /不要(直接|马上|急着|先)?(动手|执行|开始改|改代码|修改)/,
  /(先|只)(给|出|要|列|写)(个|一个|一份|我)?(个)?(方案|计划)/,
  /等我(确认|看过|看完|点头|批准|同意)/,
  /确认(之)?后再/,
  /\bdon'?t (start|begin|change|touch|modify|execute|implement|edit)\b/i,
  /\b(wait|hold off) (for|until) (my |i )?(approval|confirmation|ok|go-ahead|review)/i,
  /\bplan only\b/i,
  /\bjust (give me |make )?(a )?plan\b/i,
  /\bbefore (you )?(change|touch|modify|start|edit)/i,
]

export function blockingHint(text: string): string | null {
  for (const re of BLOCKING) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}

const MARK: Record<PlanStep['status'], string> = { done: '[x]', in_progress: '[>]', skipped: '[-]', pending: '[ ]' }

export function renderPlan(steps: readonly PlanStep[]): string {
  return steps.map((s, i) => `${i + 1}. ${MARK[s.status]} ${s.text}`).join('\n')
}

/**
 * 计划状态：会话内存里一份，重开会话从事件流恢复（restore）。
 * 批准绑在「步骤集合」上：只改状态不用重新批；增删改步骤、或者用户又说了「先别动」，就要重新批
 */
export class PlanTracker {
  steps: PlanStep[] = []
  note: string | undefined
  /** 最近一次审批的结果（驳回时带意见） */
  lastDecision: { approved: boolean; comment?: string } | null = null
  private key = ''
  private approvedKey: string | null = null
  private approvedAt = -1
  private hintAt = -1
  private inputs = 0

  get hasPlan(): boolean {
    return this.steps.length > 0
  }

  get remaining(): number {
    return this.steps.filter((s) => s.status !== 'done' && s.status !== 'skipped').length
  }

  /** 一句新的用户输入：记下它有没有阻止提示 */
  onUserInput(text: string): void {
    this.inputs++
    if (blockingHint(text) !== null) this.hintAt = this.inputs
  }

  /** 最近一句用户输入带着阻止提示 */
  hintActive(): boolean {
    return this.hintAt === this.inputs && this.inputs > 0
  }

  update(steps: readonly PlanStep[], note?: string): void {
    this.steps = steps.map((s) => ({ ...s }))
    this.note = note
    this.key = JSON.stringify(steps.map((s) => [s.id, s.text]))
  }

  decide(approved: boolean, comment?: string): void {
    this.lastDecision = { approved, ...(comment === undefined ? {} : { comment }) }
    if (approved) {
      this.approvedKey = this.key
      this.approvedAt = this.inputs
    } else this.approvedKey = null
  }

  approved(): boolean {
    return this.hasPlan && this.approvedKey === this.key && this.approvedAt >= this.hintAt
  }

  restore(events: readonly EventEnvelope[]): void {
    for (const e of events) {
      const ev = e.ev as {
        t: string
        text?: unknown
        steps?: unknown
        note?: unknown
        approved?: unknown
        comment?: unknown
      }
      if (ev.t === 'user.input' && typeof ev.text === 'string') this.onUserInput(ev.text)
      else if (ev.t === 'plan.update' && Array.isArray(ev.steps)) {
        const parsed = z.array(PlanStepSchema).safeParse(ev.steps)
        if (parsed.success) this.update(parsed.data, typeof ev.note === 'string' ? ev.note : undefined)
      } else if (ev.t === 'plan.decided' && typeof ev.approved === 'boolean') {
        this.decide(ev.approved, typeof ev.comment === 'string' ? ev.comment : undefined)
      }
    }
  }
}

export interface PlanPolicy {
  tracker: PlanTracker
  /** 这个会话要不要强制有计划（任务会话，SPEC 取舍-3） */
  required(): boolean
  /** 当前确认模式 */
  mode(): 'always-ask' | 'on-demand' | 'allow-all'
}

/** 现在动手之前要不要一个批准过的计划 */
export function needsApproval(p: PlanPolicy): boolean {
  const mode = p.mode()
  if (mode === 'allow-all') return false
  if (p.tracker.hintActive()) return true
  return mode === 'always-ask' && (p.required() || p.tracker.hasPlan)
}

/**
 * 计划闸门：只读与「和用户说话」随时放行；其余的——任务里没计划拦（plan_required），
 * 要批准而没批准拦（plan_unapproved）。拦下的调用不执行、这一轮不结束，原因写给模型
 */
export function makePlanGate(p: PlanPolicy): (info: ToolCallInfo) => { reason: string; message: string } | null {
  return (info) => {
    if (isPlanFree(info.capability)) return null
    const t = p.tracker
    if (p.required() && !t.hasPlan) {
      return {
        reason: 'plan_required',
        message:
          '这是一个任务：动手（改文件、跑命令等）之前先用 plan.update 写出计划（步骤 + 状态），再按计划做。' +
          '计划会一直留在上下文里，中途断了也能照着接着做。',
      }
    }
    if (needsApproval(p) && !t.approved()) {
      const declined = t.lastDecision?.approved === false
      return {
        reason: 'plan_unapproved',
        message: !t.hasPlan
          ? '用户要求先看方案再动手：先用 plan.update 写出计划，等用户批准。批准前只能读。'
          : declined
            ? `用户没有批准计划${t.lastDecision?.comment ? `（意见：${t.lastDecision.comment}）` : ''}。按意见改好后再用 plan.update 提交；批准前只能读。`
            : '计划还没被批准。等用户批准后再动手；批准前只能读。',
      }
    }
    return null
  }
}

/** 计划步骤 → DAG 定义（agent-step 节点），经 orchestrator 同一套校验 */
export function stepsToDag(title: string, steps: readonly PlanStep[]): unknown {
  const full = renderPlan(steps)
  return {
    name: title.slice(0, 60) || '按计划执行',
    description: full,
    nodes: steps
      .filter((s) => s.status !== 'done' && s.status !== 'skipped')
      .map((s) => ({
        id: s.id,
        type: 'agent-step',
        needs: (s.dependsOn ?? []).filter((d) =>
          steps.some((o) => o.id === d && o.status !== 'done' && o.status !== 'skipped'),
        ),
        prompt: `这是已经批准的计划里的一步：${s.text}\n\n完整计划：\n${full}`,
      })),
  }
}

/** 常驻上下文的计划层（SPEC 取舍-2）。没有计划、也不强制时返回空串 */
export function planPromptText(p: PlanPolicy): string {
  const t = p.tracker
  const lines: string[] = []
  if (t.hasPlan) {
    const total = t.steps.length
    lines.push(`当前计划（${total - t.remaining}/${total} 完成）：`, renderPlan(t.steps))
    if (t.note) lines.push(`说明：${t.note}`)
    lines.push(
      '按计划推进：开始一步前把它标成 in_progress，做完标 done（同一时间只有一步 in_progress），每次都用 plan.update 整份更新；计划变了（加减步骤）也用 plan.update。',
    )
  } else if (p.required()) {
    lines.push(
      '这是一个任务：动手（改文件、跑命令等）之前，先用 plan.update 写出计划（步骤 + 状态），再按计划做。需要用户拍板的点，用 ask.user 一次问清。',
    )
  }
  if (needsApproval(p) && !t.approved()) {
    lines.push('用户需要先批准计划：写好计划后等批准，批准前只能读。')
  }
  return lines.join('\n')
}

export interface PlanToolHost extends PlanPolicy {
  /** 转长任务（M7-005 起的能力，AC-5）。不给就不提供这个选项 */
  startTask?(spec: unknown): Promise<string>
}

/** 步骤够多才值得拆成长任务（沿用 M8-005 的口径：≥ 3 步） */
const MIN_TASK_STEPS = 3

export function makePlanUpdateTool(host: PlanToolHost): Tool<PlanUpdateArgs, Record<string, unknown>> {
  return {
    name: 'plan.update',
    capability: PLAN_CAPABILITY,
    description:
      '写 / 更新这次工作的计划：每次给整份步骤列表（id、text、status：pending / in_progress / done / skipped，可选 dependsOn）。' +
      '任务里动手前必须先写；每开始或做完一步就更新一次状态。计划一直留在上下文里，中途断了也能照着接着做。' +
      '需要审批时（用户选了「每次都问」，或说了先别动），写出计划后会请用户批准，批准前只能读。',
    schema: PlanUpdateArgs,
    async execute(args, ctx) {
      ctx.emit({ t: 'plan.update', steps: args.steps, ...(args.note === undefined ? {} : { note: args.note }) })
      const t = host.tracker
      t.update(args.steps, args.note)
      const remaining = t.remaining
      if (!needsApproval(host) || t.approved()) {
        return { recorded: true, remaining, next: '计划已记下，按计划推进；每开始 / 做完一步用 plan.update 更新状态。' }
      }
      if (!ctx.elicit) {
        t.decide(false)
        return {
          recorded: true,
          approved: false,
          next: '现在没有人能审批这个计划。批准之前只能读；说明计划后结束这一轮。',
        }
      }
      const approve = tr('core.plan.approve')
      const asTask = tr('core.plan.approveAsTask')
      const change = tr('core.plan.change')
      const canTask = host.startTask !== undefined && args.steps.length >= MIN_TASK_STEPS
      const q: Question = {
        header: tr('core.plan.header'),
        question: `${tr('core.plan.question')}\n\n${renderPlan(args.steps)}${args.note ? `\n\n${args.note}` : ''}`,
        options: [
          { label: approve, description: tr('core.plan.approveHint') },
          ...(canTask ? [{ label: asTask, description: tr('core.plan.approveAsTaskHint') }] : []),
          { label: change, description: tr('core.plan.changeHint') },
        ],
      }
      const form = questionsToForm([q], tr('core.ask.other'))
      const r = await ctx.elicit({ message: form.message, requestedSchema: form.schema })
      const a = r.action === 'accept' ? normalizeAnswers([q], r.content ?? {})[0] : undefined
      const picked = a?.selected[0]
      const comment = a?.other
      const approved = picked === approve || picked === asTask
      const wantTask = approved && picked === asTask
      let runId: string | undefined
      let taskError: string | undefined
      if (wantTask && host.startTask) {
        try {
          runId = await host.startTask(stepsToDag(args.steps[0]?.text ?? '', args.steps))
        } catch (e) {
          taskError = e instanceof Error ? e.message : String(e)
        }
      }
      ctx.emit({
        t: 'plan.decided',
        approved,
        ...(comment === undefined ? {} : { comment }),
        ...(wantTask ? { asTask: true } : {}),
        ...(runId === undefined ? {} : { runId }),
        shape: runId === undefined ? 'single' : 'dag',
        source: 'user',
      })
      t.decide(approved, comment)
      if (!approved) {
        return {
          approved: false,
          ...(comment === undefined ? {} : { comment }),
          next:
            r.action === 'accept'
              ? `用户没有批准${comment ? `，意见：${comment}` : ''}。按意见改好计划再用 plan.update 提交；批准前只能读。`
              : '用户没有回答审批。批准前只能读；说明计划后结束这一轮。',
        }
      }
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
        next: '计划已批准，按计划动手（结合用户意见）；每开始 / 做完一步用 plan.update 更新状态。',
      }
    },
  }
}
