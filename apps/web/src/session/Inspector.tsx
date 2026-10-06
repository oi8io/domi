/**
 * 右侧栏（Inspector）骨架 —— PRD-M14-001（SPEC-M14-001）
 *
 * 第三列：折叠窄条（图标 + 徽标）↔ 展开列；拖拽宽度（320–720，CSS 变量 --inspector-w）；
 * <1200px 变抽屉（盖在主区上，点主区关闭）；详情页 ⤢ 展开占满（盖住 Transcript，Composer 仍可用）；
 * Cmd/Ctrl+. 全局开合、聚焦后 1–4 切 tab / Esc 收。
 * 改动 tab 本册实现（TASK-M14-003）；进度 / 上下文 / 产物 tab 后续任务填充。
 * 状态全在 store.$inspector（SPEC 取舍-3）：localStorage 只做跨重启持久化。
 */
import type { AskSnapshot, DomiClient, InspectorTab, SessionStore, StatusSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'
import type { PendingRef } from './Composer.tsx'
import { ChangesTab } from './changesTab.tsx'
import { ProgressTab } from './progressTab.tsx'

const MIN_W = 320
const MAX_W = 720
const LS_OPEN = (sessionId: string): string => `domi.inspector.${sessionId}.open`
const LS_GLOBALS = 'domi.inspector.globals'

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'progress', label: tr('web.inspector.tabProgress') },
  { id: 'changes', label: tr('web.inspector.tabChanges') },
  { id: 'artifacts', label: tr('web.inspector.tabArtifacts') },
  { id: 'context', label: tr('web.inspector.tabContext') },
]

function readGlobals(): { width: number; tab: InspectorTab } | null {
  try {
    const raw = localStorage.getItem(LS_GLOBALS)
    if (raw === null) return null
    const g = JSON.parse(raw) as { width?: number; tab?: InspectorTab }
    const width = typeof g.width === 'number' ? Math.min(MAX_W, Math.max(MIN_W, g.width)) : 400
    const tab = TABS.some((t) => t.id === g.tab) ? (g.tab as InspectorTab) : 'changes'
    return { width, tab }
  } catch {
    return null
  }
}

