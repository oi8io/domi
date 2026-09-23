/**
 * PRD-M11-009 · 会话窗口化加载：按轮尾部分页。
 *
 * 纯函数，不读时钟、不读配置。服务端算权重（它有全量事件），客户端只展示。
 *
 * - 轮的边界 = `user.input` 事件；一轮 = 一个 user.input 到下一个 user.input（不含）的所有事件
 * - 预算主单位 = 估算渲染行数（视口行数 × 系数）；事件数兜底
 * - 从尾部往前累加，到预算就停；不拆轮；最少 1 轮（不白页）
 * - beforeSeq 只考虑 view seq < beforeSeq 的事件（向上翻页锚点）
 */
import { isKnownEvent, type AnyEvent, type DomiEvent, type EventEnvelope } from '@domi/protocol'

export interface PageBudget {
  /** 主预算：估算渲染行数。到了就停。 */
  maxLines: number
  /** 兜底：事件数上限。防单轮超大事件流拖慢单页。 */
  maxEvents?: number
}

export interface EventPage {
  /** 本页事件，seq 升序 */
  events: EventEnvelope[]
  /** 本页最老事件的 view seq */
  fromSeq: number
  /** 本页最新事件的 view seq */
  toSeq: number
  /** 本页之前还有没有更早的轮（false = 已经到头） */
  hasOlder: boolean
  /** 本页估算行数（诊断用，让客户端知道自己大概装了多少屏） */
  estimatedLines: number
}

function payloadLen(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'string') return v.length
  try {
    return JSON.stringify(v).length
  } catch {
    return String(v).length
  }
}

/** 估算一个事件在 UI 上占多少渲染行。markdown 文本按 80 字符一行估；工具事件给固定下限。 */
export function weightLines(ev: AnyEvent): number {
  if (!isKnownEvent(ev)) return 0
  switch (ev.t) {
    case 'user.input':
      return Math.max(1, Math.ceil((ev.text ?? '').length / 80))
    case 'model.delta':
    case 'model.reason':
      return Math.max(0, Math.ceil((ev.text ?? '').length / 80))
    case 'tool.call':
      // 一行名字 + 两行参数预览，最少 3 行
      return Math.max(3, Math.ceil(payloadLen(ev.args) / 80))
    case 'tool.result':
      return Math.max(2, Math.ceil(payloadLen(ev.payload) / 80))
    default:
      // model.request / model.usage / fs.snapshot / permission / system 这类不渲染或折叠，不计
      return 0
  }
}

/**
 * 把事件流（view seq 升序）按轮切段。每段尾部包一个 user.input（最老段可能没有）。
 * 返回的轮数组按 seq 升序（第 0 轮是最老的）。
 */
export function splitIntoTurns(events: readonly EventEnvelope[]): EventEnvelope[][] {
  const turns: EventEnvelope[][] = []
  let cur: EventEnvelope[] = []
  for (const env of events) {
    if (isKnownEvent(env.ev) && env.ev.t === 'user.input' && cur.length > 0) {
      turns.push(cur)
      cur = []
    }
    cur.push(env)
  }
  if (cur.length > 0) turns.push(cur)
  return turns
}

/**
 * 从尾部往前选轮，直到累计估算行数 ≥ budget.maxLines。
 * - beforeSeq 给定时，只考虑 view seq < beforeSeq 的事件
 * - 不拆轮：整轮返回
 * - 最少 1 轮（即使预算是 0，也至少给最老的那轮）
 * - 短会话（总权重 < 预算）全量返回
 */
export function paginateByTurns(
  events: readonly EventEnvelope[],
  opts: { beforeSeq?: number; budget: PageBudget },
): EventPage {
  const { beforeSeq, budget } = opts
  const pool = beforeSeq === undefined ? events : events.filter((e) => e.seq < beforeSeq)
  if (pool.length === 0) {
    return { events: [], fromSeq: 0, toSeq: beforeSeq ?? 0, hasOlder: false, estimatedLines: 0 }
  }

  const turns = splitIntoTurns(pool)
  const maxEvents = budget.maxEvents ?? Number.POSITIVE_INFINITY

  // 从最后一轮往前累加
  let picked: EventEnvelope[] = []
  let lines = 0
  let eventCount = 0
  let i = turns.length - 1
  for (; i >= 0; i--) {
    const t = turns[i]!
    const tLines = t.reduce((sum, e) => sum + weightLines(e.ev), 0)
    const tEvents = t.length
    // 最少 1 轮：即使预算是 0 也先塞最老的那轮（在循环里第一次必然塞）
    if (picked.length > 0 && (lines + tLines > budget.maxLines || eventCount + tEvents > maxEvents)) {
      break
    }
    picked = [...t, ...picked]
    lines += tLines
    eventCount += tEvents
  }

  // 兜底：预算给得太小导致一轮都没选上（理论上不会，因为 picked.length>0 才检查；这里再保险一次）
  if (picked.length === 0) {
    const last = turns[turns.length - 1]!
    picked = last
    lines = last.reduce((sum, e) => sum + weightLines(e.ev), 0)
  }

  const fromSeq = picked[0]!.seq
  const toSeq = picked[picked.length - 1]!.seq
  // hasOlder：选中段前面还有事件吗
  const pickedIdx = pool.indexOf(picked[0]!)
  const hasOlder = pickedIdx > 0

  return { events: picked, fromSeq, toSeq, hasOlder, estimatedLines: lines }
}
