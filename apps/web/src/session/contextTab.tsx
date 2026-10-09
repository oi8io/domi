/**
 * 上下文 tab —— PRD-M14-006（SPEC-M14-006）
 * 数据全来自 client-core contextView（事件 + session.metrics 同源，AC-8）；静态项经 session.context RPC。
 * 压缩记录 / 读过的 / 层清单的「在对话中定位」走 002 联动（onLocate → 补拉 + 滚动 + flash）。
 */

import type { DomiClient, SessionStore } from '@domi/client-core'
import { type ContextSegmentId, type CtxStatic, contextView } from '@domi/client-core'
import { type MessageKey, tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'

const SEG_META: Record<ContextSegmentId, { cls: string; key: MessageKey }> = {
  builtin: { cls: 'bg-sky-500/70', key: 'web.context.seg.builtin' },
  soul: { cls: 'bg-violet-500/70', key: 'web.context.seg.soul' },
  rules: { cls: 'bg-emerald-500/70', key: 'web.context.seg.rules' },
  skills: { cls: 'bg-amber-500/70', key: 'web.context.seg.skills' },
  plan: { cls: 'bg-orange-500/70', key: 'web.context.seg.plan' },
  tools: { cls: 'bg-teal-500/70', key: 'web.context.seg.tools' },
  history: { cls: 'bg-blue-500/70', key: 'web.context.seg.history' },
  compact: { cls: 'bg-fuchsia-500/70', key: 'web.context.seg.compact' },
  uploads: { cls: 'bg-rose-500/70', key: 'web.context.seg.uploads' },
  unclassified: { cls: 'bg-zinc-500/70', key: 'web.context.seg.unclassified' },
}

function fmt(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n)
}

const PENDING_LABELS = ['soul', 'rules', 'catalog', 'skills'] as const

/** 遮蔽原因 → i18n 键（PRD-M15-004 AC-6 展示用） */
const MASK_REASON_KEY: Record<string, MessageKey> = {
  cold: 'web.context.maskReason.cold',
  dedup: 'web.context.maskReason.dedup',
  resolved_error: 'web.context.maskReason.resolvedError',
  truncate: 'web.context.maskReason.truncate',
  threshold: 'web.context.maskReason.threshold',
}

/** 前缀断裂归因 → i18n 键（PRD-M15-001 AC-2 / SPEC-M15-011） */
const BREAK_CAUSE_KEY: Record<string, MessageKey> = {
  tools: 'web.context.breakCause.tools',
  identity: 'web.context.breakCause.identity',
  guardrail: 'web.context.breakCause.guardrail',
  conventions: 'web.context.breakCause.conventions',
  soul: 'web.context.breakCause.soul',
  skills: 'web.context.breakCause.skills',
  env: 'web.context.breakCause.env',
  'plan.update': 'web.context.breakCause.plan.update',
  'session.identity': 'web.context.breakCause.session.identity',
  rules: 'web.context.breakCause.rules',
  message: 'web.context.breakCause.message',
  'messages.length': 'web.context.breakCause.messages.length',
}