export function Inspector({
  client,
  sessionId,
  store,
  busy,
  items,
  refs,
  onRefsChange,
  onNotice,
  status,
  ask,
  onContinue,
  onOpenStep,
  onOpenSubsession,
  onLocate,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  busy: boolean
  items: readonly { text: string; summary?: string | undefined }[]
  refs: readonly PendingRef[]
  onRefsChange?: ((refs: PendingRef[]) => void) | undefined
  onNotice: (m: string | null) => void
  /** 进度 tab（PRD-M14-004）需要：ResumeBar 同 action 的「继续」与底部固定区数据 */
  status: StatusSnapshot
  ask: AskSnapshot | null
  onContinue: () => void
  onOpenStep: (stepId: string) => void
  onOpenSubsession: (sessionId: string) => void
  /** 右侧栏 → 对话：在对话里定位（SPEC-M14-002 取舍-1） */
  onLocate: (seq: number) => void
}) {
  const insp = useStore(store.$inspector)
  const changes = useStore(store.$changesDiff)
  const [drawer, setDrawer] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 1199px)').matches,
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // 跨重启持久化：会话级 open（只读一次，避免覆盖用户手动状态）+ 全局 width/tab
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只读一次 localstorage，store/setInspector 稳定不该进依赖
  useEffect(() => {
    const saved = localStorage.getItem(LS_OPEN(sessionId))
    if (saved !== null && (saved === 'true' || saved === 'false')) {
      store.setInspector({ open: saved === 'true' })
    }
    const g = readGlobals()
    if (g !== null) store.setInspector({ width: g.width, tab: g.tab })
  }, [sessionId])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)')
    const on = (): void => setDrawer(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // 徽标（SPEC 取舍-4）：改动 = 当前范围文件数；其余 tab 由各自任务补
  const changesCount = changes.diff !== null ? changes.diff.files.length : changes.fallbackNames.length
  const badge: Record<InspectorTab, number> = {
    progress: 0,
    changes: changesCount,
    artifacts: 0,
    context: 0,
  }

  const persistOpen = (open: boolean): void => {
    store.setInspector({ open })
    try {
      localStorage.setItem(LS_OPEN(sessionId), open ? 'true' : 'false')
    } catch {
      // 隐私模式等场景忽略
    }
  }
  const persistGlobals = (w: number, tab: InspectorTab): void => {
    try {
      localStorage.setItem(LS_GLOBALS, JSON.stringify({ width: w, tab }))
    } catch {
      // ignore
    }
  }

  // Cmd/Ctrl+. 全局开合；聚焦后 1–4 切 tab、Esc 收/返回
  // biome-ignore lint/correctness/useExhaustiveDependencies: 闭包只读 store 当前值；sessionId 变化才需要重建监听
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        persistOpen(!store.$inspector.get().open)
        return
      }
      const el = document.activeElement
      if (el === rootRef.current || rootRef.current?.contains(el) === true) {
        if (e.key >= '1' && e.key <= '4') {
          const tab = TABS[Number(e.key) - 1]?.id
          if (tab !== undefined) {
            store.setInspector({ tab })
            persistGlobals(store.$inspector.get().width, tab)
          }
        } else if (e.key === 'Escape') {
          const cur = store.$inspector.get()
          if (cur.detail !== null) store.setInspector({ detail: null })
          else if (cur.expanded) store.setInspector({ expanded: false })
          else persistOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sessionId])

  // 拖拽改宽（SPEC 取舍-1：320–720，默认 400）
  const startDrag = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    if (drawer || insp.expanded) return
    e.preventDefault()
    const move = (ev: MouseEvent): void => {
      const right = rootRef.current?.getBoundingClientRect().right ?? 0
      const w = Math.min(MAX_W, Math.max(MIN_W, right - ev.clientX))
      store.setInspector({ width: w })
      persistGlobals(w, store.$inspector.get().tab)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!insp.open) {
    // 折叠态：右缘 28px 窄条（图标 + 徽标），点击展开
    return (
      <button
        type="button"
        ref={rootRef as never}
        className="group relative flex w-7 shrink-0 flex-col items-center gap-1 border-l border-border2 bg-panel py-2 text-mut hover:bg-panel-h"
        title={tr('web.inspector.open')}
        onClick={() => persistOpen(true)}
        data-action="inspector-open"
        data-part="inspector-strip"
      >
        <span className="text-[15px] leading-none">▐▌</span>
        {badge.changes > 0 && (
          <span className="rounded-full bg-accent-d px-1 text-[9px] font-semibold text-accent" data-badge="changes">
            {badge.changes}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex min-h-0 flex-col border-l border-border2 bg-panel',
        // 抽屉 / 展开占满盖住主区（Transcript），Composer 在下方仍可用
        (drawer || insp.expanded) && 'absolute inset-y-0 right-0 z-20 shadow-2xl',
        insp.expanded ? 'inset-x-0' : 'w-[var(--inspector-w)]',
      )}
      style={{ ['--inspector-w' as never]: `${insp.width}px` }}
      data-part="inspector"
      data-open={insp.open}
      data-expanded={insp.expanded}
      data-drawer={drawer}
      data-tab={insp.tab}
    >
      {/* 拖拽把手（左缘） */}
      {!drawer && !insp.expanded && (
        <button
          type="button"
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/20"
          onMouseDown={startDrag}
          data-action="inspector-resize"
          aria-label={tr('web.inspector.resize')}
        />
      )}
      {drawer && (
        <button
          type="button"
          className="absolute inset-y-0 -left-[1px] w-[1px] bg-border2"
          onClick={() => {
            // 点主区关闭（AC-6）
            persistOpen(false)
          }}
          aria-label={tr('web.inspector.close')}
        />
      )}
      {/* tab 条 */}
      <div className="flex shrink-0 items-center border-b border-border2 px-1.5 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              'relative rounded px-2.5 py-1 text-[11.5px]',
              insp.tab === t.id ? 'bg-accent-d font-medium text-accent' : 'text-mut hover:bg-panel-h',
            )}
            onClick={() => {
              store.setInspector({ tab: t.id, ...(t.id === 'changes' ? {} : { detail: null }) })
              persistGlobals(store.$inspector.get().width, t.id)
            }}
            data-tab={t.id}
          >
            {t.label}
            {badge[t.id] > 0 && (
              <span
                className="ml-1 rounded-full bg-accent-d px-1 text-[9px] font-semibold text-accent"
                data-badge={t.id}
              >
                {badge[t.id]}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => persistOpen(false)}
          data-action="inspector-close"
          title={tr('web.inspector.close')}
        >
          <span aria-hidden>×</span>
        </Button>
      </div>
      <TabBody
        client={client}
        sessionId={sessionId}
        store={store}
        busy={busy}
        items={items}
        refs={refs}
        onRefsChange={onRefsChange}
        onNotice={onNotice}
        status={status}
        ask={ask}
        onContinue={onContinue}
        onOpenStep={onOpenStep}
        onOpenSubsession={onOpenSubsession}
        onLocate={onLocate}
      />
    </div>
  )
}

function TabBody({
  client,
  sessionId,
  store,
  busy,
  items,
  refs,
  onRefsChange,
  onNotice,
  status,
  ask,
  onContinue,
  onOpenStep,
  onOpenSubsession,
  onLocate,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  busy: boolean
  items: readonly { text: string; summary?: string | undefined }[]
  refs: readonly PendingRef[]
  onRefsChange?: ((refs: PendingRef[]) => void) | undefined
  onNotice: (m: string | null) => void
  status: StatusSnapshot
  ask: AskSnapshot | null
  onContinue: () => void
  onOpenStep: (stepId: string) => void
  onOpenSubsession: (sessionId: string) => void
  onLocate: (seq: number) => void
}) {
  const insp = useStore(store.$inspector)
  if (insp.tab === 'changes') {
    return (
      <ChangesTab
        client={client}
        sessionId={sessionId}
        store={store}
        busy={busy}
        items={items}
        refs={refs}
        onRefsChange={onRefsChange}
        onNotice={onNotice}
        onLocate={onLocate}
      />
    )
  }
  if (insp.tab === 'progress') {
    return (
      <ProgressTab
        store={store}
        status={status}
        ask={ask}
        onContinue={onContinue}
        onOpenStep={onOpenStep}
        onOpenSubsession={onOpenSubsession}
        onLocate={onLocate}
      />
    )
  }
  const soon: Record<InspectorTab, string> = {
    progress: '',
    changes: '',
    artifacts: tr('web.inspector.tabArtifactsSoon'),
    context: tr('web.inspector.tabContextSoon'),
  }
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-mut"
      data-part="inspector-pending"
    >
      <p>{soon[insp.tab]}</p>
    </div>
  )
}
