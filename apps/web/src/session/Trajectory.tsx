/**
 * Trajectory tab —— PRD-M8-008 AC-3（原型 .traj-view）。
 */
import type { TranscriptItem } from '@domi/client-core'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import { filterTurns, type TrajTag, trajectoryTurns } from './trajectory.ts'

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

export function Trajectory({ items }: { items: readonly TranscriptItem[] }) {
  const [mode, setMode] = useState<'turns' | 'calls'>('turns')
  const [query, setQuery] = useState('')
  const turns = filterTurns(trajectoryTurns(items), mode, query)
  return (
    <div className="mx-auto max-w-[960px] px-6 py-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-1">
        <button type="button" className={CHIP} disabled title="时间线需要事件时间投影，稍后提供">
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
          placeholder="搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索轨迹"
        />
      </div>
      {turns.length === 0 && <p className="py-8 text-center text-[13px] text-mut">没有匹配的步骤。</p>}
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
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
