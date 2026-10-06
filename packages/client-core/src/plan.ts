/**
 * M14 进度 tab 投影 —— PRD-M14-004（SPEC-M14-004）
 *
 * 全部纯函数（INV-04）：只投影最后一条 plan.update；步骤区间回溯；计划整份替换对齐；
 * 子 agent（task.spawn）/ DAG 节点（task.node）按 seq 归属步骤；verify 投影；
 * 无计划时的本轮动作摘要。Web 与 TUI（009）共用这一份；组件层不做任何计算。
 */
import type { EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import { lastUserInputSeq, type StepIntervals } from './changes.ts'

export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped'

/** 步骤展示体（最后一条 plan.update 的原文） */
export interface PlanStep {
  id: string
  text: string
  status: PlanStepStatus
  dependsOn?: string[] | undefined
  /** 依赖链长度（SPEC-M14-004 取舍-1：缩进用，不画 DAG） */
  depth: number
}

export interface SubagentActivity {
  seq: number
  sessionId: string
  goal: string
  /** task.end 投影：没结束 = spawned */
  status: 'spawned' | 'done' | 'failed'
  ms?: number | undefined
}

export interface NodeActivity {
  seq: number
  nodeId: string
  status: 'started' | 'done' | 'failed'
  attempt: number
  ms?: number | undefined
  sessionId?: string | undefined
}

/** 一步「干了什么」（区间 = [startSeq, endSeq]，SPEC-M14-004 取舍-1） */
export interface StepActivity {
  step: PlanStep
  /** 是否跑过（回溯到过 in_progress）；没跑过 → 区间为空 */
  started: boolean
  startSeq: number | null
  /** 之后第一条使该步 status ≠ in_progress 的 plan.update 的 seq − 1；仍在跑 → head */
  endSeq: number | null
  durationMs: number | null
  toolCalls: number
  toolBreakdown: Array<{ name: string; count: number }>
  /** 区间内 fs.snapshot 出现过的路径（去重，按出现顺序） */
  files: string[]
  /** 区间内 model.usage 聚合（input+output；识别不到的字段算 0） */
  tokens: number
  subagents: SubagentActivity[]
  nodes: NodeActivity[]
}

export interface VerifyProjection {
  attempt: number
  /** 是否最后一次（final:true） */
  final: boolean
  message: string
}

export interface PlanView {
  kind: 'plan'
  note?: string | undefined
  steps: StepActivity[]
  /**
   * 整份替换后从计划里消失、且最后状态不是 done/skipped 的旧步骤。
   * 不做成 done、不显示（SPEC 取舍-1「旧 id 消失没 done = 未开始」），测试可断言。
   */
  dropped: Array<{ id: string; text: string; lastStatus: PlanStepStatus }>
  /** 最近一次 verify.required；没有 → null */
  verify: VerifyProjection | null
  /** 剩余步数（done/skipped 不算；「计划还剩 N 步」口径） */
  remaining: number
}

/** 无计划（自由会话常见）时的本轮动作摘要（SPEC-M14-004 取舍-4） */
export interface TurnSummary {
  kind: 'summary'
  counts: Record<string, number>
  total: number
  /** 最近 5 个动作（按 seq 从新到旧） */
  recent: Array<{ seq: number; name: string; summary: string }>
}

const CATEGORIES = ['fs', 'shell', 'memory', 'task', 'skill', 'mcp'] as const

function categoryOf(name: string): string {
  const p = name.split('.')[0] ?? ''
  if ((CATEGORIES as readonly string[]).includes(p)) return p
  return 'other'
}

/** model.usage.raw 的 token 聚合：先认 inputTokens/outputTokens，再认 prompt/completion，都没有算 0 */
function tokensOf(raw: Record<string, unknown>): number {
  const num = (k: string): number | null => (typeof raw[k] === 'number' ? (raw[k] as number) : null)
  const input = num('inputTokens') ?? num('promptTokens') ?? num('input_tokens') ?? num('prompt_tokens')
  const output = num('outputTokens') ?? num('completionTokens') ?? num('output_tokens') ?? num('completion_tokens')
  if (input !== null && output !== null) return input + output
  if (input !== null) return input
  return 0
}

/** 工具参数摘要（60 字截断）：path / command / query / name / title / text / message 优先 */
function argExcerpt(args: unknown): string {
  if (typeof args !== 'object' || args === null) return ''
  const a = args as Record<string, unknown>
  for (const k of ['path', 'command', 'query', 'name', 'title', 'text', 'message']) {
    const v = a[k]
    if (typeof v === 'string' && v.length > 0) return v.length > 60 ? `${v.slice(0, 60)}…` : v
  }
  const j = JSON.stringify(a)
  if (j === undefined || j === '{}') return ''
  return j.length > 60 ? `${j.slice(0, 60)}…` : j
}

interface PlanUpdateEvent {
  seq: number
  ts: number
  steps: Array<{ id: string; text: string; status: PlanStepStatus; dependsOn?: string[] }>
  note?: string
}

function plans(events: readonly EventEnvelope[]): PlanUpdateEvent[] {
  const out: PlanUpdateEvent[] = []
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'plan.update') continue
    const steps = e.ev.steps.map((s) => ({
      id: s.id,
      text: s.text,
      status: s.status,
      ...(s.dependsOn === undefined ? {} : { dependsOn: s.dependsOn }),
    }))
    out.push({ seq: e.seq, ts: e.ts, steps, ...(e.ev.note === undefined ? {} : { note: e.ev.note }) })
  }
  return out
}

