/**
 * 改动条 —— PRD-M8-006 AC-2 · PRD-M7-006 AC-2 / AC-3。
 * 任务在单独的工作区里改（系统决定的，界面上不提「隔离」）；有待带回的改动时，顶部出现
 * 「N 个文件改动 · 查看 · 带回」。展开是逐文件审阅：看 diff、丢弃（可撤销）、带回三选一（daemon 会再问一次人）。
 * 数据都从 daemon 拿（worktree.diff），这里不算任何东西（INV-02）。
 */
import type { DomiClient, TranscriptItem } from '@domi/client-core'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'

type Diff = Awaited<ReturnType<DomiClient['worktreeDiff']>>
type ApplyMode = 'squash' | 'merge' | 'branch'

const MARK: Record<string, { label: string; cls: string }> = {
  added: { label: '新增', cls: 'bg-ok-d text-ok' },
  modified: { label: '修改', cls: 'bg-accent-d text-accent' },
  deleted: { label: '删除', cls: 'bg-bad-d text-bad' },
  renamed: { label: '改名', cls: 'bg-warn-d text-warn' },
}

const APPLY: Array<{ mode: ApplyMode; label: string; hint: string }> = [
  { mode: 'squash', label: '压成一个提交', hint: '推荐：原仓库多一个提交' },
  { mode: 'merge', label: '合并带回', hint: '保留这里的每个提交' },
  { mode: 'branch', label: '只留分支', hint: '不动原仓库的当前分支' },
]

/** 丢弃记录里还能撤销的（按事件投影：丢弃之后没被恢复过） */
export function undoable(items: readonly TranscriptItem[]): Array<{ path: string; trash: string }> {
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

/** 逐文件审阅（展开后的内容） */
export function ChangesView({
  diff,
  busy,
  onDiscard,
}: {
  diff: Diff
  busy: boolean
  onDiscard?: (path: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="grid gap-1.5" data-part="changes">
      <p className="text-[11.5px] text-mut2">
        分支 <code className="font-mono">{diff.branch}</code>，基于{' '}
        <code className="font-mono">{diff.base.slice(0, 8)}</code>
        ；原仓库 <code className="font-mono">{diff.repo}</code>
      </p>
      {diff.files.length === 0 ? (
        <p className="text-xs text-mut">还没有改动</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border2">
          {diff.files.map((f) => {
            const mark = MARK[f.status] ?? { label: f.status, cls: 'bg-panel-h text-mut' }
            return (
              <li key={f.path} className="border-b border-border2 last:border-b-0" data-file={f.path}>
                <div className="flex items-center gap-2 bg-panel px-3 py-1.5 hover:bg-panel-h">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12.5px]"
                    onClick={() => setOpen(open === f.path ? null : f.path)}
                  >
                    <span className={cn('rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold', mark.cls)}>
                      {mark.label}
                    </span>
                    <code className="truncate font-mono">{f.path}</code>
                  </button>
                  {onDiscard && (
                    <Button variant="danger" size="xs" disabled={busy} onClick={() => onDiscard(f.path)}>
                      丢弃
                    </Button>
                  )}
                </div>
                {open === f.path && (
                  <pre className="max-h-[320px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {f.patch === '' ? '（二进制或空文件）' : f.patch}
                    {f.truncated ? '\n…（太长，已截断）' : ''}
                  </pre>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function ChangesBar({
  client,
  sessionId,
  busy,
  items,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  items: readonly TranscriptItem[]
}) {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [shown, setShown] = useState(false)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    client.worktreeDiff(sessionId).then(setDiff, (e: Error) => setNotice(e.message))
  }, [client, sessionId])

  // 每一轮结束（busy 变回 false）刷新一次；事件条数变了也刷新（丢弃 / 恢复 / 带回）
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length 是刷新的触发条件
  useEffect(() => {
    if (!busy) load()
  }, [busy, load, items.length])

  const act = (p: Promise<unknown>, done?: (r: unknown) => void): void => {
    p.then(
      (r) => {
        done?.(r)
        load()
      },
      (e: Error) => setNotice(e.message),
    )
  }
  const undo = undoable(items)
  const count = diff?.files.length ?? 0
  // 没有改动、也没有可撤销的丢弃、也没有要说的话 → 整条不出现
  if (count === 0 && undo.length === 0 && notice === null) return null

  return (
    <div className="shrink-0 border-b border-border2 bg-panel px-5 py-1.5 text-xs" data-part="changes-bar">
      <div className="flex flex-wrap items-center gap-2">
        {count > 0 && (
          <>
            <span className="font-medium text-ink2">
              <b className="text-accent">{count}</b> 个文件改动
            </span>
            <span className="text-mut2">·</span>
            <Button variant="ghost" size="xs" onClick={() => setShown(!shown)} data-action="changes-view">
              {shown ? '收起' : '查看'}
            </Button>
            <span className="text-mut2">·</span>
            <Button
              variant={applying ? 'outline' : 'primary'}
              size="xs"
              disabled={busy}
              onClick={() => setApplying(!applying)}
              data-action="changes-apply"
            >
              带回
            </Button>
          </>
        )}
        {undo.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-mut">
            撤销丢弃：
            {undo.map((u) => (
              <Button
                key={u.trash}
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => act(client.restoreChange(sessionId, u.trash))}
              >
                <code className="font-mono">{u.path}</code>
              </Button>
            ))}
          </span>
        )}
        {notice !== null && (
          <span className="min-w-0 flex-1 truncate text-right text-mut" title={notice}>
            {notice}
          </span>
        )}
      </div>
      {applying && count > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-part="apply-modes">
          <span className="text-mut">带回原仓库：</span>
          {APPLY.map((a) => (
            <Button
              key={a.mode}
              variant={a.mode === 'squash' ? 'primary' : 'outline'}
              size="xs"
              disabled={busy}
              title={a.hint}
              onClick={() => {
                setApplying(false)
                act(client.applyChanges(sessionId, a.mode), (r) => setNotice((r as { message: string }).message))
              }}
            >
              {a.label}
            </Button>
          ))}
          <span className="text-mut2">会再请你确认一次</span>
        </div>
      )}
      {shown && diff !== null && (
        <div className="mt-2 max-h-[45vh] overflow-y-auto pb-1">
          <ChangesView
            diff={diff}
            busy={busy}
            onDiscard={(path) => act(client.discardChange(sessionId, path), () => setNotice(null))}
          />
        </div>
      )}
    </div>
  )
}
