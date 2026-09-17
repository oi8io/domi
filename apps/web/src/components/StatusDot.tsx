/**
 * 会话状态点 —— PRD-M8-009 AC-3：统一在左侧，运行 = 蓝色脉冲、未读 = 黄、其他 = 灰。
 */
import { cn } from '../lib/cn.ts'

export type DotState = 'running' | 'unread' | 'idle'

const LABEL: Record<DotState, string> = { running: '运行中', unread: '未读', idle: '' }

export function StatusDot({ state, className }: { state: DotState; className?: string }) {
  return (
    <span
      className={cn(
        'size-[7px] shrink-0 rounded-full',
        state === 'running' && 'animate-blink bg-accent',
        state === 'unread' && 'bg-warn',
        state === 'idle' && 'bg-border',
        className,
      )}
      data-state={state}
      title={LABEL[state] || undefined}
    />
  )
}