/** 在给定 plan.update 里找步骤：先按 id，id 找不到按 text（SPEC 取舍-1：id 优先） */
function findIn(
  p: PlanUpdateEvent,
  id: string,
  text: string,
): { id: string; text: string; status: PlanStepStatus; dependsOn?: string[] } | undefined {
  const byId = p.steps.find((s) => s.id === id)
  if (byId !== undefined) return byId
  return p.steps.find((s) => s.text === text)
}

/** 依赖链长度（memo 化，环/缺失依赖按 0） */
function depths(steps: Array<{ id: string; dependsOn?: string[] }>): Map<string, number> {
  const memo = new Map<string, number>()
  const walk = (id: string, seen: Set<string>): number => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const s = steps.find((x) => x.id === id)
    if (s === undefined || s.dependsOn === undefined || s.dependsOn.length === 0) {
      memo.set(id, 0)
      return 0
    }
    let max = 0
    for (const dep of s.dependsOn) {
      if (seen.has(dep)) continue
      const next = new Set(seen)
      next.add(dep)
      max = Math.max(max, walk(dep, next) + 1)
    }
    memo.set(id, max)
    return max
  }
  for (const s of steps) walk(s.id, new Set([s.id]))
  return memo
}

/** 最后一条 plan.update 的步骤 → 步区间（SPEC-M14-004 取舍-1 AC-2） */
export function planView(events: readonly EventEnvelope[], head: number): PlanView | TurnSummary {
  const ps = plans(events)
  if (ps.length === 0) return turnSummary(events, head)
  const latest = ps[ps.length - 1]!
  const older = ps.slice(0, -1)

  const depthOf = depths(latest.steps)
  const steps: StepActivity[] = latest.steps.map((step) => {
    // 起点：从旧到新扫，找最后一条该步 in_progress 的 plan.update（id 优先，text 兜底）
    let startPlan: PlanUpdateEvent | null = null
    for (let i = older.length - 1; i >= 0; i--) {
      const p = older[i]!
      const m = findIn(p, step.id, step.text)
      if (m !== undefined && m.status === 'in_progress') {
        startPlan = p
        break
      }
    }
    // 最后一条自己也是 in_progress（进行中）→ 起点算它
    if (step.status === 'in_progress') startPlan = latest

    if (startPlan === null) {
      return {
        step: {
          id: step.id,
          text: step.text,
          status: step.status,
          ...(step.dependsOn === undefined ? {} : { dependsOn: step.dependsOn }),
          depth: depthOf.get(step.id) ?? 0,
        },
        started: false,
        startSeq: null,
        endSeq: null,
        durationMs: null,
        toolCalls: 0,
        toolBreakdown: [],
        files: [],
        tokens: 0,
        subagents: [],
        nodes: [],
      }
    }

    // 终点：startPlan 之后第一条该步 status ≠ in_progress 的 plan.update 的 seq − 1；仍 in_progress → head
    let endSeq = head
    for (let i = ps.indexOf(startPlan) + 1; i < ps.length; i++) {
      const p = ps[i]!
      const m = findIn(p, step.id, step.text)
      if (m !== undefined && m.status !== 'in_progress') {
        endSeq = p.seq - 1
        break
      }
    }

    // 区间内容
    let toolCalls = 0
    const toolMap = new Map<string, number>()
    const files: string[] = []
    const seenFiles = new Set<string>()
    let tokens = 0
    const subagents: SubagentActivity[] = []
    const nodes: NodeActivity[] = []
    for (const e of events) {
      if (e.seq < startPlan.seq || e.seq > endSeq) continue
      if (!isKnownEvent(e.ev)) continue
      switch (e.ev.t) {
        case 'tool.call': {
          toolCalls += 1
          toolMap.set(e.ev.name, (toolMap.get(e.ev.name) ?? 0) + 1)
          break
        }
        case 'fs.snapshot': {
          if (seenFiles.has(e.ev.path)) break
          seenFiles.add(e.ev.path)
          files.push(e.ev.path)
          break
        }
        case 'model.usage': {
          tokens += tokensOf(e.ev.raw)
          break
        }
        case 'task.spawn': {
          subagents.push({
            seq: e.seq,
            sessionId: e.ev.childSessionId,
            goal: e.ev.goal,
            status: 'spawned',
          })
          break
        }
        case 'task.node': {
          nodes.push({
            seq: e.seq,
            nodeId: e.ev.nodeId,
            status: e.ev.status,
            attempt: e.ev.attempt,
            ...(e.ev.ms === undefined ? {} : { ms: e.ev.ms }),
            ...(e.ev.sessionId === undefined ? {} : { sessionId: e.ev.sessionId }),
          })
          break
        }
        default:
          break
      }
    }
    // task.end 投影子会话状态：最后一次 task.end 之前的 spawn 都归它管
    for (const g of subagents) {
      let st: SubagentActivity['status'] = 'spawned'
      for (const e of events) {
        if (e.seq <= g.seq) continue
        if (e.seq > endSeq) break
        if (isKnownEvent(e.ev) && e.ev.t === 'task.end') {
          st = e.ev.status === 'done' ? 'done' : 'failed'
        }
      }
      g.status = st
    }

    return {
      step: {
        id: step.id,
        text: step.text,
        status: step.status,
        ...(step.dependsOn === undefined ? {} : { dependsOn: step.dependsOn }),
        depth: depthOf.get(step.id) ?? 0,
      },
      started: true,
      startSeq: startPlan.seq,
      endSeq,
      durationMs: endSeq >= startPlan.seq ? Math.max(0, endTs(events, endSeq) - startPlan.ts) : null,
      toolCalls,
      toolBreakdown: [...toolMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      files,
      tokens,
      subagents,
      nodes,
    }
  })

  // 整份替换：旧步骤里不在最新计划中、且最后状态不是 done/skipped 的记下来（不做成 done）
  const latestIds = new Set(latest.steps.map((s) => s.id))
  const dropped: PlanView['dropped'] = []
  for (const p of older) {
    for (const s of p.steps) {
      if (latestIds.has(s.id)) continue
      if (s.status === 'done' || s.status === 'skipped') continue
      const known = dropped.find((d) => d.id === s.id)
      if (known !== undefined) {
        // 保留最后状态
        known.lastStatus = s.status
      } else {
        dropped.push({ id: s.id, text: s.text, lastStatus: s.status })
      }
    }
  }

  // verify：最近一次
  let verify: VerifyProjection | null = null
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'verify.required') continue
    verify = { attempt: e.ev.attempt, final: e.ev.final ?? false, message: e.ev.message }
  }

  const remaining = steps.filter((s) => s.step.status !== 'done' && s.step.status !== 'skipped').length
  return {
    kind: 'plan',
    ...(latest.note === undefined ? {} : { note: latest.note }),
    steps,
    dropped,
    verify,
    remaining,
  }
}

