/**
 * 会话录制 —— PRD-M2-008 AC-1
 *
 * **这是事件流架构的直接红利**：真实会话本来就是完整记录的，
 * 录制不需要另外埋点，只是把事件流切成「每一轮模型吐了什么、工具回了什么」。
 * INV-13 要的「评估以事件流回放为唯一数据源」在这里落地。
 */
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'

export interface RecordedTurn {
  /** 这一轮模型吐出的东西，按原顺序 */
  model: Array<
    | { type: 'delta'; text: string }
    | { type: 'reason'; text: string }
    | { type: 'tool-call'; id: string; name: string; args: unknown }
    | { type: 'usage'; raw: Record<string, unknown> }
    | { type: 'error'; message: string; recoverable: boolean }
  >
}

export interface RecordedToolResult {
  id: string
  ok: boolean
  payload: unknown
  reason?: string
}

export interface Fixture {
  version: 1
  sessionId: string
  /** 用户在这一次会话里说的话，按顺序 */
  inputs: string[]
  turns: RecordedTurn[]
  toolResults: RecordedToolResult[]
  /** 期望的工具调用序列：名称 + 归一化后的参数（AC-2 的判据） */
  expectedCalls: Array<{ name: string; args: unknown }>
}

export function record(events: readonly EventEnvelope[], sessionId: string): Fixture {
  const inputs: string[] = []
  const turns: RecordedTurn[] = []
  const toolResults: RecordedToolResult[] = []
  const expectedCalls: Array<{ name: string; args: unknown }> = []

  let current: RecordedTurn | null = null

  for (const env of events) {
    const ev: AnyEvent = env.ev
    if (!isKnownEvent(ev)) continue

    switch (ev.t) {
      case 'user.input':
        inputs.push(ev.text)
        break
      case 'model.request':
        // 每个 model.request 开一轮
        current = { model: [] }
        turns.push(current)
        break
      case 'model.delta':
        current?.model.push({ type: 'delta', text: ev.text })
        break
      case 'model.reason':
        current?.model.push({ type: 'reason', text: ev.text })
        break
      case 'model.usage':
        current?.model.push({ type: 'usage', raw: ev.raw })
        break
      case 'tool.call':
        current?.model.push({ type: 'tool-call', id: ev.id, name: ev.name, args: ev.args })
        expectedCalls.push({ name: ev.name, args: ev.args })
        break
      case 'tool.result':
        toolResults.push(
          ev.reason === undefined
            ? { id: ev.id, ok: ev.ok, payload: ev.payload }
            : { id: ev.id, ok: ev.ok, payload: ev.payload, reason: ev.reason },
        )
        break
      case 'error':
        // loop 自己产生的终止事件不算模型输出；只有流错误才是
        if (ev.scope !== 'loop')
          current?.model.push({ type: 'error', message: ev.message, recoverable: ev.recoverable })
        break
      default:
        break
    }
  }

  return { version: 1, sessionId, inputs, turns, toolResults, expectedCalls }
}

export function serialize(f: Fixture): string {
  return `${JSON.stringify(f, null, 2)}\n`
}

export function parse(text: string): Fixture {
  const f = JSON.parse(text) as Fixture
  if (f.version !== 1) throw new Error(`不认识的 fixture 版本：${String(f.version)}`)
  return f
}
