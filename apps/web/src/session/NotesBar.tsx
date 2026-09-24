/**
 * 排队中的补充 —— PRD-M13-001 AC-5 / AC-6（SPEC-M13-001 取舍-6）
 *
 * 会话在跑时，发出去的补充先排在 daemon 的队列里，下一步开始前送达。
 * 这里把队列摆出来（所有端发的都在），每条可以撤回；送达后它会以「补充」气泡出现在对话里。
 */
import type { QueuedNoteView } from '@domi/client-core'
import { tr } from '@domi/i18n'

export function NotesBar({
  notes,
  onWithdraw,
}: {
  notes: readonly QueuedNoteView[]
  onWithdraw: (id: string) => void
}) {
  if (notes.length === 0) return null
  return (
    <div className="mb-1.5 rounded-md border border-border2 bg-panel px-3 py-1.5 text-xs" data-view="notes">
      <div className="text-mut">{tr('web.notes.queued', { n: notes.length })}</div>
      <ul className="mt-1 space-y-0.5">
        {notes.map((n) => (
          <li key={n.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ink2">{n.text}</span>
            <button
              type="button"
              className="shrink-0 text-mut2 underline decoration-dotted underline-offset-2 hover:text-accent"
              data-action="withdraw-note"
              onClick={() => onWithdraw(n.id)}
            >
              {tr('web.notes.withdraw')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
