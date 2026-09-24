/**
 * 排队中的补充 —— PRD-M13-001 AC-5（SPEC-M13-001 取舍-6）
 * 输入框上方一行：条数 + 最新一条的摘要。纯函数，测试直接调
 */
import type { QueuedNoteView } from '@domi/client-core'
import { tr } from '@domi/i18n'

export function notesLine(notes: readonly QueuedNoteView[]): string | null {
  const last = notes[notes.length - 1]
  if (last === undefined) return null
  const text = last.text.replace(/\s+/g, ' ')
  return `${tr('tui.notes.queued', { n: notes.length })} · ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`
}
