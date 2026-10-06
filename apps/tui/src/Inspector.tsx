/**
 * TUI 右侧栏 —— PRD-M14-009 AC-1…AC-5 · SPEC-M14-009
 *
 * 复用与 Web 相同的 client-core 投影（planView / changesView / artifactsView / contextView），
 * 数据源是 store 的原始事件镜像 $events（001 落）——parity 的关键（AC-2）。
 * 布局：`process.stdout.columns ≥ 140` → 右侧分栏（主区列数 − 40，右栏取剩余）；否则全屏覆盖层（AC-1）。
 * 键位：`i` 开 / 关、数字 1–4 切 tab、覆盖层 Esc 由 main.tsx 的 useInput 处理；
 * 本组件只处理列表 ↑↓、Enter、←（AC-1）。
 * 取舍-2：改动 tab 不做词级高亮 / 左右对照 / 图片预览；产物 tab 只列清单与路径（Markdown 内联）；行评论不做。
 */

import type { CheckpointDiffResult, DomiClient, SessionStore } from '@domi/client-core'
import {
  artifactsView,
  changesRangeSeq,
  changesView,
  contextView,
  fsSnapshotNames,
  planView,
  stepIntervals,
} from '@domi/client-core'
import { highlightLines } from '@domi/client-core/highlight'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { Box, Text, useInput } from 'ink'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownBlocks } from './components/Transcript.tsx'
import { type Block, parseMarkdownBlocks } from './render/markdown.ts'
import { useTheme } from './theme.ts'

/** SPEC-M14-009 取舍-1：终端宽度断点。≥140 列 → 右侧分栏，否则全屏覆盖层（AC-1） */
export function inspectorMode(columns: number): 'side' | 'overlay' {
  return columns >= 140 ? 'side' : 'overlay'
}

