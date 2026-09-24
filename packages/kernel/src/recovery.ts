/**
 * 一致点 —— PRD-M3-002 AC-3 · TASK-M3-010
 *
 * 进程可能在一轮的任何位置被 kill -9：模型还在吐字、工具正在跑、工具跑完但下一次请求还没发。
 * 事件是整批落盘的（loop 在流结束后才 append），所以磁盘上不会有半批模型输出；
 * 会不一致的只有两处：
 *   1. 有 tool.call 没有 tool.result —— 喂给模型会被拒（tool_use 必须配 tool_result）
 *   2. 这一轮没有结束标记 —— 界面上看起来「还在跑」，其实没人在跑
 *
 * 恢复 = **只追加**几条事件把这两处补上（INV-01）。不自动接着跑：
 * 工具可能已经执行了一半，要不要再来一次是人的决定，不是重启脚本的决定。
 *
 * 纯函数（INV-02）：同一段事件流必然得出同一个判断。
 */
import { type DomiEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'

export interface TurnState {
  /** 最后一轮开始了但没有结束标记 */
  open: boolean
  /** 没有结果的工具调用，按出现顺序 */
  danglingCalls: Array<{ id: string; name: string }>
}

/** 这些 error 表示「这一轮到此为止」。其余 scope（compact / mcp …）只是轨迹上的提示 */
const TERMINAL_ERROR_SCOPES = new Set(['loop', 'recovery'])

export function turnState(events: readonly EventEnvelope[]): TurnState {
  let open = false
  const pending: Array<{ id: string; name: string }> = []
  for (const { ev } of events) {
    if (!isKnownEvent(ev)) continue
    switch (ev.t) {
      case 'user.input':
        open = true
        break
      // 一次模型请求的输出是整批落盘的：没有 tool.call 的一批就是这一轮的最后一批
      case 'model.request':
        open = false
        break
      case 'tool.call':
        open = true
        pending.push({ id: ev.id, name: ev.name })
        break
      case 'tool.result': {
        // 同一个 id 可能出现不止一次（有的 provider 会复用），按次数配对
        const i = pending.findIndex((c) => c.id === ev.id)
        if (i >= 0) pending.splice(i, 1)
        break
      }
      case 'error':
        if (TERMINAL_ERROR_SCOPES.has(ev.scope)) open = false
        break
      default:
        break
    }
  }
  return { open, danglingCalls: pending }
}

/** 没来得及跑的调用的结果。loop 在上限处停下时也用它（BUG-M3-014） */
export function notRunResult(id: string, why: string): DomiEvent {
  return { t: 'tool.result', id, ok: false, payload: { error: `没有执行：${why}` }, ms: 0, reason: 'not_run' }
}

/** 被用户中断、没来得及跑的调用的结果（PRD-M13-002 AC-3） */
export function interruptedResult(id: string): DomiEvent {
  return {
    t: 'tool.result',
    id,
    ok: false,
    payload: { error: '本轮被用户中断，没有执行。' },
    ms: 0,
    reason: 'interrupted',
  }
}

/** 补到一致点需要追加的事件。已经一致时返回空数组——可以放心地每次打开会话都调一遍 */
export function recoveryEvents(events: readonly EventEnvelope[]): DomiEvent[] {
  const s = turnState(events)
  const out: DomiEvent[] = s.danglingCalls.map((c) => ({
    t: 'tool.result' as const,
    id: c.id,
    ok: false,
    payload: {
      error: `${c.name} 执行期间进程退出了，没有拿到结果。它可能已经执行了一部分，再次执行前先确认当前状态。`,
    },
    ms: 0,
    reason: 'interrupted',
  }))
  if (s.open || out.length > 0) {
    out.push({
      t: 'error',
      scope: 'recovery',
      message:
        '这一轮没有正常结束（进程中途退出，或者是从一轮的中间分出来的）。' +
        (s.danglingCalls.length > 0 ? `${s.danglingCalls.length} 个工具调用没有结果，已标为中断。` : '') +
        '想接着做就再说一句。',
      recoverable: true,
    })
  }
  return out
}
