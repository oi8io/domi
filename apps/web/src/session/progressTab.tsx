/**
 * 进度 tab —— PRD-M14-004（SPEC-M14-004）
 *
 * 数据全部来自 client-core 的 planView / turnSummary 纯投影（INV-04），这里只负责渲染：
 * 最后一条 plan.update 的步骤列表（状态映射 + dependsOn 缩进）、步骤展开详情（工具/文件/耗时/token）、
 * 子 agent / DAG 节点归属、底部固定区（verify / 排队补充 / 剩余步数 + 继续 = ResumeBar 同 action）、
 * 无计划时的本轮动作摘要。
 */

import type { SessionStore } from '@domi/client-core'
import {
  type AskSnapshot,
  planView,
  resumeHint,
  type StatusSnapshot,
  type StepActivity,
  type TurnSummary,
} from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { type ReactNode, useMemo, useState } from 'react'
import { IconCheck, IconChevron } from '../icons.tsx'
import { cn } from '../lib/cn.ts'

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`
}

/** 单步渲染（导出供测试直接渲染展开态；组件内部也用它） */
export function StepRow({
  s,
  open,
  onToggle,
  onOpenStep,
  onOpenSubsession,
}: {
  s: StepActivity
  open: boolean
  onToggle: () => void
  onOpenStep: (stepId: string) => void
  onOpenSubsession: (sessionId: string) => void
}): ReactNode {
  const st = s.step.status
  const inProgress = st === 'in_progress'
  const done = st === 'done'
  const dim = st === 'pending' || st === 'skipped'
  return (
    <li className="border-b border-border2 last:border-b-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ paddingLeft: `${8 + s.step.depth * 14}px` }}>
        <button
          type="button"
          onClick={onToggle}
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-left', done && 'opacity-90')}
          data-step={s.step.id}
          data-status={st}
        >
          <span className={cn('shrink-0', inProgress ? 'text-accent' : dim ? 'text-mut/50' : 'text-ok')} aria-hidden>
            {done ? (
              <IconCheck size={12} />
            ) : inProgress ? (
              <span className="animate-pulse">●</span>
            ) : st === 'skipped' ? (
              <span>⊘</span>
            ) : (
              <span>○</span>
            )}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              done && 'line-through text-mut',
              inProgress && 'text-accent',
              dim && 'text-mut/60',
            )}
          >
            {s.step.text}
          </span>
          {st === 'skipped' && (
            <span className="shrink-0 rounded bg-panel-h px-1 py-px text-[10px] text-mut">
              {tr('web.progress.skipped')}
            </span>
          )}
          {inProgress && s.durationMs !== null && (
            <span className="shrink-0 font-mono text-[10px] text-accent">{fmtMs(s.durationMs)}</span>
          )}
        </button>
        {s.started && s.startSeq !== null && s.endSeq !== null && (
          <button
            type="button"
            onClick={() => onOpenStep(s.step.id)}
            title={tr('web.progress.openStep')}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-mut transition-colors hover:bg-panel-h hover:text-accent"
            data-action="open-step-changes"
          >
            ⤳
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? tr('web.inspector.collapseDetail') : tr('web.inspector.expand')}
          className="shrink-0 rounded p-0.5 text-mut hover:bg-panel-h"
          data-action="toggle-step-detail"
        >
          <IconChevron size={12} className={cn('transition-transform', open && 'rotate-90')} />
        </button>
      </div>
      {open && (
        <div
          className="space-y-1.5 px-3 pb-2 pl-[22px]"
          data-part="step-detail"
          style={{ paddingLeft: `${22 + s.step.depth * 14}px` }}
        >
          {s.toolCalls > 0 && (
            <p className="text-[11px] text-mut">
              {tr('web.progress.toolCalls', { n: String(s.toolCalls) })}
              {s.toolBreakdown.length > 0 && (
                <span className="ml-1.5 font-mono text-[10px]">
                  {s.toolBreakdown.map((t) => `${t.name}×${t.count}`).join(' · ')}
                </span>
              )}
            </p>
          )}
          {s.files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-mut">{tr('web.progress.files')}</span>
              {s.files.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onOpenStep(s.step.id)}
                  className="max-w-[220px] truncate rounded bg-panel px-1.5 py-px font-mono text-[10px] text-ink2 transition-colors hover:bg-accent-d hover:text-accent"
                  data-action="open-step-file"
                  title={tr('web.progress.openStep')}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] font-mono text-mut">
            {s.durationMs !== null && (
              <span>
                {tr('web.progress.duration')} {fmtMs(s.durationMs)} ·{' '}
              </span>
            )}
            {tr('web.progress.tokens', { n: String(s.tokens) })}
          </p>
          {s.subagents.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-mut">{tr('web.progress.subagents')}</p>
              {s.subagents.map((g) => (
                <button
                  key={g.sessionId}
                  type="button"
                  onClick={() => onOpenSubsession(g.sessionId)}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-panel-h"
                  data-action="open-subsession"
                  title={tr('web.progress.openSubsession')}
                >
                  <span
                    className={cn(
                      'shrink-0',
                      g.status === 'done' ? 'text-ok' : g.status === 'failed' ? 'text-bad' : 'text-accent',
                    )}
                  >
                    {g.status === 'done' ? '✓' : g.status === 'failed' ? '✗' : '●'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink2">{g.goal}</span>
                  {g.ms !== undefined && <span className="shrink-0 font-mono text-[10px] text-mut">{fmtMs(g.ms)}</span>}
                </button>
              ))}
            </div>
          )}
          {s.nodes.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-mut">{tr('web.progress.nodes')}</p>
              {s.nodes.map((n) => (
                <div
                  key={`${n.nodeId}-${n.attempt}`}
                  className={cn(
                    'flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-[10px]',
                    n.status === 'failed' ? 'text-bad' : 'text-mut',
                  )}
                >
                  <span>{n.nodeId}</span>
                  <span className="text-mut/60">
                    #{n.attempt} · {n.status}
                  </span>
                  {n.ms !== undefined && <span className="ml-auto">{fmtMs(n.ms)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function SummaryView({ s }: { s: TurnSummary }): ReactNode {
  const cats = Object.entries(s.counts).filter(([, n]) => n > 0)
  return (
    <div className="px-3 py-3" data-part="turn-summary">
      <p className="text-xs font-medium text-ink2">{tr('web.progress.noPlan')}</p>
      <p className="mt-1 text-[11px] text-mut">
        {tr('web.progress.actionsTotal', { total: String(s.total) })}
        {cats.length > 0 && (
          <span className="ml-1.5 font-mono text-[10px]">{cats.map(([k, n]) => `${k}×${n}`).join(' · ')}</span>
        )}
      </p>
      {s.recent.length > 0 && (
        <>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-mut/70">{tr('web.progress.recentActions')}</p>
          <ul className="mt-1 space-y-0.5">
            {s.recent.map((r) => (
              <li
                key={r.seq}
                className="flex min-w-0 items-baseline gap-1.5 font-mono text-[11px]"
                data-action="recent-tool"
              >
                <span className="shrink-0 text-ink2">{r.name}</span>
                {r.summary !== '' && <span className="min-w-0 flex-1 truncate text-mut">{r.summary}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export function ProgressTab({
  store,
  status,
  ask,
  onContinue,
  onOpenStep,
  onOpenSubsession,
}: {
  store: SessionStore
  status: StatusSnapshot
  ask: AskSnapshot | null
  onContinue: () => void
  onOpenStep: (stepId: string) => void
  onOpenSubsession: (sessionId: string) => void
}): ReactNode {
  const events = useStore(store.$events)
  const notes = useStore(store.$notes)
  const [openStep, setOpenStep] = useState<string | null>(null)

  const head = events.length === 0 ? 0 : (events[events.length - 1]?.seq ?? 0)
  const view = useMemo(() => planView(events, head), [events, head])

  // 「计划还剩 N 步 · 继续」与 ResumeBar 同一个 action（SPEC-M14-004 取舍-3 / AC-4）
  const hint = resumeHint(status, ask)
  const remaining = view.kind === 'plan' ? view.remaining : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-part="progress-tab">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.kind === 'summary' ? (
          <SummaryView s={view} />
        ) : view.steps.length === 0 ? (
          <p className="px-3 py-3 text-xs text-mut">{tr('web.progress.emptyPlan')}</p>
        ) : (
          <ul>
            {view.steps.map((s) => (
              <StepRow
                key={s.step.id}
                s={s}
                open={openStep === s.step.id}
                onToggle={() => setOpenStep((cur) => (cur === s.step.id ? null : s.step.id))}
                onOpenStep={onOpenStep}
                onOpenSubsession={onOpenSubsession}
              />
            ))}
          </ul>
        )}
      </div>
      {/* 底部固定区（AC-4） */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border2 px-2 py-1.5 text-[11px] text-mut"
        data-part="progress-bottom"
      >
        {view.kind === 'plan' && view.verify !== null && (
          <span data-part="verify" className="text-warn">
            {tr('web.progress.verify', { attempt: String(view.verify.attempt) })}
            {view.verify.final && tr('web.progress.verifyFinal')}
          </span>
        )}
        {notes.length > 0 && (
          <span data-part="notes">{tr('web.progress.notesQueued', { n: String(notes.length) })}</span>
        )}
        {view.kind === 'plan' && remaining > 0 ? (
          <button
            type="button"
            onClick={onContinue}
            className={cn(
              'rounded px-1.5 py-0.5 transition-colors',
              hint?.interrupted ? 'bg-warn-d text-warn' : 'text-mut hover:bg-panel-h hover:text-accent',
            )}
            data-action="continue-plan"
          >
            {tr('web.progress.remaining', { remaining: String(remaining) })} · {tr('web.plan.continue')}
          </button>
        ) : (
          view.kind === 'plan' && <span data-part="remaining-none">{tr('web.progress.remainingNone')}</span>
        )}
      </div>
    </div>
  )
}
