/**
 * DAG 定义 —— PRD-M5-002 AC-1 / AC-2 · docs/adr/020
 *
 * 四种节点，YAML 定义，zod 校验，环在加载期就报错——跑到一半才发现有环，
 * 前面几个节点的副作用已经发生了。
 */
import { z } from 'zod'

const Base = {
  id: z.string().regex(/^[A-Za-z0-9_-]+$/, '节点 id 只许字母、数字、_ 和 -'),
  title: z.string().optional(),
  /** 依赖的节点 id。全部完成之后才轮到它 */
  needs: z.array(z.string()).default([]),
}

export const AgentStepNode = z
  .object({ ...Base, type: z.literal('agent-step'), prompt: z.string().min(1), model: z.string().optional() })
  .strict()
export const ToolNode = z
  .object({
    ...Base,
    type: z.literal('tool'),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export const SubAgentNode = z
  .object({ ...Base, type: z.literal('sub-agent'), goal: z.string().min(1), tools: z.array(z.string()).optional() })
  .strict()
export const HumanApprovalNode = z
  .object({ ...Base, type: z.literal('human-approval'), message: z.string().min(1) })
  .strict()

export const DagNode = z.discriminatedUnion('type', [AgentStepNode, ToolNode, SubAgentNode, HumanApprovalNode])
export type DagNode = z.infer<typeof DagNode>

export const DagSpec = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** 每个 agent-step 节点的用量上限（PRD-M7-009） */
    budget: z
      .object({
        tokens: z.number().int().positive().optional(),
        costUsd: z.number().positive().optional(),
        toolCalls: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    nodes: z.array(DagNode).min(1),
  })
  .strict()
export type DagSpec = z.infer<typeof DagSpec>

export class DagSpecError extends Error {
  constructor(message: string) {
    super(`任务定义有问题：${message}`)
    this.name = 'DagSpecError'
  }
}

/** 拓扑序（Kahn）。同层按声明顺序——执行顺序要能从文件里一眼看出来 */
export function topoOrder(spec: DagSpec): string[] {
  const ids = spec.nodes.map((n) => n.id)
  const indeg = new Map(ids.map((id) => [id, 0]))
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const n of spec.nodes) {
    for (const d of n.needs) {
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1)
      out.get(d)?.push(n.id)
    }
  }
  const order: string[] = []
  const ready = ids.filter((id) => indeg.get(id) === 0)
  while (ready.length > 0) {
    const id = ready.shift() as string
    order.push(id)
    for (const next of out.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1)
      if (indeg.get(next) === 0) {
        // 保持声明顺序
        const pos = ids.indexOf(next)
        const at = ready.findIndex((r) => ids.indexOf(r) > pos)
        if (at < 0) ready.push(next)
        else ready.splice(at, 0, next)
      }
    }
  }
  return order
}

/** 校验：id 唯一、needs 都存在、没有环（AC-2） */
export function validateSpec(raw: unknown): DagSpec {
  const parsed = DagSpec.safeParse(raw)
  if (!parsed.success) {
    throw new DagSpecError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const spec = parsed.data
  const ids = new Set<string>()
  for (const n of spec.nodes) {
    if (ids.has(n.id)) throw new DagSpecError(`节点 id 重复：${n.id}`)
    ids.add(n.id)
  }
  for (const n of spec.nodes) {
    for (const d of n.needs) {
      if (!ids.has(d)) throw new DagSpecError(`节点 ${n.id} 依赖的 ${d} 不存在`)
      if (d === n.id) throw new DagSpecError(`节点 ${n.id} 依赖了自己`)
    }
  }
  const order = topoOrder(spec)
  if (order.length !== spec.nodes.length) {
    const stuck = spec.nodes.map((n) => n.id).filter((id) => !order.includes(id))
    throw new DagSpecError(`依赖成环，涉及：${stuck.join('、')}`)
  }
  return spec
}

export function parseDagYaml(text: string): DagSpec {
  let raw: unknown
  try {
    raw = Bun.YAML.parse(text)
  } catch (e) {
    throw new DagSpecError(`YAML 读不懂：${e instanceof Error ? e.message : String(e)}`)
  }
  return validateSpec(raw)
}
