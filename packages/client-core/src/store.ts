/**
 * 三端共享的状态投影 —— docs/adr/009
 *
 * **本包不 import react**（由 depcruise 规则 `no-react-in-client-core` 守）。
 * 理由见 ADR-009：消费方有四类，Telegram 桥接与 L1 回放评估都不是 React。
 *
 * 这里做的是**投影**，不是存储：事件流是唯一真相，atom 里的东西随时可以从
 * 事件流重算出来。所以任何"只在 atom 里、事件流里没有"的状态都是 bug。
 */
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'
import { atom, computed } from 'nanostores'

export interface TranscriptItem {
  seq: number
  kind: 'user' | 'assistant' | 'reason' | 'tool-call' | 'tool-result' | 'permission' | 'error' | 'context'
  text: string
  ok?: boolean
  /** 工具调用的参数摘要：JSON 序列化后前 80 字符 + …（PRD-M0-005 AC-1 写死的规则） */
  summary?: string
}

export interface MetricsSnapshot {
  tokens: { input: number; output: number; cacheRead: number }
  /** 已格式化的花费字符串；未知模型是 `—`，不是 $0（PRD-M1-007 AC-4） */
  cost: string
  contextPercent: number
  contextLevel: 'ok' | 'warn' | 'danger'
  unpricedModels: string[]
}

export interface StatusSnapshot {
  model: string
  provider: string
  busy: boolean
  toolCalls: number
  /** provider 返回的原始 usage，不做归一（ADR-004）。状态栏只挑它认识的字段显示 */
  lastUsage: Record<string, unknown> | null
  /**
   * 聚合指标。**由 runtime 算好推过来**，client-core 不自己算——
   * 算法在 packages/kernel/src/metrics.ts，三端共用同一份。
   */
  metrics: MetricsSnapshot | null
}

export interface AskSnapshot {
  capabilityId: string
  /** 完整的待执行内容，确认框必须显示它（PRD-M0-003 AC-1） */
  detail: string
}

export const ARG_SUMMARY_LIMIT = 80

export function summarizeArgs(args: unknown): string {
  const json = (() => {
    try {
      return JSON.stringify(args) ?? String(args)
    } catch {
      return String(args)
    }
  })()
  return json.length <= ARG_SUMMARY_LIMIT ? json : `${json.slice(0, ARG_SUMMARY_LIMIT)}…`
}

export function createSessionStore(initial: Partial<StatusSnapshot> = {}) {
  const $items = atom<TranscriptItem[]>([])
  const $status = atom<StatusSnapshot>({
    model: initial.model ?? '',
    provider: initial.provider ?? '',
    busy: false,
    toolCalls: 0,
    lastUsage: null,
    metrics: null,
  })
  const $ask = atom<AskSnapshot | null>(null)

  /** 最后一条 assistant 文本，流式增量往它上面拼 */
  const $streaming = computed($items, (items) => {
    const last = items[items.length - 1]
    return last?.kind === 'assistant' ? last.text : ''
  })

  function push(item: TranscriptItem): void {
    $items.set([...$items.get(), item])
  }

  function applyEvent(env: EventEnvelope): void {
    const ev: AnyEvent = env.ev
    if (!isKnownEvent(ev)) return
    switch (ev.t) {
      case 'user.input':
        push({ seq: env.seq, kind: 'user', text: ev.text })
        break
      case 'model.reason':
        push({ seq: env.seq, kind: 'reason', text: ev.text })
        break
      case 'model.delta': {
        const items = $items.get()
        const last = items[items.length - 1]
        if (last?.kind === 'assistant') {
          $items.set([...items.slice(0, -1), { ...last, text: last.text + ev.text }])
        } else {
          push({ seq: env.seq, kind: 'assistant', text: ev.text })
        }
        break
      }
      case 'tool.call':
        push({ seq: env.seq, kind: 'tool-call', text: ev.name, summary: summarizeArgs(ev.args) })
        $status.set({ ...$status.get(), toolCalls: $status.get().toolCalls + 1 })
        break
      case 'tool.result':
        push({
          seq: env.seq,
          kind: 'tool-result',
          text: ev.reason ?? (ev.ok ? 'ok' : 'failed'),
          ok: ev.ok,
          summary: summarizeArgs(ev.payload),
        })
        break
      case 'permission':
        push({
          seq: env.seq,
          kind: 'permission',
          text: `${ev.capabilityId} → ${ev.decision}`,
          ok: ev.decision === 'allow',
        })
        break
      // 上下文清理/压缩也要在对话里看得见（PRD-M2-002 AC-4 / M2-003 AC-4）。
      // 它们是**事件**，所以这里只是投影——不存在「只在 atom 里、事件流里没有」的状态
      case 'ctx.cleanup':
        push({
          seq: env.seq,
          kind: 'context',
          text: `上下文清理 ${ev.tokensBefore} → ${ev.tokensAfter} tokens`,
          summary: `去重 ${ev.saved.dedupe} · 截断 ${ev.saved.verbose} · 已解决错误 ${ev.saved.resolvedError} · 堆栈 ${ev.saved.stack}`,
        })
        break
      case 'ctx.compact':
        push({
          seq: env.seq,
          kind: 'context',
          text: `上下文已压缩 ${ev.tokensBefore} → ${ev.tokensAfter} tokens（保留最近 ${ev.keptTurns} 轮）`,
          summary: ev.summary.intent,
        })
        break
      case 'model.usage':
        $status.set({ ...$status.get(), lastUsage: ev.raw })
        break
      case 'error':
        push({ seq: env.seq, kind: 'error', text: ev.message, ok: false })
        break
      default:
        break
    }
  }

  return {
    $items,
    $status,
    $ask,
    $streaming,
    applyEvents(envelopes: EventEnvelope[]): void {
      for (const e of envelopes) applyEvent(e)
    },
    setBusy(busy: boolean): void {
      $status.set({ ...$status.get(), busy })
    },
    setAsk(ask: AskSnapshot | null): void {
      $ask.set(ask)
    },
    setMetrics(metrics: MetricsSnapshot | null): void {
      $status.set({ ...$status.get(), metrics })
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>

/**
 * 焦点归属 —— PRD-M0-005 AC-2 要断言「连续三次渲染后焦点仍在确认组件」。
 *
 * 做成**纯函数**而不是 Ink 的 useFocus，是为了能在没有 TTY 的地方断言它。
 * 真终端里键盘事件怎么送到组件是 apps/tui 的事；焦点归谁**是状态，不是交互**。
 */
export const FOCUS_INPUT = 'domi-input'
export const FOCUS_CONFIRM = 'domi-confirm'

export function focusIdOf(ask: AskSnapshot | null): string {
  return ask === null ? FOCUS_INPUT : FOCUS_CONFIRM
}

/**
 * 确认框的按键语义。返回 null 表示「这个键不是答案，忽略」——
 * **不能把未知按键当成同意**，这是 fail-closed 在交互层的延续（INV-03）。
 */
export function answerFromKey(input: string, key: { return?: boolean; escape?: boolean } = {}): boolean | null {
  if (key.escape) return false
  const c = input.trim().toLowerCase()
  if (c === 'y') return true
  if (c === 'n') return false
  // 回车不等于同意：默认拒绝
  if (key.return) return false
  return null
}
