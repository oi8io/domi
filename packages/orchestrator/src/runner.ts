/**
 * 执行循环 —— PRD-M5-002 / 003 · docs/adr/020
 *
 * orchestrator 不碰 IO：事件的读写、四种节点怎么执行，全部由调用方注入。
 * 循环本身只做一件事：读状态 → 挑下一个节点 → 落 started → 执行 → 落 done/failed → 再来。
 * 每一步之前都重读事件，所以任何时刻被杀，重启后重放事件就知道停在哪（AC-1）。
 */
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import type { DagNode } from './spec.ts'
import { finalStatus, nextNode, type RunState, runState } from './state.ts'

export interface NodeResult {
  ok: boolean
  /** 给下游与给人看的一段话。不放大块内容：工具结果只留摘要 */
  output?: string
  error?: string
  sessionId?: string
}

export interface NodeContext {
  runId: string
  attempt: number
  /** 它依赖的节点的输出，按依赖声明顺序 */
  inputs: Array<{ nodeId: string; output: string }>
  cwd?: string
  signal: AbortSignal
  /** 运行定义里的用量上限（M7-009） */
  budget?: { tokens?: number | undefined; costUsd?: number | undefined; toolCalls?: number | undefined }
}

export type NodeExecutor = (node: DagNode, ctx: NodeContext) => Promise<NodeResult>

export interface RunnerDeps {
  read(runId: string): Promise<readonly EventEnvelope[]>
  append(runId: string, evs: DomiEvent[]): Promise<unknown>
  execute: NodeExecutor
  now(): number
  /** 每落一批事件之后调（通知、推送用）。抛错不影响运行 */
  onEvent?(runId: string, evs: readonly DomiEvent[], state: RunState): void
}

async function emit(deps: RunnerDeps, runId: string, evs: DomiEvent[]): Promise<RunState> {
  await deps.append(runId, evs)
  const st = runState(await deps.read(runId))
  try {
    deps.onEvent?.(runId, evs, st)
  } catch {
    // 旁路，不影响运行
  }
  return st
}

/** 跑到没有可跑的节点为止。已结束的运行直接返回 */
export async function drive(deps: RunnerDeps, runId: string, signal: AbortSignal): Promise<RunState> {
  let st = runState(await deps.read(runId))
  if (!st.spec) {
    if (st.status === 'running') st = await emit(deps, runId, [{ t: 'task.end', status: 'failed' }])
    return st
  }
  if (st.status !== 'running') return st

  for (;;) {
    if (signal.aborted) return st
    const id = nextNode(st)
    if (id === null) {
      const fin = finalStatus(st)
      if (fin !== null) st = await emit(deps, runId, [{ t: 'task.end', status: fin }])
      return st
    }
    const node = st.spec?.nodes.find((n) => n.id === id) as DagNode
    const attempt = (st.nodes[id]?.attempt ?? 0) + 1
    st = await emit(deps, runId, [{ t: 'task.node', nodeId: id, status: 'started', attempt }])
    const t0 = deps.now()
    let r: NodeResult
    try {
      r = await deps.execute(node, {
        runId,
        attempt,
        inputs: node.needs.map((d) => ({ nodeId: d, output: st.nodes[d]?.output ?? '' })),
        ...(st.cwd === undefined ? {} : { cwd: st.cwd }),
        ...(st.spec?.budget === undefined ? {} : { budget: st.spec.budget }),
        signal,
      })
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (signal.aborted) return st
    st = await emit(deps, runId, [
      {
        t: 'task.node',
        nodeId: id,
        status: r.ok ? 'done' : 'failed',
        attempt,
        ms: Math.max(0, deps.now() - t0),
        ...(r.output === undefined ? {} : { output: r.output.slice(0, 4000) }),
        ...(r.error === undefined ? {} : { error: r.error.slice(0, 2000) }),
        ...(r.sessionId === undefined ? {} : { sessionId: r.sessionId }),
      },
    ])
  }
}

/** 重启后接着跑（M5-003）：落一条 task.resume，写明恢复点与要重跑的节点 */
export async function resume(deps: RunnerDeps, runId: string, signal: AbortSignal): Promise<RunState | null> {
  const st = runState(await deps.read(runId))
  if (st.status !== 'running' || !st.spec) return null
  const completed = st.order.filter((id) => st.nodes[id]?.status === 'done')
  const rerun = st.order.filter((id) => st.nodes[id]?.status === 'running')
  await emit(deps, runId, [{ t: 'task.resume', completed, rerun }])
  return drive(deps, runId, signal)
}

export class RetryError extends Error {}

/** 只重跑一个失败节点（及其被挡住的下游）；已完成的不动（M5-002 AC-4） */
export async function retry(deps: RunnerDeps, runId: string, nodeId: string, signal: AbortSignal): Promise<RunState> {
  const st = runState(await deps.read(runId))
  const n = st.nodes[nodeId]
  if (!n) throw new RetryError(`没有节点 ${nodeId}`)
  if (n.status !== 'failed') throw new RetryError(`节点 ${nodeId} 现在是 ${n.status}，只有失败的节点能重试`)
  await emit(deps, runId, [{ t: 'task.retry', nodeId }])
  return drive(deps, runId, signal)
}
