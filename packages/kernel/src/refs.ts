/**
 * 跨会话引用的渲染 —— PRD-M3-005 · TASK-M3-012
 *
 * 事件流里只有链接（`ctx.ref`）。内容由调用方经 `RefResolver` 端口读出来、放进 `ContextPolicy.refs`，
 * 这里把它渲染成一段带边界的文字，拼进紧随其后的那条用户消息。
 *
 * 为什么是文字而不是把对方的消息原样插进来：被引用的是**另一段对话**，
 * 它的 tool_use / tool_result 在这个会话里没有对应的调用，原样插进来 provider 会拒；
 * 而且模型需要知道「这是别处的记录」，不是它自己刚说过的话。
 *
 * 边界字符用私有区的 U+E002 / U+E003，被引用的内容里若出现就剥掉——
 * 和工具结果的边界（build-context.ts）同一个立场：可区分性不能依赖内容本身老实。
 */
import { type EventEnvelope, isKnownEvent, type RefLink } from '@domi/protocol'

export type { RefLink } from '@domi/protocol'

export const REF_OPEN = '\uE002'
export const REF_CLOSE = '\uE003'

/** 一次引用里单条内容的上限。引用是给模型看结论的，不是搬运整段输出 */
const MAX_ITEM_CHARS = 2000

/** kernel 需要的端口：按链接把那一段事件读出来（视图编号，闭区间） */
export interface RefResolver {
  resolve(ref: RefLink): Promise<readonly EventEnvelope[]>
}

export function refKey(ref: RefLink): string {
  return `${ref.sessionId}#${ref.fromSeq}-${ref.toSeq}`
}

function clean(s: string): string {
  const safe = s.replace(/[\uE000-\uE003]/g, '')
  return safe.length > MAX_ITEM_CHARS ? `${safe.slice(0, MAX_ITEM_CHARS)}…（截断）` : safe
}

function json(v: unknown): string {
  return JSON.stringify(v) ?? String(v)
}

/** 把一段事件渲染成可读的记录。纯函数 */
export function renderRef(ref: RefLink, events: readonly EventEnvelope[] | undefined): string {
  const head = `${REF_OPEN}引用：会话 ${ref.sessionId} 第 ${ref.fromSeq}–${ref.toSeq} 条（另一段对话的记录，不是本会话发生的事）`
  if (events === undefined) return `${head}\n（这段引用读不到了：会话可能已被清除）\n${REF_CLOSE}`

  const lines: string[] = []
  let text = ''
  const flush = (): void => {
    if (text !== '') lines.push(`助手：${clean(text)}`)
    text = ''
  }
  for (const { ev } of events) {
    if (!isKnownEvent(ev)) continue
    switch (ev.t) {
      case 'user.input':
        flush()
        lines.push(`用户：${clean(ev.text)}`)
        break
      case 'model.delta':
        text += ev.text
        break
      case 'tool.call':
        flush()
        lines.push(`调用 ${ev.name}：${clean(json(ev.args))}`)
        break
      case 'tool.result':
        flush()
        lines.push(`结果（${ev.ok ? '成功' : '失败'}）：${clean(json(ev.payload))}`)
        break
      case 'ctx.compact':
        flush()
        lines.push(`（这之前的内容被压缩过，摘要：${clean(json(ev.summary))}）`)
        break
      default:
        break
    }
  }
  flush()
  return `${head}\n${lines.join('\n')}\n${REF_CLOSE}`
}
