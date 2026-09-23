/**
 * 「计划还剩 N 步 · /continue 接着做」—— PRD-M12-004 AC-10。显示条件与 Web 同一个（client-core 的 resumeHint）
 */
import { type AskSnapshot, resumeHint, type StatusSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Text } from 'ink'
import { useTheme } from '../theme.ts'

export function ResumeHint({ status, ask }: { status: StatusSnapshot; ask: AskSnapshot | null }) {
  const t = useTheme()
  const h = resumeHint(status, ask)
  if (h === null) return null
  const text = h.interrupted
    ? tr('core.plan.resumeInterrupted', { remaining: h.remaining, total: h.total })
    : tr('core.plan.resume', { remaining: h.remaining, total: h.total })
  return (
    <Text {...t.fg(h.interrupted ? 'warn' : 'mut')}>
      {`  ${text} · `}
      <Text {...t.fg('accent')}>{tr('tui.plan.resumeHint')}</Text>
    </Text>
  )
}
