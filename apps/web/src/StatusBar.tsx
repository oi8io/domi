/**
 * 状态栏 —— PRD-M1-007 · PRD-M8-008 AC-2（原型的紧凑 pill）。
 * 与 TUI 显示同样的几段、同样的格式（formatTokens 在 client-core）。
 * 一个数都不自己算：指标由 runtime 算好，经 session.metrics 推过来。
 *
 * v1.19：最多一行——不折行，放不下时只截断节奏段；模型与确认模式在输入框上，主题切换在侧栏设置右边，都不进状态栏
 */

import {
  type ConnectionState,
  formatContext,
  formatElapsed,
  formatTokens,
  type StatusSnapshot,
  VERIFY_LABEL,
} from '@domi/client-core'
import { tr } from '@domi/i18n'
import { IconClock, IconDatabase } from './icons.tsx'
import { STATE_LABEL } from './layout/Sidebar.tsx'
import { cn } from './lib/cn.ts'

const CTX_CLASS = { ok: '', warn: 'border-warn text-warn', danger: 'border-bad text-bad' } as const
const VERIFY_CLASS = { unverified: 'text-warn', verified: 'text-ok', failed: 'text-bad' } as const

export function StatusBar({
  status,
  connection,
  changes,
  onOpenChanges,
}: {
  status: StatusSnapshot
  connection?: ConnectionState
  /** M14 · +N −M（SPEC-M14-001 取舍-6）：改动合计；点它开右侧栏改动 tab */
  changes?: { added: number; removed: number; count: number } | undefined
  onOpenChanges?: () => void
}) {
  const m = status.metrics
  const level = m?.contextLevel ?? 'ok'
  return (
    <div
      className="flex shrink-0 items-center gap-2.5 overflow-hidden whitespace-nowrap border-b border-border2 px-5 py-1.5 text-xs"
      data-part="statusbar"
    >
      {connection !== undefined && (
        <span className="pill shrink-0">
          <span className={cn('size-[7px] rounded-full', connection === 'open' ? 'bg-ok' : 'bg-warn')} />
          {STATE_LABEL()[connection]}
        </span>
      )}
      <span className="pill min-w-0 truncate" data-pill="pace">
        <IconClock size={12} className="shrink-0 opacity-60" />
        <span className="min-w-0 truncate">
          {m?.turns !== undefined && (
            <>
              <b>{m.turns} turns</b> · {m.steps ?? 0} steps ·{' '}
            </>
          )}
          {m?.tokPerSec !== undefined && m.tokPerSec !== null && (
            <>
              <b>{m.tokPerSec} tok/s</b> ·{' '}
            </>
          )}
          {m?.turnMs !== undefined && <>{tr('web.status.turnElapsed', { formatElapsed: formatElapsed(m.turnMs) })}</>}
          {tr('web.status.toolCalls', { toolCalls: status.toolCalls })}
        </span>
      </span>
      <span className="pill shrink-0" data-pill="tokens">
        <IconDatabase size={12} className="opacity-60" />
        <b>{m === null ? '— tok' : formatTokens(m.tokens)}</b>
        {m?.cacheHitPercent !== undefined && m.cacheHitPercent !== null && (
          <>
            {' '}
            · Cache hit <b>{m.cacheHitPercent}%</b>
          </>
        )}{' '}
        · {m === null ? '—' : m.cost}
      </span>
      <span
        className={cn('pill shrink-0', CTX_CLASS[level])}
        data-pill="ctx"
        data-ctx={level}
        title={(m === null ? null : formatContext(m)) ?? undefined}
      >
        ctx {m?.contextPercent ?? 0}%
      </span>
      {m?.verify !== undefined && m.verify !== 'clean' && (
        <span className={cn('pill shrink-0', VERIFY_CLASS[m.verify])} data-verify={m.verify}>
          {VERIFY_LABEL[m.verify]}
        </span>
      )}
      {changes !== undefined && changes.count > 0 && (
        <button
          type="button"
          className="pill shrink-0 hover:bg-panel-h"
          data-action="open-changes"
          title={tr('web.changes.rangeTurn')}
          onClick={onOpenChanges}
        >
          <span className="text-ok">+{changes.added}</span>
          <span className="text-bad"> −{changes.removed}</span>
          <span className="ml-0.5 text-mut2">· {changes.count}</span>
        </button>
      )}
      {status.busy && (
        <span className="pill shrink-0 text-accent">
          <span className="size-[7px] animate-blink rounded-full bg-accent" />
          {tr('common.running')}
        </span>
      )}
    </div>
  )
}