function fmtMs(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtSize(n: number | null | undefined): string {
  if (n === undefined || n === null) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/** 进度 tab（PRD-M14-004 parity）：计划步列表 + 剩余 + verify；无计划时给动作摘要 */
function ProgressTab({ store }: { store: SessionStore }): ReactElement {
  const t = useTheme()
  const events = useStore(store.$events)
  const head = events.length > 0 ? events[events.length - 1]!.seq : 0
  const view = planView(events, head)
  if (view.kind === 'summary') {
    return (
      <Box flexDirection="column">
        <Text {...t.fg('mut')}>{tr('tui.inspector.progress.noPlan')}</Text>
        {Object.entries(view.counts).map(([name, count]) => (
          <Text key={name}>
            {name} × {count}
          </Text>
        ))}
      </Box>
    )
  }
  const icon: Record<string, string> = { pending: '○', in_progress: '◐', done: '●', skipped: '−' }
  return (
    <Box flexDirection="column">
      {view.steps.map((step) => (
        <Text key={step.step.id}>
          <Text {...t.fg(step.step.status === 'done' ? 'ok' : step.step.status === 'in_progress' ? 'accent' : 'mut')}>
            {icon[step.step.status] ?? '?'}
          </Text>{' '}
          {step.step.text}
          {step.durationMs !== null && step.durationMs > 0 ? (
            <Text {...t.fg('mut')}> {fmtMs(step.durationMs)}</Text>
          ) : null}
        </Text>
      ))}
      <Text {...t.fg('mut')}>{tr('tui.inspector.progress.remaining', { n: view.remaining })}</Text>
      {view.verify !== null ? (
        <Text {...t.fg(view.verify.final ? 'ok' : 'warn')}>
          {view.verify.final ? tr('tui.inspector.progress.verifyDone') : tr('tui.inspector.progress.verifyAsk')}
        </Text>
      ) : null}
    </Box>
  )
}

/** 改动 tab（AC-3）：文件列表 + 统一 diff（+ / − 着色复用 highlightLines 的 diff 语法）；不做词级 / 左右对照 / 图片 */
function ChangesTab({
  store,
  client,
  sessionId,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
}): ReactElement {
  const t = useTheme()
  const events = useStore(store.$events)
  const status = useStore(store.$status)
  const insp = useStore(store.$inspector)
  const [diff, setDiff] = useState<CheckpointDiffResult | null>(null)
  const [fallbackNames, setFallbackNames] = useState<string[]>([])
  const seqRef = useRef(0)
  const [sel, setSel] = useState(0)

  const head = events.length > 0 ? events[events.length - 1]!.seq : 0
  const sig = useMemo(
    () =>
      events
        .filter((e) => {
          const ev = e.ev as { t?: string }
          return ev.t === 'user.input' || ev.t === 'fs.snapshot' || ev.t === 'fs.checkpoint'
        })
        .reduce((n, e) => n + e.seq, 0),
    [events],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig（文件相关事件签名）与 head 联动，head 变化必伴 sig 或首拉；client 稳定
  useEffect(() => {
    const my = ++seqRef.current
    void (async () => {
      if (head === 0) return
      if (status.worktree) {
        const w = await client.worktreeDiff(sessionId)
        if (my === seqRef.current) {
          setDiff({ available: true, files: w.files, reason: undefined })
          setFallbackNames([])
        }
        return
      }
      const seq = changesRangeSeq(events, insp.changesRange, head)
      if (seq === null) {
        if (my === seqRef.current) {
          setDiff(null)
          setFallbackNames(fsSnapshotNames(events, 1, head))
        }
        return
      }
      const d = await client.checkpointDiff(sessionId, seq)
      if (my === seqRef.current) {
        setDiff(d)
        setFallbackNames([])
      }
    })()
  }, [sig, head, status.worktree, insp.changesRange, sessionId, events])

  const steps = (() => {
    const p = planView(events, head)
    return p.kind === 'plan' ? stepIntervals(p) : undefined
  })()
  const v = changesView(events, diff, insp.changesRange, head, steps)
  const files = v.files

  // 详情 = 某个文件（写 store.$inspector.detail，与 Web 同一语义）
  const detail = insp.detail !== null && insp.detail.kind === 'file' ? insp.detail.id : null
  const detailFile = detail !== null ? files.find((f) => f.path === detail) : undefined

  const enterDetail = (): void => {
    if (detail !== null) {
      store.setInspector({ detail: null })
      return
    }
    const f = files[sel]
    if (f !== undefined) store.setInspector({ detail: { kind: 'file', id: f.path } })
  }

  // ↑↓ 列表移动、Enter 进详情、← 返回列表（SPEC-M14-009 取舍-1）
  useInput((_input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1))
    else if (key.downArrow) setSel((s) => Math.min(Math.max(files.length - 1, 0), s + 1))
    else if (key.return) enterDetail()
    else if (key.leftArrow && detail !== null) store.setInspector({ detail: null })
  })

  if (detailFile !== undefined && diff?.available === true) {
    const patch = detailFile.patch ?? ''
    return (
      <Box flexDirection="column">
        <Text {...t.fg('mut2')}>{detailFile.path}</Text>
        <Text {...t.fg('mut')}>{tr('tui.inspector.changes.detailHint')}</Text>
        {patch.split('\n').map((line, i) => {
          const spans = highlightLines(line, 'diff')[0] ?? []
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本行，顺序不可变
            <Text key={i}>
              {line.startsWith('+') && !line.startsWith('+++') ? (
                <Text {...t.syntax('added')}>{line}</Text>
              ) : line.startsWith('-') && !line.startsWith('---') ? (
                <Text {...t.syntax('removed')}>{line}</Text>
              ) : (
                spans.map((s, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                  <Text key={j} {...t.syntax(s.kind)}>
                    {s.text}
                  </Text>
                ))
              )}
            </Text>
          )
        })}
      </Box>
    )
  }

  if (v.available) {
    const rows =
      files.length === 0 ? (
        <Text {...t.fg('mut')}>{tr('tui.inspector.changes.empty')}</Text>
      ) : (
        files.map((f, i) => (
          <Text key={f.path} {...(i === sel ? { color: 'blue' } : {})}>
            {i === sel ? '▸ ' : '  '}
            {f.path}
            <Text {...t.fg('ok')}> +{f.added}</Text>
            <Text {...t.fg('bad')}> −{f.removed}</Text>
          </Text>
        ))
      )
    return (
      <Box flexDirection="column">
        {rows}
        <Text {...t.fg('mut')}>{tr('tui.inspector.changes.navHint')}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text {...t.fg('mut')}>
        {fallbackNames.length > 0 ? tr('tui.inspector.changes.noSnapshot') : tr('tui.inspector.changes.unavailable')}
      </Text>
      {fallbackNames.map((p) => (
        <Text key={p}> {p}</Text>
      ))}
    </Box>
  )
}

/** 上下文 tab（PRD-M14-006 parity）：分段堆叠条文字版 + 压缩记录 */
function ContextTab({ store }: { store: SessionStore }): ReactElement {
  const t = useTheme()
  const events = useStore(store.$events)
  const status = useStore(store.$status)
  const ctx = contextView(events, status.metrics ?? null)
  const max = ctx.segments.reduce((m, s) => Math.max(m, s.tokens), 1)
  return (
    <Box flexDirection="column">
      <Text {...t.fg('mut')}>
        {tr('tui.inspector.context.total')}: {ctx.total === null ? '—' : ctx.total}
        {ctx.window !== null ? ` / ${ctx.window}` : ''}
      </Text>
      {ctx.segments.map((seg) => (
        <Text key={seg.id}>
          {tr(`web.context.seg.${seg.id}`)} {seg.tokens}
          {' █'.repeat(Math.max(1, Math.round((seg.tokens / max) * 12)))}
        </Text>
      ))}
      {ctx.compacts.length > 0 ? (
        <>
          <Text {...t.fg('mut2')}>{tr('tui.inspector.context.compacts')}</Text>
          {ctx.compacts.map((c) => (
            <Text key={c.seq} {...t.fg('mut')}>
              seq {c.seq}{' '}
              {c.kind === 'compact' ? tr('tui.inspector.context.compactKind') : tr('tui.inspector.context.cleanupKind')}{' '}
              {c.tokensBefore}→{c.tokensAfter}
            </Text>
          ))}
        </>
      ) : null}
    </Box>
  )
}

/** 产物 tab（AC-4）：清单 + 路径；选中 Markdown 内联渲染，其余只列元信息 */
function ArtifactsTab({
  store,
  client,
  sessionId,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
}): ReactElement {
  const t = useTheme()
  const events = useStore(store.$events)
  const insp = useStore(store.$inspector)
  const [diff, setDiff] = useState<CheckpointDiffResult | null>(null)
  const [mdContent, setMdContent] = useState<readonly Block[] | null>(null)
  const seqRef = useRef(0)
  const [sel, setSel] = useState(0)

  const head = events.length > 0 ? events[events.length - 1]!.seq : 0
  const sig = useMemo(
    () =>
      events
        .filter((e) => {
          const ev = e.ev as { t?: string }
          return ev.t === 'user.input' || ev.t === 'fs.snapshot' || ev.t === 'fs.checkpoint'
        })
        .reduce((n, e) => n + e.seq, 0),
    [events],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig 联动同上；client 稳定
  useEffect(() => {
    const my = ++seqRef.current
    void (async () => {
      if (head === 0) return
      const seq = changesRangeSeq(events, 'session', head)
      if (seq === null) {
        if (my === seqRef.current) setDiff(null)
        return
      }
      const d = await client.checkpointDiff(sessionId, seq)
      if (my === seqRef.current) setDiff(d)
    })()
  }, [sig, head, sessionId, events])

  const v = artifactsView(events, diff)
  const all = [
    ...v.files.map((f) => ({ path: f.path, size: f.size, upload: false })),
    ...v.uploads.map((u) => ({ path: u.path, size: u.size, upload: true })),
  ]
  const detail = insp.detail !== null && insp.detail.kind === 'artifact' ? insp.detail.id : null

  // 选中的 Markdown 文件：拉内容内联渲染；其他类型只列路径
  useEffect(() => {
    const my = ++seqRef.current
    setMdContent(null)
    if (detail === null || !(detail.endsWith('.md') || detail.endsWith('.markdown'))) return
    void client
      .artifact(sessionId, detail)
      .then((r) => {
        if (my === seqRef.current) setMdContent(parseMarkdownBlocks(r.text ?? ''))
      })
      .catch(() => {
        if (my === seqRef.current) setMdContent([])
      })
  }, [detail, sessionId, client])

  useInput((_input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1))
    else if (key.downArrow) setSel((s) => Math.min(Math.max(all.length - 1, 0), s + 1))
    else if (key.return) {
      if (detail !== null) store.setInspector({ detail: null })
      else {
        const a = all[sel]
        if (a !== undefined) store.setInspector({ detail: { kind: 'artifact', id: a.path } })
      }
    } else if (key.leftArrow && detail !== null) store.setInspector({ detail: null })
  })

  if (detail !== null) {
    const isMd = detail.endsWith('.md') || detail.endsWith('.markdown')
    if (isMd && mdContent !== null) {
      return (
        <Box flexDirection="column">
          <Text {...t.fg('mut2')}>{detail}</Text>
          {mdContent.length === 0 ? (
            <Text {...t.fg('mut')}>{tr('tui.inspector.artifacts.noContent')}</Text>
          ) : (
            <MarkdownBlocks blocks={mdContent} />
          )}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text>{detail}</Text>
        <Text {...t.fg('mut')}>{tr('tui.inspector.artifacts.noInline')}</Text>
      </Box>
    )
  }

  if (all.length === 0) {
    return <Text {...t.fg('mut')}>{tr('tui.inspector.artifacts.empty')}</Text>
  }
  return (
    <Box flexDirection="column">
      {all.map((a, i) => (
        <Text key={a.path} {...(i === sel ? { color: 'blue' } : {})}>
          {i === sel ? '▸ ' : '  '}
          {a.upload ? '↑ ' : ''}
          {a.path}
          {a.size !== null && a.size !== undefined ? <Text {...t.fg('mut')}> {fmtSize(a.size)}</Text> : null}
        </Text>
      ))}
      <Text {...t.fg('mut')}>{tr('tui.inspector.artifacts.navHint')}</Text>
    </Box>
  )
}

const TAB_LABEL: Record<string, () => string> = {
  progress: () => tr('tui.inspector.tab.progress'),
  changes: () => tr('tui.inspector.tab.changes'),
  artifacts: () => tr('tui.inspector.tab.artifacts'),
  context: () => tr('tui.inspector.tab.context'),
}

/**
 * 右侧栏本体。mode = side（分栏右 40 列）/ overlay（全屏覆盖层）。
 * tab 切换由 main.tsx 处理；列表键在本组件内；覆盖层 Esc 也在本组件内（侧栏模式 Esc 归弹层 / 中断）。
 */
export function Inspector({
  store,
  client,
  sessionId,
  mode,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
  mode: 'side' | 'overlay'
}): ReactElement {
  const t = useTheme()
  const insp = useStore(store.$inspector)

  // 覆盖层模式：Esc 关闭（SPEC-M14-009 取舍-1）
  useInput((_input, key) => {
    if (mode === 'overlay' && key.escape) store.setInspector({ open: false })
  })

  const tabContent =
    insp.tab === 'progress' ? (
      <ProgressTab store={store} />
    ) : insp.tab === 'changes' ? (
      <ChangesTab store={store} client={client} sessionId={sessionId} />
    ) : insp.tab === 'artifacts' ? (
      <ArtifactsTab store={store} client={client} sessionId={sessionId} />
    ) : (
      <ContextTab store={store} />
    )

  return (
    <Box
      width={mode === 'side' ? 40 : undefined}
      flexDirection="column"
      borderStyle={mode === 'side' ? 'single' : undefined}
      borderLeft={mode === 'side'}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderDimColor
    >
      <Text {...t.fg('mut2')}>{TAB_LABEL[insp.tab]?.() ?? insp.tab}</Text>
      <Box flexGrow={1} flexDirection="column">
        {tabContent}
      </Box>
    </Box>
  )
}
