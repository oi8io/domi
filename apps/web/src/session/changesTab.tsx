/**
 * 改动 tab（右侧栏）—— PRD-M14-005（SPEC-M14-005）
 *
 * 数据：范围换算 + checkpoint.diff / worktree.diff（daemon 算，端上不碰文件）；
 * 投影全部走 client-core 纯函数（changesView / wordDiff / keepSelection / staleFiles / shouldFold）。
 * 列表 → 详情；折叠规则；实时（有新改动·刷新，不自动替换）；丢弃（非隔离 checkpoint.discard / 隔离 worktree.discard，
 * 都可撤销）；带回三选一（仅对比基线范围）。
 */
import {
  type ChangeFileView,
  type ChangesRange,
  type CheckpointDiffResult,
  changeFileSeq,
  changesRangeSeq,
  changesView,
  type DomiClient,
  keepSelection,
  planView,
  type SessionStore,
  type StepIntervals,
  shouldFold,
  staleFiles,
  stepIntervals,
  toFileViews,
  wordDiff,
} from '@domi/client-core'
import { tr } from '@domi/i18n'
import { isKnownEvent } from '@domi/protocol'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { IconChevron, IconCopy, IconQuote, IconRestore, IconTrash } from '../icons.tsx'
import { cn } from '../lib/cn.ts'
import type { PendingRef } from './Composer.tsx'

type WorktreeDiff = Awaited<ReturnType<DomiClient['worktreeDiff']>>

interface Latest {
  available: boolean
  reason?: string | undefined
  files: ChangeFileView[]
  fallbackNames: string[]
}

const STATUS_MARK: Record<string, { label: string; cls: string }> = {
  added: { label: tr('web.changes.added'), cls: 'bg-ok-d text-ok' },
  modified: { label: tr('web.changes.modified'), cls: 'bg-accent-d text-accent' },
  deleted: { label: tr('web.changes.deleted'), cls: 'bg-bad-d text-bad' },
  renamed: { label: tr('web.changes.renamed'), cls: 'bg-warn-d text-warn' },
}

/** patch 里的行：hdr（@@ 头）/ ctx / del / add，带新旧行号 */
type PatchLine = { kind: 'hdr' | 'ctx' | 'del' | 'add'; text: string; oldNo?: number; newNo?: number }
export function parsePatchLines(patch: string): PatchLine[] {
  const out: PatchLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldNo = m === null ? oldNo : Number(m[1])
      newNo = m === null ? newNo : Number(m[2])
      out.push({ kind: 'hdr', text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), newNo })
      newNo += 1
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldNo })
      oldNo += 1
    } else {
      out.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, oldNo, newNo })
      if (raw.startsWith(' ')) {
        oldNo += 1
        newNo += 1
      }
    }
  }
  return out
}

