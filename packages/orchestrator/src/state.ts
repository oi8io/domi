/**
 * 运行状态 = 事件的投影 —— PRD-M5-002 AC-3 · INV-01
 *
 * 纯函数：同一串事件必然得到同一个状态。daemon 重启后重放一遍就回到原处，不需要状态文件。
 */
import { type AnyEvent, isKnownEvent } from '@domi/protocol'
import { type DagSpec, topoOrder, validateSpec } from './spec.ts'

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

export interface NodeState {
  id: string
  status: NodeStatus
  attempt: number
  output?: string
  error?: string
  sessionId?: string
  ms?: number
}

export interface RunState {
  name: string
  spec: DagSpec | null
  cwd?: string
  nodes: Record<string, NodeState>
  /** 运行本身：还在跑 / 已结束 */
  status: 'running' | 'done' | 'failed' | 'cancelled'
  /** 声明顺序的拓扑序 */
  order: string[]
}

export function emptyRun(): RunState {
  return { name: '', spec: null, nodes: {}, status: 'running', order: [] }
}

export function runState(events: ReadonlyArray<{ ev: AnyEvent }>): RunState {
  const st = emptyRun()
  for (const { ev } of events) {
    if (!isKnownEvent(ev)) continue
    switch (ev.t) {
      case 'task.run': {
        st.name = ev.name
        if (ev.cwd !== undefined) st.cwd = ev.cwd
        try {
          st.spec = validateSpec(ev.spec)
          st.order = topoOrder(st.spec)
          for (const id of st.order) st.nodes[id] = { id, status: 'pending', attempt: 0 }
        } catch {
          st.spec = null
          st.status = 'failed'
        }
        break
      }
      case 'task.node': {
        const n = st.nodes[ev.nodeId]
        if (!n) break
        n.attempt = ev.attempt
        n.status = ev.status === 'started' ? 'running' : ev.status
        if (ev.sessionId !== undefined) n.sessionId = ev.sessionId
        if (ev.status === 'started') {
          delete n.output
          delete n.error
          delete n.ms
        }
        if (ev.output !== undefined) n.output = ev.output
        if (ev.error !== undefined) n.error = ev.error
        if (ev.ms !== undefined) n.ms = ev.ms
        break
      }
      case 'task.resume':
        // 中断时正在跑的节点回到 pending，交给 nextNode 重跑（ADR-020：至少一次）
        for (const id of ev.rerun) {
          const n = st.nodes[id]
          if (n && n.status === 'running') n.status = 'pending'
        }
        st.status = 'running'
        break
      case 'task.retry': {
        const n = st.nodes[ev.nodeId]
        if (n && n.status === 'failed') n.status = 'pending'
        st.status = 'running'
        break
      }
      case 'task.end':
        st.status = ev.status
        break
      default:
        break
    }
  }
  // 依赖失败的节点标成 blocked（投影出来的，不落事件）
  if (st.spec) {
    for (const id of st.order) {
      const n = st.nodes[id] as NodeState
      if (n.status !== 'pending') continue
      const node = st.spec.nodes.find((x) => x.id === id)
      if (node?.needs.some((d) => ['failed', 'blocked'].includes(st.nodes[d]?.status ?? ''))) n.status = 'blocked'
    }
  }
  return st
}

/** 下一个该跑的节点：依赖全部 done 的第一个 pending。没有就返回 null */
export function nextNode(st: RunState): string | null {
  if (!st.spec) return null
  for (const id of st.order) {
    const n = st.nodes[id]
    if (n?.status !== 'pending') continue
    const node = st.spec.nodes.find((x) => x.id === id)
    if (node?.needs.every((d) => st.nodes[d]?.status === 'done')) return id
  }
  return null
}

/** 所有节点都到头了（done / failed / blocked）时，这次运行的结论 */
export function finalStatus(st: RunState): 'done' | 'failed' | null {
  const all = Object.values(st.nodes)
  if (all.some((n) => n.status === 'pending' || n.status === 'running')) return null
  return all.every((n) => n.status === 'done') ? 'done' : 'failed'
}

/** 失败节点及其全部下游（重试时要重新打开的范围） */
export function downstreamOf(spec: DagSpec, nodeId: string): string[] {
  const out = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of spec.nodes) {
      if (!out.has(n.id) && n.needs.some((d) => out.has(d))) {
        out.add(n.id)
        grew = true
      }
    }
  }
  return [...out]
}