/** 最后一个 seq ≤ target 的事件 ts（endSeq 可能是虚拟 seq − 1，事件流里没有这个 seq） */
function endTs(events: readonly EventEnvelope[], target: number): number {
  let ts = 0
  for (const e of events) {
    if (e.seq > target) break
    ts = e.ts
  }
  return ts
}

/** 步区间表 → 改动 tab 的 {step} 范围（与 StepIntervals 同形） */
export function stepIntervals(view: PlanView): StepIntervals {
  const out: StepIntervals = {}
  for (const s of view.steps) {
    if (!s.started || s.startSeq === null || s.endSeq === null) continue
    out[s.step.id] = { startSeq: s.startSeq, endSeq: s.endSeq }
  }
  return out
}

/** 子 agent / DAG 节点按步骤归属的扁平列表（SPEC-M14-004 取舍-2） */
export function subagentTree(
  view: PlanView,
): Array<{ stepId: string; stepText: string; subagents: SubagentActivity[]; nodes: NodeActivity[] }> {
  return view.steps
    .filter((s) => s.subagents.length > 0 || s.nodes.length > 0)
    .map((s) => ({ stepId: s.step.id, stepText: s.step.text, subagents: s.subagents, nodes: s.nodes }))
}

/** 无计划时的本轮动作摘要（SPEC-M14-004 取舍-4） */
export function turnSummary(events: readonly EventEnvelope[], head: number): TurnSummary {
  const start = lastUserInputSeq(events, head) ?? 1
  const counts: Record<string, number> = { fs: 0, shell: 0, memory: 0, task: 0, skill: 0, mcp: 0, other: 0 }
  const recent: TurnSummary['recent'] = []
  let total = 0
  for (const e of events) {
    if (e.seq <= start || e.seq > head) continue
    if (!isKnownEvent(e.ev) || e.ev.t !== 'tool.call') continue
    const cat = categoryOf(e.ev.name)
    counts[cat] = (counts[cat] ?? 0) + 1
    total += 1
    recent.push({ seq: e.seq, name: e.ev.name, summary: argExcerpt(e.ev.args) })
  }
  recent.sort((a, b) => b.seq - a.seq)
  return { kind: 'summary', counts, total, recent: recent.slice(0, 5) }
}