/** 逐行渲染统一 diff：del 后紧跟的 add 行成对做词级 diff（wordDiff） */
function DiffLines({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatchLines(patch), [patch])
  const rows: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] as PatchLine
    if (line.kind === 'hdr') {
      rows.push(
        <div key={i} className="px-3 py-px font-mono text-[10.5px] text-mut2" data-diff-line="hdr">
          {line.text}
        </div>,
      )
      i += 1
      continue
    }
    if (line.kind === 'del' || line.kind === 'add') {
      // 收集连续的 del / add 段
      const dels: PatchLine[] = []
      const adds: PatchLine[] = []
      while (i < lines.length && (lines[i]?.kind === 'del' || lines[i]?.kind === 'add')) {
        if (lines[i]?.kind === 'del') dels.push(lines[i] as PatchLine)
        else adds.push(lines[i] as PatchLine)
        i += 1
      }
      const span = (line: PatchLine, _kind: 'del' | 'add'): ReactNode => (line.text === '' ? ' ' : line.text)
      const pair = Math.max(dels.length, adds.length)
      for (let k = 0; k < pair; k++) {
        const del = dels[k]
        const add = adds[k]
        if (del !== undefined && add !== undefined) {
          const d = wordDiff(del.text, add.text)
          rows.push(
            <div key={`${i}-${k}-del`} className="bg-bad/20 px-3 py-px font-mono text-xs" data-diff-line="del">
              <span className="mr-2 inline-block w-10 select-none text-right text-mut2">{del.oldNo}</span>
              <span className="mr-2 select-none text-bad">−</span>
              {d.old.map((t) => (
                <span
                  key={`${i}-${k}-old-${t.kind}-${t.text}`}
                  className={t.kind === 'del' ? 'bg-bad/40 rounded-[2px]' : ''}
                >
                  {t.text}
                </span>
              ))}
            </div>,
          )
          rows.push(
            <div key={`${i}-${k}-add`} className="bg-ok/20 px-3 py-px font-mono text-xs" data-diff-line="add">
              <span className="mr-2 inline-block w-10 select-none text-right text-mut2">{add.newNo}</span>
              <span className="mr-2 select-none text-ok">+</span>
              {d.add.map((t) => (
                <span
                  key={`${i}-${k}-add-${t.kind}-${t.text}`}
                  className={t.kind === 'add' ? 'bg-ok/40 rounded-[2px]' : ''}
                >
                  {t.text}
                </span>
              ))}
            </div>,
          )
        } else if (del !== undefined) {
          rows.push(
            <div key={`${i}-${k}-del`} className="bg-bad/20 px-3 py-px font-mono text-xs" data-diff-line="del">
              <span className="mr-2 inline-block w-10 select-none text-right text-mut2">{del.oldNo}</span>
              <span className="mr-2 select-none text-bad">−</span>
              {span(del, 'del')}
            </div>,
          )
        } else if (add !== undefined) {
          rows.push(
            <div key={`${i}-${k}-add`} className="bg-ok/20 px-3 py-px font-mono text-xs" data-diff-line="add">
              <span className="mr-2 inline-block w-10 select-none text-right text-mut2">{add.newNo}</span>
              <span className="mr-2 select-none text-ok">+</span>
              {span(add, 'add')}
            </div>,
          )
        }
      }
      continue
    }
    rows.push(
      <div key={i} className="px-3 py-px font-mono text-xs text-mut" data-diff-line="ctx">
        <span className="mr-2 inline-block w-10 select-none text-right text-mut2">{line.oldNo}</span>
        {line.text}
      </div>,
    )
    i += 1
  }
  return <>{rows}</>
}

/** 丢弃记录里还能撤销的（按事件投影，同 ChangesBar 的 undoable 口径） */
export function worktreeUndoable(
  items: readonly { text: string; summary?: string | undefined }[],
): Array<{ path: string; trash: string }> {
  const out = new Map<string, { path: string; trash: string }>()
  for (const it of items) {
    const m = it.text.match(/^丢弃了 (.+) 的改动$/)
    const t = it.summary?.match(/回收站 (\d+)$/)
    if (m && t) out.set(t[1] as string, { path: m[1] as string, trash: t[1] as string })
    const r = it.text.match(/^恢复了 (.+) 的改动$/)
    if (r) for (const [k, v] of out) if (v.path === r[1]) out.delete(k)
  }
  return [...out.values()]
}

const CHECKPOINT_EVENTS = new Set([
  'fs.checkpoint',
  'fs.snapshot',
  'fs.discard',
  'worktree.discard',
  'worktree.restore',
  'worktree.apply',
])

