/**
 * Trajectory tab —— PRD-M8-008 AC-3（原型 .traj-view）。
 */

import {
  filterTurns,
  formatElapsed,
  type TrajTag,
  type TrajTimeline,
  type TranscriptItem,
  trajectory,
} from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'

const TAG_CLASS: Record<TrajTag, string> = {
  system: 'bg-border2 text-mut',
  context: 'bg-ok-d text-ok',
  user: 'bg-accent-d text-accent',
  assistant: 'bg-info-d text-info',
  tool: 'bg-tool-d text-tool',
  permission: 'bg-warn-d text-warn',
}

const CHIP = 'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs text-mut hover:bg-panel-h'
const CHIP_ON = 'bg-accent-d font-medium text-accent hover:bg-accent-d'

/** 三行时间线（原型 .timeline）：输入、模型、工具各一行，条的位置按时间戳 */
export function Timeline({ timeline }: { timeline: TrajTimeline }) {
  const rows: Array<[string, TrajTimeline['input'], string]> = [
    ['Input', timeline.input, 'bg-accent'],
    ['Model', timeline.model, 'bg-info'],
    ['Tools', timeline.tools, 'bg-tool'],
  ]
  return (
    <div className="mb-4 overflow-hidden rounded-md border border-border2" data-part="timeline">
      {rows.map(([label, spans, color]) => (
        <div key={label} className="grid grid-cols-[70px_1fr] items-center border-b border-border2 last:border-b-0">
          <div className="px-2.5 py-2 font-mono text-[11px] text-mut">{label}</div>
          <div className="relative h-[22px] py-2">
            {spans.map((s) => (
              <span
                key={`${s.left}-${s.label}`}
                className={cn('absolute top-[7px] h-2 rounded-[2px] opacity-70', color)}
                style={{ left: `${s.left}%`, width: `${s.width}%` }}
                title={s.label}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-border2 px-2.5 py-1 text-right font-mono text-[10.5px] text-mut2">
        {tr('web.trajectory.total', { formatElapsed: formatElapsed(timeline.end - timeline.start) })}
      </div>
    </div>
  )
}

export function Trajectory({ items }: { items: readonly TranscriptItem[] }) {
  const [mode, setMode] = useState<'turns' | 'calls'>('turns')
  const [showTime, setShowTime] = useState(true)
  const [query, setQuery] = useState('')
  const { turns: all, timeline } = trajectory(items)
  const turns = filterTurns(all, mode, query)
  return (
    <div className="mx-auto max-w-[960px] px-6 py-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={cn(CHIP, showTime && timeline !== null && CHIP_ON)}
          disabled={timeline === null}
          title={timeline === null ? tr('web.trajectory.noTimestamps') : tr('web.trajectory.toggleTimeline')}
          onClick={() => setShowTime(!showTime)}
        >
          ◷ Duration
        </button>
        <button type="button" className={cn(CHIP, mode === 'turns' && CHIP_ON)} onClick={() => setMode('turns')}>
          ⊞ Turns
        </button>
        <button type="button" className={cn(CHIP, mode === 'calls' && CHIP_ON)} onClick={() => setMode('calls')}>
          ⊞ Calls
        </button>
        <input
          className="field-input ml-auto w-[200px] text-[12.5px]"
          placeholder={tr('common.searchEllipsis')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={tr('web.trajectory.search')}
        />
      </div>
      {showTime && timeline !== null && <Timeline timeline={timeline} />}
      {turns.length === 0 && <p className="py-8 text-center text-[13px] text-mut">{tr('web.trajectory.noMatch')}</p>}
      {turns.map((t) => (
        <section key={t.index} className="mb-1" data-turn={t.index}>
          <div className="pt-2 pb-1 font-mono text-[11px] text-mut2">Turn {t.index}</div>
          {t.rows.map((r) => (
            <div key={r.seq} className="flex items-start gap-2.5 rounded-sm px-2.5 py-[5px] hover:bg-panel-h">
              <span
                className={cn(
                  'mt-0.5 w-[84px] shrink-0 rounded px-2 py-px text-center text-[10.5px] font-semibold uppercase',
                  TAG_CLASS[r.tag],
                )}
                data-tag={r.tag}
              >
                {r.tag}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] leading-normal text-ink2',
                  r.mono && 'font-mono text-xs',
                  r.failed && 'text-bad',
                )}
                title={r.text}
              >
                {r.text}
              </span>
              {r.ms !== undefined && (
                <span className="shrink-0 font-mono text-[11px] text-mut2">{formatElapsed(r.ms)}</span>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
