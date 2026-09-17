/**
 * 待发送的跨会话引用（PRD-M3-005）。在哪个会话里点的「引用这一轮」都会攒到这里，
 * 下一次发送时带上——引用本来就是为了在**另一个**会话里用。以 chip 显示在输入框上方（PRD-M8-010 AC-1）。
 */
import type { RefLink } from '@domi/client-core'
import { IconX } from './icons.tsx'

export interface PendingRef extends RefLink {
  /** 给人看的：被引用那一轮的第一句话 */
  label: string
}

export function PendingRefs({ refs, onRemove }: { refs: readonly PendingRef[]; onRemove: (index: number) => void }) {
  if (refs.length === 0) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {refs.map((r, i) => (
        <li
          key={`${r.sessionId}#${r.fromSeq}`}
          className="flex max-w-full items-center gap-1.5 rounded-xl border border-border bg-panel py-0.5 pr-1 pl-2.5 text-xs"
        >
          <span className="text-mut">引用 {r.sessionId}</span>
          <span className="max-w-[24em] truncate">{r.label}</span>
          <button
            type="button"
            className="inline-flex items-center rounded-sm p-0.5 text-mut hover:bg-panel-h hover:text-ink"
            onClick={() => onRemove(i)}
            title="去掉"
            aria-label="去掉"
          >
            <IconX size={11} />
            <span className="sr-only">去掉</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