export function ChangesTab({
  client,
  sessionId,
  store,
  busy,
  items,
  refs,
  onRefsChange,
  onNotice,
  onLocate,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  busy: boolean
  items: readonly { text: string; summary?: string | undefined }[]
  refs?: readonly PendingRef[]
  onRefsChange?: ((refs: PendingRef[]) => void) | undefined
  onNotice: (m: string | null) => void
  /** 右侧栏 → 对话：在对话里定位该文件（SPEC-M14-002 取舍-1） */
  onLocate: ((seq: number) => void) | undefined
}) {
  const insp = useStore(store.$inspector)
  const events = useStore(store.$events)
  const status = useStore(store.$status)
  const head = events.length === 0 ? 0 : (events[events.length - 1]?.seq ?? 0)
  // 对比基线只对隔离任务开放；其他会话落到本轮
  const effRange: ChangesRange = insp.changesRange === 'baseline' && !status.worktree ? 'turn' : insp.changesRange
  const selected = insp.detail?.kind === 'file' ? insp.detail.id : null
  const [latest, setLatest] = useState<Latest | null>(null)
  const [shown, setShown] = useState<Latest | null>(null)
  const [stale, setStale] = useState(false)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [dirs, setDirs] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [undoneCk, setUndoneCk] = useState<Set<number>>(new Set())
  const [armedAll, setArmedAll] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const seqRef = useRef(0)

  // 与改动相关的事件签名：token 流式增量不该触发重刷
  const ckSig = useMemo(
    () => events.filter((e) => isKnownEvent(e.ev) && CHECKPOINT_EVENTS.has(e.ev.t)).reduce((n, e) => n + e.seq, 0),
    [events],
  )

  // {step} 范围：步区间表由 planView 提供（TASK-M14-004），没有计划/没有区间 → 走降级
  const stepRanges = (): StepIntervals | undefined => {
    if (typeof effRange !== 'object') return undefined
    const v = planView(events, head)
    return v.kind === 'plan' ? stepIntervals(v) : undefined
  }

  const load = async (): Promise<void> => {
    const my = ++seqRef.current
    let next: Latest
    const steps = stepRanges()
    if (effRange === 'baseline') {
      const d: WorktreeDiff = await client.worktreeDiff(sessionId)
      next = { available: true, files: toFileViews(d.files), fallbackNames: [] }
    } else {
      const seq = changesRangeSeq(events, effRange, head, steps)
      if (seq === null) {
        next = { available: false, reason: tr('web.changes.noSnapshot'), files: [], fallbackNames: [] }
      } else {
        const d: CheckpointDiffResult = await client.checkpointDiff(sessionId, seq)
        const v = changesView(events, d, effRange, head)
        next = { available: v.available, reason: v.reason, files: v.files, fallbackNames: v.fallbackNames }
      }
    }
    if (my !== seqRef.current) return // 已经换了范围/会话，丢掉过期响应
    setLatest(next)
    // AC-1：切换范围不丢选中——新范围没有该文件才回列表
    if (selected !== null && keepSelection(latest?.files ?? [], next.files, selected) === null) {
      store.setInspector({ detail: null })
    }
    // 正在看的文件有新改动 → 保留旧渲染 + 标「刷新」（AC-6，不自动替换）
    if (selected !== null) {
      const oldFile = shown?.files.find((f) => f.path === selected)
      const newFile = next.files.find((f) => f.path === selected)
      if (oldFile !== undefined && newFile !== undefined && staleFiles([oldFile], [newFile], selected).length > 0) {
        setShown({ ...next, files: next.files.map((f) => (f.path === selected ? oldFile : f)) })
        setStale(true)
        return
      }
    }
    setShown(next)
    setStale(false)
    // 徽标 / 状态栏共用同一份数据
    store.setChangesDiff({
      range: effRange,
      diff: next.available ? { available: true, files: next.files } : null,
      fallbackNames: next.fallbackNames,
    })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: ckSig（改动事件签名）与范围/会话/工作区是触发条件；shown 是渲染快照，不该进依赖
  useEffect(() => {
    void load().catch((e: Error) => onNotice(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, effRange, ckSig, status.worktree])

  // 首渲染用 store 里已知的改动数据打底（$changesDiff 由上一次 load / StatusBar 写入），
  // 避免闪一下空态；load() 回来后就以 shown/latest 为准
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只读一次，store 稳定不该进依赖
  const seeded = useMemo(() => {
    const d = store.$changesDiff.get()
    if (d.diff !== null) return { available: true, files: toFileViews(d.diff.files), fallbackNames: [] }
    if (d.fallbackNames.length > 0)
      return { available: false, reason: tr('web.changes.noSnapshot'), files: [], fallbackNames: d.fallbackNames }
    return null
  }, [])

  const view = shown ?? seeded ?? { available: true, files: [], fallbackNames: [] }
  const fileRows = view.files
  // 改动文件 → 对话定位：当前范围每个文件首次出现在事件流的 seq（SPEC-M14-002 取舍-1）；
  // baseline（worktree 对比）没有事件区间 → 空表，不画定位按钮
  // biome-ignore lint/correctness/useExhaustiveDependencies: stepRanges 是读当前状态的闭包（同 load 的用法），events/effRange 变化即重算
  const fileSeqs = useMemo(() => {
    const m = new Map<string, number>()
    if (!view.available || effRange === 'baseline') return m
    const seq = changesRangeSeq(events, effRange, head, stepRanges())
    if (seq === null) return m
    for (const f of view.files) {
      const s = changeFileSeq(events, f.path, seq.fromSeq, seq.toSeq)
      if (s !== null) m.set(f.path, s)
    }
    return m
  }, [events, head, view, effRange])
  // biome-ignore lint/correctness/useExhaustiveDependencies: fileRows 由 view 派生，shown 变化即变
  const dirGroups = useMemo(() => {
    const dirOf = (p: string): string => {
      const i = p.lastIndexOf('/')
      return i < 0 ? '\u0000' : p.slice(0, i)
    }
    const groups = new Map<string, ChangeFileView[]>()
    for (const f of [...fileRows].sort((a, b) => a.path.localeCompare(b.path))) {
      const d = dirOf(f.path)
      groups.set(d, [...(groups.get(d) ?? []), f])
    }
    return [...groups.entries()]
  }, [shown])

  // biome-ignore lint/correctness/useExhaustiveDependencies: fileRows 由 view 派生，shown 变化即变
  const totals = useMemo(() => {
    let added = 0
    let removed = 0
    for (const f of fileRows) {
      added += f.added
      removed += f.removed
    }
    return { added, removed }
  }, [shown])

  const select = (path: string): void => {
    store.setInspector({ detail: { kind: 'file', id: path } })
    setMenu(null)
  }
  const backToList = (): void => store.setInspector({ detail: null })
  const setRange = (r: ChangesRange): void => {
    // 选中保持由 load() 里的 keepSelection 决定（新范围没有该文件才回列表，AC-1）
    store.setInspector({ changesRange: r })
  }

  const discard = async (path: string): Promise<void> => {
    if (busy) return
    try {
      if (effRange === 'baseline') {
        await client.discardChange(sessionId, path)
      } else {
        const seq = changesRangeSeq(events, effRange, head, stepRanges())
        if (seq !== null) await client.checkpointDiscard(sessionId, path, seq.fromSeq, seq.toSeq)
      }
      await load()
    } catch (e) {
      onNotice((e as Error).message)
    }
  }
  const discardAll = async (): Promise<void> => {
    if (busy || fileRows.length === 0) return
    if (!armedAll) {
      setArmedAll(true)
      return
    }
    setArmedAll(false)
    for (const f of fileRows) await discard(f.path)
  }
  const undo = async (entry: { path: string; trash?: string; eventSeq?: number }): Promise<void> => {
    if (busy) return
    try {
      if (entry.trash !== undefined) await client.restoreChange(sessionId, entry.trash)
      else if (entry.eventSeq !== undefined) {
        await client.checkpointDiscardUndo(sessionId, entry.eventSeq)
        setUndoneCk((s) => new Set(s).add(entry.eventSeq as number))
      }
      await load()
    } catch (e) {
      onNotice((e as Error).message)
    }
  }

  // 可撤销的丢弃：基线（worktree）从事件投影；非基线从 fs.discard 事件投影
  const ckUndoable = useMemo(() => {
    const out: Array<{ path: string; eventSeq: number }> = []
    for (const e of events) {
      if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.discard') continue
      if (undoneCk.has(e.seq)) continue
      out.push({ path: e.ev.path, eventSeq: e.seq })
    }
    return out.reverse()
  }, [events, undoneCk])
  const wtUndoable = effRange === 'baseline' ? worktreeUndoable(items) : []
  const undoable = effRange === 'baseline' ? wtUndoable : ckUndoable

  const quote = (path: string): void => {
    if (onRefsChange === undefined) return
    onRefsChange([...(refs ?? []), { kind: 'file', path, lineStart: 1, lineEnd: 1, label: path }])
    setMenu(null)
  }
  const copy = async (path: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(path)
      setTimeout(() => setCopied((c) => (c === path ? null : c)), 1200)
    } catch {
      // 剪贴板不可用就不打扰
    }
    setMenu(null)
  }

  const rangeBtn = (r: ChangesRange, label: string, disabled = false): ReactNode => (
    <button
      key={typeof r === 'string' ? r : r.step}
      type="button"
      disabled={disabled}
      className={cn(
        'rounded px-2 py-0.5 text-[11px]',
        effRange === r ? 'bg-accent-d text-accent' : 'text-mut hover:bg-panel-h',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      onClick={() => setRange(r)}
      data-range={typeof r === 'string' ? r : 'step'}
    >
      {label}
    </button>
  )

  const detailFile = selected === null ? undefined : fileRows.find((f) => f.path === selected)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-part="changes-tab">
      {/* 范围选择（AC-1） */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border2 px-2 py-1">
        {rangeBtn('turn', tr('web.changes.rangeTurn'))}
        {rangeBtn('session', tr('web.changes.rangeSession'))}
        {status.worktree !== undefined && rangeBtn('baseline', tr('web.changes.rangeBaseline'))}
        {typeof insp.changesRange === 'object' && (
          <span
            className="flex items-center gap-1 rounded bg-accent-d px-2 py-0.5 text-[11px] text-accent"
            data-range="step"
          >
            {tr('web.changes.rangeStep')}
            <button
              type="button"
              onClick={() => setRange('turn')}
              aria-label={tr('web.changes.clearStep')}
              className="rounded-full px-0.5 leading-none transition-colors hover:text-ink2"
              data-action="clear-step"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {selected !== null ? (
        // ── 详情页 ──
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border2 px-2 py-1">
            <Button variant="ghost" size="xs" onClick={backToList} data-action="back-to-list">
              <IconChevron size={12} className="rotate-90" />
              {tr('web.inspector.collapseDetail')}
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{selected}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => store.setInspector({ expanded: !insp.expanded })}
              title={tr('web.inspector.expand')}
              data-action="expand-detail"
            >
              ⤢
            </Button>
          </div>
          {detailFile === undefined ? (
            <p className="px-3 py-3 text-xs text-mut">{tr('web.changes.noDiffData')}</p>
          ) : (
            <FileDetail
              file={detailFile}
              folded={folded.has(detailFile.path)}
              onToggleFold={() =>
                setFolded((s) => {
                  const n = new Set(s)
                  if (n.has(detailFile.path)) n.delete(detailFile.path)
                  else n.add(detailFile.path)
                  return n
                })
              }
              sideBySide={insp.expanded}
            />
          )}
          <div className="flex shrink-0 items-center gap-2 border-t border-border2 px-2 py-1">
            {stale && selected !== null && (
              <Button variant="primary" size="xs" data-action="refresh-changes" onClick={() => void load()}>
                {tr('web.changes.refresh')}
              </Button>
            )}
            <Button
              variant="danger"
              size="xs"
              disabled={busy}
              onClick={() => void discard(selected as string)}
              data-action="discard-file"
            >
              <IconTrash size={11} />
              {tr('web.changes.discard')}
            </Button>
          </div>
        </div>
      ) : (
        // ── 列表页 ──
        <div className="flex min-h-0 flex-1 flex-col">
          {view.available === false && (
            <p className="shrink-0 px-3 py-1.5 text-[11.5px] text-warn" data-part="changes-degraded">
              {view.reason ?? tr('web.changes.noSnapshot')}
              {view.fallbackNames.length > 0 && <span className="text-mut"> {tr('web.changes.fallbackInferred')}</span>}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-[11.5px] text-mut" data-part="changes-total">
            <span>
              {tr('web.changes.filesTotal', {
                added: totals.added,
                removed: totals.removed,
                total: view.available ? fileRows.length : view.fallbackNames.length,
              })}
            </span>
            <span className="ml-auto" />
            {view.available && fileRows.length > 0 && (
              <Button
                variant={armedAll ? 'armed' : 'outline'}
                size="xs"
                disabled={busy}
                title={tr('web.changes.discardAllHint')}
                onClick={() => void discardAll()}
                onBlur={() => setArmedAll(false)}
                data-action="discard-all"
              >
                <IconTrash size={11} />
                {armedAll ? tr('common.confirmDelete') : tr('web.changes.discardAll')}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {view.available && fileRows.length === 0 && (
              <p className="px-3 py-3 text-xs text-mut">{tr('web.changes.none')}</p>
            )}
            {view.available &&
              dirGroups.map(([dir, files]) => {
                const openDir = !dirs.has(dir)
                return (
                  <div key={dir}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-[11px] font-medium text-mut2 hover:bg-panel-h"
                      onClick={() =>
                        setDirs((s) => {
                          const n = new Set(s)
                          if (n.has(dir)) n.delete(dir)
                          else n.add(dir)
                          return n
                        })
                      }
                      data-dir={dir}
                    >
                      <IconChevron size={10} className={cn('transition-transform', openDir ? '' : '-rotate-90')} />
                      {dir === '\u0000' ? '·' : dir}
                      <span className="ml-auto pr-1 font-normal text-mut">{files.length}</span>
                    </button>
                    {openDir &&
                      files.map((f) => (
                        <FileRow
                          key={f.path}
                          file={f}
                          busy={busy}
                          menu={menu}
                          onMenu={setMenu}
                          onSelect={() => select(f.path)}
                          onDiscard={() => void discard(f.path)}
                          onQuote={() => quote(f.path)}
                          onCopy={() => void copy(f.path)}
                          copied={copied === f.path}
                          fileSeq={fileSeqs.get(f.path)}
                          onLocate={onLocate}
                        />
                      ))}
                  </div>
                )
              })}
            {view.available === false && (
              <ul className="px-2">
                {view.fallbackNames.map((p) => (
                  <li key={p} className="flex items-center gap-2 px-2 py-1 text-xs text-mut">
                    <span className="rounded-[10px] bg-panel-h px-[7px] py-px text-[10.5px] text-mut2">
                      {tr('web.changes.rangeTurn')}
                    </span>
                    <code className="truncate font-mono">{p}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* 撤销丢弃 */}
          {undoable.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border2 px-2 py-1 text-[11px] text-mut">
              {tr('web.changes.undoDiscard')}
              {undoable.map((u) => (
                <Button
                  key={'trash' in u ? u.trash : String(u.eventSeq)}
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => void undo(u)}
                  data-action="undo-discard"
                >
                  <IconRestore size={10} />
                  <code className="font-mono">{u.path}</code>
                </Button>
              ))}
            </div>
          )}
          {/* 带回三选一（仅对比基线，PRD-M7-006 AC-3 行为不变） */}
          {effRange === 'baseline' && view.available && fileRows.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border2 px-2 py-1 text-[11px]">
              <span className="text-mut">{tr('web.changes.applyTo')}</span>
              {(
                [
                  ['squash', tr('web.changes.squash'), tr('web.changes.squashHint')],
                  ['merge', tr('web.changes.merge'), tr('web.changes.mergeHint')],
                  ['branch', tr('web.changes.branchOnly'), tr('web.changes.branchOnlyHint')],
                ] as Array<['squash' | 'merge' | 'branch', string, string]>
              ).map(([mode, label, hint]) => (
                <Button
                  key={mode}
                  variant={mode === 'squash' ? 'primary' : 'outline'}
                  size="xs"
                  disabled={busy}
                  title={hint}
                  onClick={() =>
                    void client.applyChanges(sessionId, mode).then(
                      (r) => onNotice((r as { message?: string }).message ?? null),
                      (e: Error) => onNotice(e.message),
                    )
                  }
                  data-action={`apply-${mode}`}
                >
                  {label}
                </Button>
              ))}
              <span className="text-mut2">{tr('web.changes.confirmAgain')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  busy,
  menu,
  onMenu,
  onSelect,
  onDiscard,
  onQuote,
  onCopy,
  copied,
  fileSeq,
  onLocate,
}: {
  file: ChangeFileView
  busy: boolean
  menu: string | null
  onMenu: (p: string | null) => void
  onSelect: () => void
  onDiscard: () => void
  onQuote: () => void
  onCopy: () => void
  copied: boolean
  /** 该文件在当前范围的第一个事件 seq；没有（baseline）→ 不画定位按钮 */
  fileSeq: number | undefined
  onLocate: ((seq: number) => void) | undefined
}) {
  const mark = STATUS_MARK[file.status] ?? { label: file.status, cls: 'bg-panel-h text-mut' }
  return (
    <div className="group relative flex items-center gap-2 px-2 py-[3px] hover:bg-panel-h" data-file={file.path}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs" onClick={onSelect}>
        <span className={cn('shrink-0 rounded-[10px] px-[7px] py-px text-[10px] font-semibold', mark.cls)}>
          {mark.label}
        </span>
        <code className="min-w-0 truncate font-mono">{file.path}</code>
        {(file.added > 0 || file.removed > 0) && (
          <span className="ml-auto shrink-0 pr-1 font-mono text-[10.5px]">
            <span className="text-ok">+{file.added}</span>
            <span className="text-bad"> −{file.removed}</span>
          </span>
        )}
      </button>
      {fileSeq !== undefined && onLocate !== undefined && (
        <button
          type="button"
          className="shrink-0 rounded px-1 py-0.5 text-[11px] text-mut transition-colors hover:bg-panel-h hover:text-accent"
          data-action="locate-file"
          title={tr('web.changes.locate')}
          onClick={() => onLocate(fileSeq)}
        >
          ◎
        </button>
      )}
      {!busy && (
        <Button
          variant="danger"
          size="xs"
          onClick={onDiscard}
          data-action="discard-file-row"
          title={tr('web.changes.discardHint')}
        >
          <IconTrash size={10} />
        </Button>
      )}
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-mut2 hover:bg-panel"
        title={tr('common.view')}
        onClick={() => onMenu(menu === file.path ? null : file.path)}
        data-action="file-menu"
        aria-label={file.path}
      >
        <IconChevron size={11} className="-rotate-90" />
      </button>
      {menu === file.path && (
        <div
          className="absolute right-2 top-6 z-10 min-w-[140px] rounded-md border border-border2 bg-panel shadow-md"
          data-part="file-menu"
        >
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-panel-h"
            onClick={onCopy}
          >
            <IconCopy size={11} />
            {copied ? tr('web.changes.copied') : tr('web.changes.copyPath')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-panel-h"
            onClick={onQuote}
          >
            <IconQuote size={11} />
            {tr('web.changes.quoteToInput')}
          </button>
        </div>
      )}
    </div>
  )
}

/** 单文件 diff：折叠规则 / 图片 / 二进制 / 未快照 / 统一或左右对照 */
function FileDetail({
  file,
  folded,
  onToggleFold,
  sideBySide,
}: {
  file: ChangeFileView
  folded: boolean
  onToggleFold: () => void
  sideBySide: boolean
}) {
  if (isImage(file.path)) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <p className="text-xs text-mut" data-part="file-image">
          {tr('web.changes.imageCompare')} <code className="font-mono">{file.path}</code>
        </p>
      </div>
    )
  }
  if (file.patch === '') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <p className="text-xs text-mut" data-part="file-binary">
          {tr('web.changes.binary')}
          {file.truncated ? ` ${tr('web.changes.truncated')}` : ''}
        </p>
      </div>
    )
  }
  const lineCount = file.patch.split('\n').length
  if (shouldFold(file) && !folded) {
    return (
      <div className="flex items-center gap-2 px-3 py-2" data-part="file-folded">
        <p className="text-xs text-mut">{tr('web.changes.folded', { lines: lineCount })}</p>
        <Button variant="ghost" size="xs" onClick={onToggleFold} data-action="unfold-file">
          {tr('common.view')}
        </Button>
      </div>
    )
  }
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto', sideBySide ? 'grid grid-cols-2 divide-x divide-border2' : '')}>
      {sideBySide ? (
        <>
          <DiffLines patch={file.patch} />
          <div />
        </>
      ) : (
        <DiffLines patch={file.patch} />
      )}
    </div>
  )
}

const isImage = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic)$/i.test(path)
