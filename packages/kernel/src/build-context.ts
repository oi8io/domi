/**
 * 上下文拼装 —— SPEC-M0-002 · docs/spec/M0.md §3.5 · docs/adr/005
 *
 * **纯函数**：不读时钟、不读随机、不碰 IO（INV-02，由 dependency-cruiser 的
 * no-io-in-kernel 规则守）。这一点不是洁癖——M2 的压缩和 M2-008 的回放评估
 * 都建立在"同一事件流必然拼出同一份上下文"之上。
 *
 * 策略是 ContextPolicy 上的**可选项**，不是两套实现（ADR-005 的限定）：
 * M0 只实现 'full'，'incremental' 占位且调用即报错，**不静默降级**。
 */
import { type EventEnvelope, isKnownEvent, type ModelMessage, type ModelMessages, type ToolCall } from '@domi/protocol'

export type ContextStrategyName = 'full' | 'incremental' | (string & {})

export interface ContextPolicy {
  maxTokens: number
  includeReasoning: boolean
  /** 默认 'full'。见 SPEC-M0-002 / docs/adr/005 */
  strategy?: ContextStrategyName
}

export type ContextStrategy = (events: readonly EventEnvelope[], policy: ContextPolicy) => ModelMessages

const strategies = new Map<string, ContextStrategy>()

export function registerContextStrategy(name: string, fn: ContextStrategy): void {
  strategies.set(name, fn)
}

export function listContextStrategies(): readonly string[] {
  return [...strategies.keys()].sort()
}

/**
 * 全量拼装：每次遍历全部事件重建 messages。
 *
 * 只有四类事件进上下文：user.input / model.delta / tool.call / tool.result
 * （model.reason 由 policy 决定）。其余（model.request / model.usage /
 * permission / error）是**轨迹事件**——它们要被看见、被审计，但不该喂给模型。
 * 这条边界如果模糊掉，上下文会被自己的元数据撑爆。
 */
const fullStrategy: ContextStrategy = (events, policy) => {
  const out: ModelMessages = []
  let text = ''
  let calls: ToolCall[] = []

  const flush = (): void => {
    if (text === '' && calls.length === 0) return
    const msg: ModelMessage =
      calls.length > 0 ? { role: 'assistant', content: text, toolCalls: calls } : { role: 'assistant', content: text }
    out.push(msg)
    text = ''
    calls = []
  }

  for (const { ev } of events) {
    if (!isKnownEvent(ev)) continue
    switch (ev.t) {
      case 'user.input':
        flush()
        out.push({ role: 'user', content: ev.text })
        break
      case 'model.reason':
        if (policy.includeReasoning) text += ev.text
        break
      case 'model.delta':
        text += ev.text
        break
      case 'tool.call':
        calls.push({ id: ev.id, name: ev.name, args: ev.args })
        break
      case 'tool.result':
        flush()
        out.push({ role: 'tool', toolCallId: ev.id, ok: ev.ok, content: JSON.stringify(ev.payload) })
        break
      default:
        // model.request / model.usage / permission / error：轨迹事件，不进上下文
        break
    }
  }
  flush()
  return out
}

const incrementalPlaceholder: ContextStrategy = () => {
  throw new Error(
    "上下文拼装策略 'incremental' 在 M0 只是占位，没有实现。\n" +
      '这是 docs/adr/005 的限定：option 是注册点，不是两套实现——' +
      '在拿到真实会话的性能数据之前不写增量实现。\n' +
      "要么用 'full'，要么按 ADR-005 的『触发重新激活压测的条件』先补数据再实现。",
  )
}

registerContextStrategy('full', fullStrategy)
registerContextStrategy('incremental', incrementalPlaceholder)

/**
 * 粗估 token 数：字符数 / 4。
 * 故意粗糙——M0 不做压缩，这个数只用来在超长时**明确报错**而不是让模型 400。
 * 真正的计数在 M1 的状态栏（PRD-M1-004）接 provider 返回的 usage。
 */
function estimateTokens(msgs: ModelMessages): number {
  let chars = 0
  for (const m of msgs) chars += JSON.stringify(m).length
  return Math.ceil(chars / 4)
}

export function buildContext(events: readonly EventEnvelope[], policy: ContextPolicy): ModelMessages {
  const name = policy.strategy ?? 'full'
  const strategy = strategies.get(name)
  if (!strategy) {
    throw new Error(
      `未注册的上下文拼装策略 '${name}'。可用：${listContextStrategies().join(', ')}。\n` +
        '注意：不会静默回退到 full —— 配错了必须让你看见（PRD-M0-006 AC-4）。',
    )
  }

  const msgs = strategy(events, policy)
  const tokens = estimateTokens(msgs)
  if (tokens > policy.maxTokens) {
    throw new Error(
      `上下文约 ${tokens} tokens，超过 maxTokens=${policy.maxTokens}。\n` +
        'M0 不做压缩，超长直接报错（docs/PRD.md §M0 不做什么）。压缩见 M2 / PRD-M2-002。',
    )
  }
  return msgs
}
