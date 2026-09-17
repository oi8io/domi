/**
 * Trajectory tab 的行模型 —— PRD-M8-008 AC-3。
 * 纯排版：把 TranscriptItem 按轮分组、贴上六类标签。时间线要事件时间戳，
 * 等 client-core 的 trajectory 投影（SPEC-M8-008）落地后接上；在那之前这里只做分组与标签。
 */
import type { TranscriptItem } from '@domi/client-core'

export type TrajTag = 'system' | 'context' | 'user' | 'assistant' | 'tool' | 'permission'

export interface TrajRow {
  seq: number
  tag: TrajTag
  text: string
  mono: boolean
  failed: boolean
}

export interface TrajTurn {
  index: number
  rows: TrajRow[]
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
