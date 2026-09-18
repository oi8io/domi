/**
 * 轨迹投影 —— PRD-M8-008 AC-3 · SPEC-M8-008
 *
 * 把 TranscriptItem 按轮分组、贴上六类标签，并从事件时间戳投影出三行时间线（输入 / 模型 / 工具）。
 * 纯函数：不读时钟、不碰 IO；`ts` 缺失（老 daemon 推的事件没进过 store）时没有时间线。
 */
import type { TranscriptItem } from './store.ts'

export type TrajTag = 'system' | 'context' | 'user' | 'assistant' | 'tool' | 'permission'

export interface TrajRow {
  seq: number
  tag: TrajTag
  text: string
  mono: boolean
  failed: boolean
  /** 耗时（毫秒）：工具调用与思考段有 */
  ms?: number
}

export interface TrajTurn {
  index: number
  rows: TrajRow[]
}

/** 时间线上的一段，位置是相对整段轨迹的百分比（0–100） */
export interface TrajSpan {
  label: string
  /** 起点百分比 */
  left: number
  /** 宽度百分比，至少 0.8 才画得出来 */
  width: number
}

export interface TrajTimeline {
  start: number
  end: number
  input: TrajSpan[]
  model: TrajSpan[]
  tools: TrajSpan[]
}

const TAG: Record<TranscriptItem['kind'], TrajTag> = {
  user: 'user',
  assistant: 'assistant',
  reason: 'assistant',
  'tool-call': 'tool',
  'tool-result': 'tool',
  permission: 'permission',
  error: 'system',
  context: 'context',
  task: 'system',
}

export function trajectoryTurns(items: readonly TranscriptItem[]): TrajTurn[] {
  const turns: TrajTurn[] = []
  let current: TrajTurn | null = null
  for (const it of items) {
    if (it.kind === 'user' || current === null) {
      current = { index: turns.length + 1, rows: [] }
      turns.push(current)
    }
    const last = current.rows[current.rows.length - 1]
    // 工具结果并到调用那一行：`fs.read {…} → 结果`
    if (it.kind === 'tool-result' && last?.tag === 'tool' && !last.text.includes(' → ')) {
      last.text = `${last.text} → ${it.summary ?? it.text}`
      last.failed = it.ok === false
      if (it.ms !== undefined) last.ms = it.ms
      continue
    }
    const text = it.kind === 'tool-call' ? `${it.text} ${it.summary ?? ''}`.trim() : it.text
    current.rows.push({
      seq: it.seq,
      tag: TAG[it.kind],
      text:
        it.summary !== undefined && it.kind !== 'tool-call' && it.kind !== 'tool-result'
          ? `${text} · ${it.summary}`
          : text,
      mono: it.kind === 'tool-call' || it.kind === 'tool-result',
      failed: it.kind === 'error' || it.ok === false,
      ...(it.kind === 'reason' && it.ms !== undefined ? { ms: it.ms } : {}),
    })
  }
  return turns
}

export function filterTurns(turns: readonly TrajTurn[], mode: 'turns' | 'calls', query: string): TrajTurn[] {
  const q = query.trim().toLowerCase()
  return turns
    .map((t) => ({
      ...t,
      rows: t.rows.filter(
        (r) => (mode === 'turns' || r.tag === 'tool') && (q === '' || r.text.toLowerCase().includes(q)),
      ),
    }))
    .filter((t) => t.rows.length > 0)
}

/**
 * 三行时间线：
 * - 输入：一条用户输入到它之后第一条模型 / 工具事件之间（人在打字、模型还没动）
 * - 模型：思考与回答两类片段各自的跨度（流式增量的第一条到最后一条）
 * - 工具：调用到结果（耗时来自 tool.result 的 ms；没有 ms 就用下一条事件的时间）
 * 没有时间戳（老事件）或整段跨度为 0 时返回 null。
 */
export function trajectoryTimeline(items: readonly TranscriptItem[]): TrajTimeline | null {
  const withTs = items.filter((i) => typeof i.ts === 'number')
  if (withTs.length < 2) return null
  const start = withTs[0]?.ts as number
  const last = withTs[withTs.length - 1] as TranscriptItem
  const end = Math.max((last.ts as number) + (last.ms ?? 0), start + 1)
  const total = end - start
  const span = (label: string, from: number, to: number): TrajSpan => ({
    label,
    left: ((from - start) / total) * 100,
    width: Math.max(((Math.max(to, from) - from) / total) * 100, 0.8),
  })
  const timeline: TrajTimeline = { start, end, input: [], model: [], tools: [] }
  for (let i = 0; i < withTs.length; i++) {
    const it = withTs[i] as TranscriptItem
    const at = it.ts as number
    const next = withTs[i + 1]?.ts ?? end
    switch (it.kind) {
      case 'user':
        timeline.input.push(span(it.text.slice(0, 40), at, next))
        break
      case 'reason':
      case 'assistant':
        timeline.model.push(span(it.kind === 'reason' ? '思考' : '回答', at, at + (it.ms ?? next - at)))
        break
      case 'tool-call':
        timeline.tools.push(span(it.text, at, it.ms === undefined ? next : at + it.ms))
        break
      case 'tool-result': {
        // 结果自带耗时：把它挂在前一段工具上（trajectoryTurns 那边也是这么并的）
        const t = timeline.tools[timeline.tools.length - 1]
        if (t && it.ms !== undefined) t.width = Math.max((it.ms / total) * 100, 0.8)
        break
      }
      default:
        break
    }
  }
  return timeline
}

export function trajectory(items: readonly TranscriptItem[]): { turns: TrajTurn[]; timeline: TrajTimeline | null } {
  return { turns: trajectoryTurns(items), timeline: trajectoryTimeline(items) }
}
