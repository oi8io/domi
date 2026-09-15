/**
 * 待发送的跨会话引用（PRD-M3-005）。在哪个会话里点的「引用这一轮」都会攒到这里，
 * 下一次发送时带上——引用本来就是为了在**另一个**会话里用。
 */
import type { RefLink } from '@domi/client-core'

export interface PendingRef extends RefLink {
  /** 给人看的：被引用那一轮的第一句话 */
  label: string
}

export function PendingRefs({ refs, onRemove }: { refs: readonly PendingRef[]; onRemove: (index: number) => void }) {
  if (refs.length === 0) return null
  return (
    <ul className="pending-refs">
      {refs.map((r, i) => (
        <li key={`${r.sessionId}#${r.fromSeq}`}>
          <span className="ref-source">引用 {r.sessionId}</span>
          <span className="ref-label">{r.label}</span>
          <button type="button" onClick={() => onRemove(i)}>
            去掉
          </button>
        </li>
      ))}
    </ul>
  )
}
