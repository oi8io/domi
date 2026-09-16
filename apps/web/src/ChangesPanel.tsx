/**
 * 隔离会话的改动审阅（PRD-M7-006 AC-2 / AC-3）：按文件看 diff、逐个丢弃（可撤销）、带回原仓库（会弹确认）。
 * 数据都从 daemon 拿（worktree.diff），这里不算任何东西（INV-02）。
 */
import type { DomiClient, TranscriptItem } from '@domi/client-core'
import { useCallback, useEffect, useState } from 'react'

type Diff = Awaited<ReturnType<DomiClient['worktreeDiff']>>

const MARK: Record<string, string> = { added: '新增', modified: '修改', deleted: '删除', renamed: '改名' }

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

export function ChangesView({
  diff,
  busy,
  onDiscard,
  onApply,
}: {
  diff: Diff
  busy: boolean
  onDiscard?: (path: string) => void
  onApply?: (mode: 'squash' | 'merge' | 'branch') => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="changes">
      <p className="meta">
        分支 <code>{diff.branch}</code>，相对 <code>{diff.base.slice(0, 8)}</code>；原仓库 <code>{diff.repo}</code>
      </p>
      {diff.files.length === 0 ? (
        <p className="meta">还没有改动</p>
      ) : (
        <ul className="change-files">
          {diff.files.map((f) => (
            <li key={f.path} className={`change c-${f.status}`}>
              <button type="button" className="change-path" onClick={() => setOpen(open === f.path ? null : f.path)}>
                <span className="change-mark">{MARK[f.status]}</span> {f.path}
              </button>
              {onDiscard && (
                <button type="button" className="danger" disabled={busy} onClick={() => onDiscard(f.path)}>
                  丢弃
                </button>
              )}
              {open === f.path && (
                <pre className="patch">
                  {f.patch === '' ? '（二进制或空文件）' : f.patch}
                  {f.truncated ? '\n…（太长，已截断）' : ''}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      {onApply && diff.files.length > 0 && (
        <div className="tools">
          <button type="button" className="allow" disabled={busy} onClick={() => onApply('squash')}>
            带回原仓库（压成一个提交）
          </button>
          <button type="button" disabled={busy} onClick={() => onApply('merge')}>
            合并带回
          </button>
          <button type="button" disabled={busy} onClick={() => onApply('branch')}>
            只留分支
          </button>
        </div>
      )}
    </div>
  )
}

export function ChangesPanel({
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
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    client.worktreeDiff(sessionId).then(setDiff, (e: Error) => setNotice(e.message))
  }, [client, sessionId])

  // 每一轮结束（busy 变回 false）刷新一次；事件条数变了也刷新（丢弃 / 恢复 / 带回）
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length 是刷新的触发条件
  useEffect(() => {
    if (shown && !busy) load()
  }, [shown, busy, load, items.length])

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

  return (
    <div className="changes-panel">
      <button type="button" className="changes-toggle" onClick={() => setShown(!shown)}>
        {shown ? '收起改动' : '查看改动（隔离工作区）'}
      </button>
      {notice !== null && <p className="error">{notice}</p>}
      {shown && diff !== null && (
        <ChangesView
          diff={diff}
          busy={busy}
          onDiscard={(path) => act(client.discardChange(sessionId, path), () => setNotice(null))}
          onApply={(mode) =>
            act(client.applyChanges(sessionId, mode), (r) => setNotice((r as { message: string }).message))
          }
        />
      )}
      {shown && undo.length > 0 && (
        <p className="meta">
          撤销丢弃：
          {undo.map((u) => (
            <button
              key={u.trash}
              type="button"
              disabled={busy}
              onClick={() => act(client.restoreChange(sessionId, u.trash))}
            >
              {u.path}
            </button>
          ))}
        </p>
      )}
    </div>
  )
}
