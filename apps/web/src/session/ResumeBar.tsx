/**
 * 「计划还剩 N 步 · 继续」—— PRD-M12-004 AC-10（用户拍板：提示后一键续跑，不自动续跑）。
 * 显示条件由 client-core 的 resumeHint 定；点「继续」只是替用户说一句 continuePrompt，计划本身已经在上下文里
 */
import { type AskSnapshot, resumeHint, type StatusSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'

export function ResumeBar({
  status,
  ask,
  onContinue,
}: {
  status: StatusSnapshot
  ask: AskSnapshot | null
  onContinue: () => void
}) {
  const h = resumeHint(status, ask)
  if (h === null) return null
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[860px] items-center justify-between gap-3 rounded-md border px-3.5 py-1.5 text-[13px]',
        h.interrupted ? 'border-warn bg-warn-d text-warn' : 'border-border2 text-mut',
      )}
      data-part="resume"
      data-interrupted={h.interrupted ? 'true' : 'false'}
    >
      <span>
        {h.interrupted
          ? tr('core.plan.resumeInterrupted', { remaining: h.remaining, total: h.total })
          : tr('core.plan.resume', { remaining: h.remaining, total: h.total })}
      </span>
      <Button variant={h.interrupted ? 'primary' : 'outline'} size="xs" onClick={onContinue} data-action="continue">
        {tr('web.plan.continue')}
      </Button>
    </div>
  )
}
