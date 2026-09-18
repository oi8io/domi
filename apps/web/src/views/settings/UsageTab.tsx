/**
 * 设置 › 用量统计 —— PRD-M8-013（原型 .stat-grid + 按模型的柱状图）。
 * 数字全部由 daemon 从事件投影（usage.summary），这里一个都不算（INV-02 / INV-13）。
 * 未定价的模型花费显示「—」，不是 $0。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { Saved } from './fields.tsx'

type Usage = Awaited<ReturnType<DomiClient['usage']>>
type Range = 'month' | 'prev' | 'all'

const RANGES = (): Array<[Range, string]> => [
  ['month', tr('web.usage.thisMonth')],
  ['prev', tr('web.usage.lastMonth')],
  ['all', tr('common.all')],
]

/** 窗口按本地月份算（显示也按本地），左闭右开 */
export function rangeOf(r: Range, now: number): { from: number; to: number } {
  const d = new Date(now)
  const first = (y: number, m: number): number => new Date(y, m, 1).getTime()
  const y = d.getFullYear()
  const m = d.getMonth()
  if (r === 'month') return { from: first(y, m), to: first(y, m + 1) }
  if (r === 'prev') return { from: first(y, m - 1), to: first(y, m) }
  return { from: 0, to: first(y, m + 1) }
}

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

export const fmtCost = (c: number | null): string =>
  c === null ? '—' : c < 1 ? `$${c.toFixed(3)}` : `$${c.toFixed(2)}`

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'accent' | 'ok' | 'info' }) {
  return (
    <div className="rounded-md border border-border2 bg-panel px-3.5 py-3">
      <div
        className={cn(
          'text-xl font-bold tracking-[-0.02em]',
          tone === 'accent' && 'text-accent',
          tone === 'ok' && 'text-ok',
          tone === 'info' && 'text-info',
        )}
      >
        {value}
      </div>
      <div className="mt-px text-[11px] text-mut">{label}</div>
    </div>
  )
}

/** 按模型的横向柱（手写 SVG：条长按花费，没定价的按 token 数排在后面） */
export function ModelBars({ rows }: { rows: Usage['byModel'] }) {
  if (rows.length === 0) return <p className="text-[13px] text-mut">{tr('web.usage.none')}</p>
  const max = Math.max(...rows.map((r) => r.costUsd ?? 0), 0.000001)
  return (
    <div className="grid gap-1.5" data-part="usage-bars">
      {rows.map((r) => (
        <div
          key={`${r.provider}/${r.model}`}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2.5"
        >
          <span className="truncate font-mono text-[12px] text-ink2" title={`${r.provider}/${r.model}`}>
            {r.model}
          </span>
          <svg
            className="h-3.5 w-full"
            role="img"
            aria-label={tr('web.usage.modelSpend', { model: r.model, fmtCost: fmtCost(r.costUsd) })}
          >
            <title>
              {tr('web.usage.modelRow', {
                model: r.model,
                fmtCost: fmtCost(r.costUsd),
                fmtTokens: fmtTokens(r.tokens.input + r.tokens.output + r.tokens.cacheRead),
              })}
            </title>
            <rect x="0" y="2" width="100%" height="10" rx="3" fill="var(--border2)" />
            <rect
              x="0"
              y="2"
              width={`${Math.max(((r.costUsd ?? 0) / max) * 100, r.costUsd === null ? 0 : 1)}%`}
              height="10"
              rx="3"
              fill="var(--accent)"
            />
          </svg>
          <span className="text-right font-mono text-[11.5px] text-mut">
            {fmtCost(r.costUsd)} · {fmtTokens(r.tokens.input + r.tokens.output + r.tokens.cacheRead)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function UsageView({ usage, label }: { usage: Usage; label: string }) {
  const total = usage.tokens.input + usage.tokens.output + usage.tokens.cacheRead
  return (
    <div data-part="usage">
      <div className="mb-3.5 grid grid-cols-3 gap-2.5">
        <Stat value={fmtTokens(total)} label={`${label} Tokens`} tone="accent" />
        <Stat value={fmtCost(usage.costUsd)} label={tr('web.usage.spend', { label })} tone="ok" />
        <Stat value={String(usage.sessions)} label={tr('web.usage.sessions')} tone="info" />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Stat
          value={usage.cacheHitPercent === null ? '—' : `${usage.cacheHitPercent}%`}
          label={tr('web.usage.cacheHit')}
        />
        <Stat value={String(usage.toolCalls)} label={tr('web.providers.cap.toolCall')} />
        <Stat value={String(usage.asks)} label={tr('web.usage.permissions')} />
      </div>
      {usage.unpricedModels.length > 0 && (
        <p className="mb-3 text-[11.5px] text-mut">
          {tr('web.usage.unpriced', { join: usage.unpricedModels.join(tr('common.listSep')) })}
        </p>
      )}
      <div className="caps mb-2">{tr('web.usage.byModel')}</div>
      <ModelBars rows={usage.byModel} />
    </div>
  )
}

export function UsageTab({ client }: { client: DomiClient }) {
  const [range, setRange] = useState<Range>('month')
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const { from, to } = rangeOf(range, Date.now())
    setUsage(null)
    client.usage(from, to).then(setUsage, (e: Error) => setError(e.message))
  }, [client, range])
  return (
    <div data-part="usage-tab">
      <Saved error={error} saved={null} />
      <div className="mb-3.5 flex gap-1">
        {RANGES().map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'rounded-sm px-2.5 py-1 text-[12.5px] text-mut hover:bg-panel-h hover:text-ink2',
              range === id && 'bg-accent-d font-medium text-accent',
            )}
            onClick={() => setRange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {usage === null ? (
        <p className="text-[13px] text-mut">{error === null ? tr('common.loading') : ''}</p>
      ) : (
        <UsageView
          usage={usage}
          label={
            range === 'all'
              ? tr('web.usage.total')
              : range === 'prev'
                ? tr('web.usage.lastMonth')
                : tr('web.usage.thisMonth')
          }
        />
      )}
    </div>
  )
}
