/**
 * 权限确认 —— 与 TUI 的 ConfirmDialog 同一个立场（PRD-M0-003 · INV-03）：
 * 显示**完整**的待执行内容；默认焦点在「拒绝」上，误按回车不等于同意。
 */
import type { AskSnapshot } from '@domi/client-core'

export function ConfirmDialog({ ask, onAnswer }: { ask: AskSnapshot; onAnswer: (allowed: boolean) => void }) {
  return (
    <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
      <p id="confirm-title" className="confirm-title">
        domi 想执行 <code>{ask.capabilityId}</code>，需要你确认
      </p>
      <pre className="confirm-detail">{ask.detail}</pre>
      <div className="confirm-actions">
        {/* biome-ignore lint/a11y/noAutofocus: 默认焦点必须在拒绝上，这是 fail-closed 在交互层的延续 */}
        <button type="button" className="deny" autoFocus onClick={() => onAnswer(false)}>
          拒绝
        </button>
        <button type="button" className="allow" onClick={() => onAnswer(true)}>
          允许
        </button>
      </div>
    </div>
  )
}
