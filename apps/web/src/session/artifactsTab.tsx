/**
 * 产物 tab（右侧栏）—— PRD-M14-007（SPEC-M14-007）
 *
 * 数据：整会话 checkpoint.diff（net diff，added/renamed）+ user.input.uploads（「你给的」）；
 * 投影 = client-core artifactsView 纯函数（Web / TUI 共用）。预览内容经 session.artifact RPC。
 * 隔离任务里还没带回的产物标「未带回」（worktree 会话 + 该文件在 worktree.diff 里）。
 */
import { artifactsView, type DomiClient, type SessionStore } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { type ArtifactContent, ArtifactPreview } from './preview.tsx'

function kindOf(path: string): 'code' | 'md' | 'img' | 'csv' | 'pdf' | 'html' | 'other' {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'img'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (
    ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'sh', 'json', 'yaml', 'yml', 'toml', 'css', 'sql', 'txt'].includes(ext)
  )
    return 'code'
  return 'other'
}

const KIND_ICON: Record<ReturnType<typeof kindOf>, string> = {
  code: '⌥',
  md: 'M↓',
  img: '▣',
  csv: '≣',
  pdf: '▤',
  html: '◈',
  other: '·',
}

export function ArtifactsTab({
  client,
  sessionId,
  store,
  onLocate,
  worktreeFiles,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  /** 产物卡片 → 对话：定位到产生它的那一步（SPEC-M14-002） */
  onLocate: (seq: number) => void
  /** worktree.diff 里的文件（测试直接给；运行时空着 = 组件自己拉） */
  worktreeFiles?: readonly string[] | undefined
}): ReactNode {
  const events = useStore(store.$events)
  const status = useStore(store.$status)
  const head = events.length === 0 ? 0 : (events[events.length - 1]?.seq ?? 0)
  const [diff, setDiff] = useState<Awaited<ReturnType<DomiClient['checkpointDiff']>> | null>(null)
  const [worktree, setWorktree] = useState<Awaited<ReturnType<DomiClient['worktreeDiff']>> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const seqRef = useRef(0)

  // 事件签名：tool.call/fs.snapshot/user.input 变化才重拉 diff（token 流不触发）
  const sig = useMemo(
    () =>
      events
        .filter((e) => {
          const t = (e.ev as { t?: string }).t
          return t === 'user.input' || t === 'fs.snapshot' || t === 'fs.checkpoint'
        })
        .reduce((n, e) => n + e.seq, 0),
    [events],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig（文件相关事件签名）与 head 联动，head 变化必伴 sig 或首拉；client 是稳定实例
  useEffect(() => {
    const my = ++seqRef.current
    void (async () => {
      if (head === 0) return
      const d = await client.checkpointDiff(sessionId, { fromSeq: 1, toSeq: head })
      if (my === seqRef.current) setDiff(d)
    })()
    if (status.worktree) {
      void client.worktreeDiff(sessionId).then((w) => {
        if (my === seqRef.current) setWorktree(w)
      })
    }
    // 事件没变化也允许用户重试（diff 可能刚可用）
  }, [sig, sessionId, status.worktree])

  const v = artifactsView(events, diff)
  const notTakenBack = new Set(worktreeFiles !== undefined ? worktreeFiles : (worktree?.files ?? []).map((f) => f.path))
  const all = [...v.files.map((f) => ({ ...f, upload: false })), ...v.uploads.map((u) => ({ ...u, upload: true }))]

  // biome-ignore lint/correctness/useExhaustiveDependencies: selected 是唯一触发；client/sessionId 稳定不该进依赖
  useEffect(() => {
    if (selected === null) {
      setContent(null)
      return
    }
    const my = ++seqRef.current
    setContent(null)
    void client
      .artifact(sessionId, selected)
      .then((r) => {
        if (my === seqRef.current) setContent(r)
      })
      .catch(() => {
        if (my === seqRef.current) setContent({ mime: 'application/octet-stream', size: 0, truncated: true })
      })
  }, [selected])

  const copy = (path: string): void => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(path)
      setTimeout(() => setCopied(null), 1200)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-part="artifacts-tab">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {v.degraded && (
          <p className="mb-1 text-[10px] text-warn" data-part="degraded">
            {tr('web.artifacts.degraded')}
          </p>
        )}
        {all.length === 0 && <p className="p-2 text-xs text-mut">{tr('web.artifacts.empty')}</p>}
        {all.length > 0 && (
          <ul className="space-y-1">
            {all.map((a) => {
              const kind = kindOf(a.path)
              const taken = notTakenBack.has(a.path)
              return (
                <li key={a.path}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel-h ${
                      selected === a.path ? 'bg-panel-h ring-1 ring-border2' : ''
                    }`}
                    data-artifact={a.path}
                    onClick={() => setSelected(a.path)}
                  >
                    <span className="shrink-0 font-mono text-mut2" aria-hidden>
                      {KIND_ICON[kind]}
                    </span>
                    <span className="min-w-0 truncate font-mono text-ink2">{a.path}</span>
                    {a.approx && <span className="shrink-0 text-[9px] text-mut2">{tr('web.artifacts.approx')}</span>}
                    {taken && (
                      <span className="shrink-0 rounded bg-warn-d px-1 text-[9px] text-warn" data-part="not-taken-back">
                        {tr('web.artifacts.notTakenBack')}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-mut2">
                      {a.size === null ? '' : a.size < 1024 ? `${a.size}B` : `${Math.round(a.size / 1024)}K`}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 py-0.5 text-mut transition-colors hover:bg-panel-h hover:text-accent"
                      data-action="locate-artifact"
                      title={tr('web.artifacts.locate')}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLocate(a.seq)
                      }}
                    >
                      ◎
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 py-0.5 text-[9px] text-mut2 transition-colors hover:bg-panel-h hover:text-accent"
                      data-action="copy-artifact-path"
                      title={tr('web.artifacts.copyPath')}
                      onClick={(e) => {
                        e.stopPropagation()
                        copy(a.path)
                      }}
                    >
                      {copied === a.path ? tr('web.artifacts.copied') : tr('web.artifacts.copyPath')}
                    </button>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {selected !== null && (
          <div className="mt-2 rounded-md border border-border2 p-2" data-part="artifact-preview">
            <div className="mb-1 flex items-center gap-2">
              <p className="truncate font-mono text-[11px] text-ink2">{selected}</p>
              <button
                type="button"
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-mut transition-colors hover:bg-panel-h hover:text-accent"
                data-action="copy-artifact-path"
                onClick={() => copy(selected)}
              >
                {copied === selected ? tr('web.artifacts.copied') : tr('web.artifacts.copyPath')}
              </button>
            </div>
            <ArtifactPreview path={selected} content={content} />
          </div>
        )}
      </div>
    </div>
  )
}
