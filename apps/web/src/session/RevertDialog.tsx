/**
 * 回到这一步之前 · 确认框（PRD-M14-010 / SPEC-M14-010 取舍-2）
 *
 * 三选一 scope（files / conversation / both）+ REVERT_SIDE_EFFECT_NOTICE 文案 +
 * 确认/取消。busy 时禁用确认（daemon 也会拒绝，端上先拦）。
 * 纯本地组件：不碰 store，由调用方持有 toSeq / busy / onConfirm。
 */
import { tr } from '@domi/i18n'
import { useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'

export type RevertScope = 'files' | 'conversation' | 'both'

const SCOPES: Array<{ id: RevertScope; label: string; hint: string }> = [
  { id: 'both', label: tr('web.revert.scopeBoth'), hint: tr('web.revert.scopeBothHint') },
  { id: 'files', label: tr('web.revert.scopeFiles'), hint: tr('web.revert.scopeFilesHint') },
  { id: 'conversation', label: tr('web.revert.scopeConversation'), hint: tr('web.revert.scopeConversationHint') },
]

export function RevertDialog({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean
  onConfirm: (scope: RevertScope) => void
  onCancel: () => void
}) {
  const [scope, setScope] = useState<RevertScope>('both')
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label={tr('web.revert.title')}
      data-part="revert-dialog"
    >
      <div className="w-[360px] rounded-lg border border-border2 bg-bg p-4 shadow-2xl">
        <h2 className="text-sm font-medium text-ink2">{tr('web.revert.title')}</h2>
        <p className="mt-1 text-xs text-mut">{tr('web.revert.scopeLabel')}</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={cn(
                'rounded border px-2.5 py-1.5 text-left transition-colors',
                scope === s.id ? 'border-accent bg-accent-d' : 'border-border2 hover:bg-panel-h',
              )}
              data-scope={s.id}
            >
              <span className="block text-xs font-medium text-ink2">{s.label}</span>
              <span className="block text-[11px] text-mut">{s.hint}</span>
            </button>
          ))}
        </div>
        <p
          className="mt-2.5 rounded bg-warn-d px-2 py-1.5 text-[11px] leading-relaxed text-warn"
          data-part="revert-notice"
        >
          {tr('web.revert.notice')}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={onCancel} data-action="revert-cancel">
            {tr('web.revert.cancel')}
          </Button>
          <Button
            variant="danger"
            size="xs"
            disabled={busy}
            onClick={() => onConfirm(scope)}
            data-action="revert-confirm"
          >
            {tr('web.revert.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
