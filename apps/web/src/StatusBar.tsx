/**
 * 状态栏 —— PRD-M1-007 · PRD-M8-008 AC-2（原型的紧凑 pill）。
 * 与 TUI 显示同样的几段、同样的格式（formatTokens 在 client-core）。
 * 一个数都不自己算：指标由 runtime 算好，经 session.metrics 推过来。
 */
import { type ConnectionState, formatElapsed, formatTokens, type StatusSnapshot, VERIFY_LABEL } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { IconClock, IconDatabase, IconMoon, IconSun } from './icons.tsx'
import { STATE_LABEL } from './layout/Sidebar.tsx'
import { cn } from './lib/cn.ts'
import { $systemDark, $themeChoice, resolveMode, toggleTheme } from './theme/store.ts'

const CTX_CLASS = { ok: '', warn: 'border-warn text-warn', danger: 'border-bad text-bad' } as const
const VERIFY_CLASS = { unverified: 'text-warn', verified: 'text-ok', failed: 'text-bad' } as const

export function ThemeToggle() {
  const choice = useStore($themeChoice)
  const dark = useStore($systemDark)
  const mode = resolveMode(choice, dark)
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-sm px-[9px] py-1 text-mut hover:bg-panel-h hover:text-ink2"
      title={mode === 'dark' ? '切换到浅色' : '切换到深色'}
      aria-label="切换主题"
      onClick={toggleTheme}
    >
      {mode === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
    </button>
  )
}

export function StatusBar({ status, connection }: { status: StatusSnapshot; connection?: ConnectionState }) {
  const m = status.metrics
  const level = m?.contextLevel ?? 'ok'
  return (
    <div
      className="flex shrink-0 items-start gap-2.5 border-b border-border2 px-5 py-1.5 text-xs"
      data-part="statusbar"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        {connection !== undefined && (
          <span className="pill">
            <span className={cn('size-[7px] rounded-full', connection === 'open' ? 'bg-ok' : 'bg-warn')} />
            {STATE_LABEL[connection]}
          </span>
        )}
        <span className="pill font-mono">{status.model === '' ? '—' : `${status.provider}/${status.model}`}</span>
        <span className="pill">
          <IconClock size={12} className="opacity-60" />
          {m?.turnMs !== undefined && (
            <>
              本轮 <b>{formatElapsed(m.turnMs)}</b> ·{' '}
            </>
          )}
          <b>{status.toolCalls}</b> 次工具
        </span>
        <span className="pill">
          <IconDatabase size={12} className="opacity-60" />
          <b>{m === null ? '— tok' : formatTokens(m.tokens)}</b> · {m === null ? '—' : m.cost}
        </span>
        <span className={cn('pill', CTX_CLASS[level])} data-ctx={level}>
          ctx {m?.contextPercent ?? 0}%
        </span>
        {m?.mode === 'plan' && <span className="pill border-info bg-info-d text-info">计划模式</span>}
        {m?.verify !== undefined && m.verify !== 'clean' && (
          <span className={cn('pill', VERIFY_CLASS[m.verify])} data-verify={m.verify}>
            {VERIFY_LABEL[m.verify]}
          </span>
        )}
        {status.busy && (
          <span className="pill text-accent">
            <span className="size-[7px] animate-blink rounded-full bg-accent" />
            运行中
          </span>
        )}
      </div>
      <ThemeToggle />
    </div>
  )
}