export function ContextTab({
  client,
  sessionId,
  store,
  onLocate,
  staticProp,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  /** 右侧栏 → 对话：压缩记录 / 读过的定位（SPEC-M14-002） */
  onLocate: (seq: number) => void
  /** 静态项（测试直接给；运行时空着 = 组件自己拉 RPC） */
  staticProp?: CtxStatic | null
}): ReactNode {
  const events = useStore(store.$events)
  const status = useStore(store.$status)
  const [static_, setStatic] = useState<CtxStatic | null>(staticProp ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const load = (): void => {
    void client
      .context(sessionId)
      .then((r) =>
        setStatic({
          trusted: r.trusted,
          rules: r.rules,
          skillsTotal: r.skillsTotal,
          mcp: r.mcp,
          strategy: r.context.strategy,
          thresholdPercent: r.context.thresholdPercent,
          pending: r.pending,
        }),
      )
      .catch(() => setStatic(null))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只拉一次；staticProp 变了由父级负责
  useEffect(() => {
    if (staticProp === undefined) load()
  }, [sessionId])

  /** M15 显式刷新（PRD-M15-003 AC-4）：落 ctx.refresh + 重定格，然后重拉静态项 */
  const refresh = (): void => {
    if (refreshing) return
    setRefreshing(true)
    void client
      .refreshContext(sessionId)
      .then(load)
      .finally(() => setRefreshing(false))
  }

  const pendingCount = static_ ? PENDING_LABELS.filter((k) => static_.pending[k]).length : 0

  const v = contextView(events, status.metrics ?? null, static_)
  const max = Math.max(
    1,
    v.total ?? 0,
    v.segments.reduce((n, s) => n + s.tokens, 0),
  )
  const pct = (t: number): string => `${Math.round((t / max) * 100)}%`

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-part="context-tab">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 用量：堆叠条 + 图例（AC-1 / AC-3 同区数字） */}
        <div className="rounded-md border border-border2 p-2">
          <div className="mb-1.5 flex items-baseline gap-2 text-[11px]">
            <span className="font-medium text-ink2">{tr('web.context.usage')}</span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={refresh}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-400 hover:bg-amber-500/20"
                data-part="ctx-refresh"
              >
                {tr('web.context.pendingRefresh', { n: String(pendingCount) })}
              </button>
            )}
            {pendingCount === 0 && (
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="rounded border border-border2 px-1.5 py-px text-[10px] text-mut hover:bg-ok/10 disabled:opacity-50"
                data-part="ctx-refresh"
              >
                {tr('web.context.refresh')}
              </button>
            )}
            {v.total !== null && (
              <span className="font-mono text-mut">
                {fmt(v.total)} / {fmt(v.window ?? 0)} tok
              </span>
            )}
            {v.cacheHitPercent !== null && (
              <span className="ml-auto text-mut" data-metric="cache-hit">
                {tr('web.context.cacheHit', { pct: String(v.cacheHitPercent) })}
              </span>
            )}
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-sm" data-part="ctx-stack" aria-hidden>
            {v.segments.map((s) => (
              <div key={s.id} className={SEG_META[s.id].cls} style={{ width: pct(s.tokens) }} data-seg={s.id} />
            ))}
          </div>
          {v.deviation && (
            <p className="mt-1 text-[10px] text-bad" data-part="deviation">
              {tr('web.context.deviation')}
            </p>
          )}
          {!v.hasLayers && v.segments.length === 0 && (
            <p className="mt-1 text-[10px] text-mut">{tr('web.context.noLayers')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {v.segments.map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-[10px] text-mut" data-legend={s.id}>
                <span className={`h-2 w-2 rounded-sm ${SEG_META[s.id].cls}`} aria-hidden />
                {tr(SEG_META[s.id].key)} {fmt(s.tokens)}
              </span>
            ))}
            {v.unclassified > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-mut" data-legend="unclassified">
                <span className="h-2 w-2 rounded-sm bg-zinc-500/70" aria-hidden />
                {tr('web.context.seg.unclassified')} {fmt(v.unclassified)}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-border2 pt-1.5 text-[10.5px] text-mut">
            {v.thresholdGap !== null && (
              <span data-metric="threshold">
                {v.thresholdGap >= 0
                  ? tr('web.context.toThreshold', { pct: String(Math.round(v.thresholdGap)) })
                  : tr('web.context.overThreshold', { pct: String(Math.round(-v.thresholdGap)) })}
              </span>
            )}
            {v.thresholdGap === null && v.strategy !== null && (
              <span data-metric="no-threshold">{tr('web.context.noAutoCompact')}</span>
            )}
            {v.maskedTokens > 0 && (
              <span data-metric="masked">{tr('web.context.masked', { n: fmt(v.maskedTokens) })}</span>
            )}
            {v.cost !== undefined && <span data-metric="cost">{tr('web.context.cost', { cost: v.cost })}</span>}
          </div>
        </div>

        {/* M15 缓存（SPEC-M15-011 AC-2）：可避免损失 + 前缀断裂归因 */}
        {(v.avoidableLoss !== null || v.breaks.length > 0) && (
          <div className="mt-2 rounded-md border border-border2 p-2" data-part="cache">
            <p className="mb-1 text-[11px] font-medium text-ink2">{tr('web.context.breaks')}</p>
            {v.avoidableLoss !== null && (
              <p className="text-[10.5px] text-mut" data-metric="avoidable-loss">
                {tr('web.context.avoidableLoss', { n: fmt(v.avoidableLoss) })}
              </p>
            )}
            {v.breaks.length > 0 && (
              <ul className="space-y-0.5">
                {v.breaks.map((b) => (
                  <li key={b.seq} className="flex items-center gap-1.5 text-[10.5px] text-mut" data-break={b.cause}>
                    <span>
                      {tr('web.context.break', {
                        prev: String(b.prevSeq),
                        next: String(b.nextSeq),
                        cause: tr(BREAK_CAUSE_KEY[b.cause] ?? 'web.context.breakCause.message'),
                      })}
                    </span>
                    {b.layer !== undefined && <code className="truncate font-mono">{b.layer}</code>}
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded px-1 py-0.5 text-mut transition-colors hover:bg-panel-h hover:text-accent"
                      data-action="locate-break"
                      title={tr('web.context.locate')}
                      onClick={() => onLocate(b.nextSeq)}
                    >
                      ◎
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 加载了什么（AC-5） */}
        <div className="mt-2 rounded-md border border-border2 p-2" data-part="loaded">
          <p className="mb-1 text-[11px] font-medium text-ink2">{tr('web.context.loaded')}</p>
          {v.layers !== null && (
            <ul className="space-y-0.5">
              {v.layers.map((l) => (
                <li key={l.id} className="flex items-center gap-1.5 text-[10.5px] text-mut" data-layer={l.id}>
                  <code className="truncate font-mono">{l.id}</code>
                  {l.cacheable && (
                    <span className="shrink-0 rounded bg-ok-d px-1 text-[9px] text-ok" data-cacheable>
                      {tr('web.context.cacheable')}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono">~{fmt(l.approxTokens)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10.5px] text-mut" data-part="rules">
            {tr('web.context.rules')}
            {v.trusted === false ? (
              <span className="text-bad"> {tr('web.context.rulesUntrusted')}</span>
            ) : v.rules.length > 0 ? (
              <code className="ml-1 font-mono">{v.rules.join(', ')}</code>
            ) : (
              ''
            )}
          </p>
          <p className="mt-0.5 text-[10.5px] text-mut" data-part="skills">
            {tr('web.context.skillsTotal', { n: String(v.skillsTotal ?? 0) })}
            {v.skills.length > 0 && <code className="ml-1 font-mono">{v.skills.map((s) => s.name).join(', ')}</code>}
          </p>
          {v.mcpCalls.length > 0 && (
            <p className="mt-0.5 text-[10.5px] text-mut" data-part="mcp">
              {tr('web.context.mcp')}{' '}
              <code className="font-mono">{v.mcpCalls.map((m) => `${m.server}(${m.tools.length})`).join(', ')}</code>
            </p>
          )}
          {v.refs.length > 0 && (
            <p className="mt-0.5 text-[10.5px] text-mut" data-part="refs">
              {tr('web.context.refs')}{' '}
              <code className="font-mono">
                {v.refs.map((r) => `${r.sessionId}#${r.fromSeq}-${r.toSeq}`).join(', ')}
              </code>
            </p>
          )}
          {v.uploads.length > 0 && (
            <p className="mt-0.5 text-[10.5px] text-mut" data-part="uploads">
              {tr('web.context.uploads')} <code className="font-mono">{v.uploads.map((u) => u.name).join(', ')}</code>
            </p>
          )}
        </div>

        {/* 压缩记录（AC-4） */}
        {v.compacts.length > 0 && (
          <div className="mt-2 rounded-md border border-border2 p-2" data-part="compacts">
            <p className="mb-1 text-[11px] font-medium text-ink2">{tr('web.context.compacts')}</p>
            <ul className="space-y-1">
              {v.compacts.map((c) => (
                <li key={c.seq} className="flex items-center gap-1.5 text-[10.5px]" data-compact={c.kind}>
                  <span className={c.kind === 'compact' ? 'text-accent' : 'text-mut'}>
                    {c.kind === 'compact'
                      ? `${tr('web.context.compact')} · ${c.trigger === 'manual' ? tr('web.context.triggerManual') : tr('web.context.triggerThreshold')}`
                      : tr('web.context.cleanup')}
                  </span>
                  <span className="font-mono text-mut">
                    {fmt(c.tokensBefore)} → {fmt(c.tokensAfter)}
                  </span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded px-1 py-0.5 text-mut transition-colors hover:bg-panel-h hover:text-accent"
                    data-action="locate-compact"
                    title={tr('web.context.locate')}
                    onClick={() => onLocate(c.fromSeq)}
                  >
                    ◎
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 遮蔽记录（PRD-M15-004 AC-6）：一批一行，明细可定位 */}
        {v.masks.length > 0 && (
          <div className="mt-2 rounded-md border border-border2 p-2" data-part="masks">
            <p className="mb-1 text-[11px] font-medium text-ink2">{tr('web.context.masks')}</p>
            <ul className="space-y-1.5">
              {v.masks.map((m) => (
                <li key={m.seq} className="flex flex-col gap-0.5 text-[10.5px]" data-mask={m.reason}>
                  <span className="flex items-center gap-1.5">
                    <span className="text-accent">
                      {tr('web.context.maskBatch', {
                        reason: tr(MASK_REASON_KEY[m.reason] ?? 'web.context.maskReason.threshold'),
                      })}
                    </span>
                    <span className="font-mono text-mut">−{fmt(m.freedTokens)} tok</span>
                    <button
                      type="button"
                      className={v.pinned.includes(m.seqs[0]!) ? 'text-accent' : 'text-mut hover:text-accent'}
                      data-action={v.pinned.includes(m.seqs[0]!) ? 'unpin' : 'pin'}
                      title={tr(v.pinned.includes(m.seqs[0]!) ? 'web.context.unpin' : 'web.context.pin')}
                      onClick={() => void client.pin(sessionId, m.seqs[0]!, !v.pinned.includes(m.seqs[0]!))}
                    >
                      📌
                    </button>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {m.items.map((it) => (
                      <button
                        key={it.seq}
                        type="button"
                        onClick={() => onLocate(it.seq)}
                        className="rounded bg-panel-h px-1 py-px font-mono text-mut transition-colors hover:text-accent"
                        data-mask-item={it.seq}
                        title={tr('web.context.locate')}
                      >
                        {it.tool} · {fmt(it.chars)}c
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 读过的（AC-6） */}
        {(v.reads.length > 0 || v.mcpCalls.length > 0) && (
          <div className="mt-2 rounded-md border border-border2 p-2" data-part="reads">
            <p className="mb-1 text-[11px] font-medium text-ink2">{tr('web.context.reads')}</p>
            <ul className="space-y-0.5">
              {v.reads.map((r) => (
                <li key={r.path} className="flex items-center gap-1.5 text-[10.5px] text-mut" data-read={r.path}>
                  <code className="min-w-0 truncate font-mono">{r.path}</code>
                  <span className="shrink-0 font-mono text-[9.5px]">×{r.count}</span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded px-1 py-0.5 text-mut transition-colors hover:bg-panel-h hover:text-accent"
                    data-action="locate-read"
                    title={tr('web.context.locate')}
                    onClick={() => onLocate(r.firstSeq)}
                  >
                    ◎
                  </button>
                </li>
              ))}
              {v.mcpCalls.map((m) =>
                m.tools.map((t) => (
                  <li key={t.name} className="flex items-center gap-1.5 text-[10.5px] text-mut" data-read={t.name}>
                    <code className="min-w-0 truncate font-mono">{t.name}</code>
                    <span className="shrink-0 font-mono text-[9.5px]">×{t.count}</span>
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded px-1 py-0.5 text-mut transition-colors hover:bg-panel-h hover:text-accent"
                      data-action="locate-read"
                      title={tr('web.context.locate')}
                      onClick={() => onLocate(t.firstSeq)}
                    >
                      ◎
                    </button>
                  </li>
                )),
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
