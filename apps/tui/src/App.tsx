import type { ConnectionState, SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { Box, useBoxMetrics, useWindowSize } from 'ink'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog.tsx'
import { ContextBar, DEFAULT_HINTS, KeyHints } from './components/ContextBar.tsx'
import { Spinner } from './components/Spinner.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { ClassicTranscript, Transcript, useTranscriptLines, Viewport } from './components/Transcript.tsx'
import {
  applyScroll,
  type createScrollBus,
  INITIAL_SCROLL,
  onContentChange,
  type Renderer,
  type ScrollState,
} from './render/viewport.ts'
import { useTheme } from './theme.ts'

/**
 * INV-02：`apps/tui` 零业务逻辑。
 * 这个组件只做一件事——把 store 的几个 atom 画出来（布局按 docs/ui-redesign/tui.html）：
 * 顶栏 → 对话流 → 内嵌确认框 → 输入区（children）→ 状态栏 → 按键提示。
 */
export function App({
  store,
  context,
  connection,
  children,
  overlay,
  renderer,
  scrollBus,
  reasonsExpanded = false,
}: {
  store: SessionStore
  /** 顶栏；不给就不画（测试、嵌入） */
  context?: { project: string | null; title: string } | undefined
  connection?: ConnectionState | undefined
  /** 输入区：提示信息与输入行 */
  children?: ReactNode
  /** 弹层（PRD-M8-015）：打开时顶替对话区；有确认框时让位给确认框 */
  overlay?: ReactNode
  /**
   * 渲染器（PRD-M9-005）。不给 = 老的整段渲染（测试、嵌入用）；classic = 定型条目进 Static；
   * fullscreen = 固定高度、只画可见行、输入区钉在底部
   */
  renderer?: Renderer | undefined
  /** fullscreen 的滚动命令从这里来（Root 收按键与滚轮） */
  scrollBus?: ReturnType<typeof createScrollBus> | undefined
  /** PRD-M10-005：true = reason 行展开（e 键切换，纯展示层，不持久化） */
  reasonsExpanded?: boolean
}): React.ReactElement {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)

  if (renderer === 'fullscreen') {
    return (
      <FullscreenLayout
        store={store}
        context={context}
        connection={connection}
        overlay={overlay}
        scrollBus={scrollBus}
        reasonsExpanded={reasonsExpanded}
      >
        {children}
      </FullscreenLayout>
    )
  }

  return (
    <Box flexDirection="column">
      {context !== undefined && (
        <ContextBar project={context.project} title={context.title} turns={status.metrics?.turns} />
      )}
      {overlay !== undefined && overlay !== null && ask === null ? (
        overlay
      ) : (
        <>
          {renderer === 'classic' ? (
            <ClassicTranscript items={items} reasonsExpanded={reasonsExpanded} />
          ) : (
            <Transcript items={items} reasonsExpanded={reasonsExpanded} />
          )}
          {status.busy && ask === null ? <Spinner /> : null}
          {ask ? <ConfirmDialog ask={ask} /> : null}
          {children}
        </>
      )}
      <StatusBar status={status} {...(connection === undefined ? {} : { connection })} />
      <KeyHints hints={DEFAULT_HINTS(renderer)} />
    </Box>
  )
}

/**
 * fullscreen 布局（PRD-M9-005 AC-2 / AC-3）：整屏高度，对话区占满剩下的空间、只画可见行，
 * 输入区、状态栏、快捷键行钉在底部。滚动状态在这里：总行数与可见高度只有这里知道
 */
function FullscreenLayout({
  store,
  context,
  connection,
  overlay,
  scrollBus,
  children,
  reasonsExpanded,
}: {
  store: SessionStore
  context?: { project: string | null; title: string } | undefined
  connection?: ConnectionState | undefined
  overlay?: ReactNode
  scrollBus?: ReturnType<typeof createScrollBus> | undefined
  children?: ReactNode
  reasonsExpanded: boolean
}): React.ReactElement {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)
  const theme = useTheme()
  const { columns, rows } = useWindowSize()
  const ref = useRef(null)
  const box = useBoxMetrics(ref as never)
  const height = box.hasMeasured ? box.height : 0
  // 右边留一列给滚动条
  const lines = useTranscriptLines(items, Math.max(10, columns - 1), theme, reasonsExpanded)
  const [scroll, setScroll] = useState<ScrollState>(INITIAL_SCROLL)

  // 内容变了：往上翻着的时候保持看到的那一屏不动，并数新来了几条
  const prev = useRef({ lines: lines.length, items: items.length })
  useEffect(() => {
    const addedLines = lines.length - prev.current.lines
    const addedItems = items.length - prev.current.items
    prev.current = { lines: lines.length, items: items.length }
    if (addedLines !== 0 || addedItems !== 0) {
      setScroll((s) => onContentChange(s, { addedLines, addedItems, total: lines.length, height }))
    }
  }, [lines.length, items.length, height])

  const latest = useRef({ total: lines.length, height })
  latest.current = { total: lines.length, height }
  useEffect(
    () => scrollBus?.on((cmd) => setScroll((s) => applyScroll(s, cmd, latest.current.total, latest.current.height))),
    [scrollBus],
  )

  return (
    <Box flexDirection="column" height={rows}>
      {context !== undefined && (
        <ContextBar project={context.project} title={context.title} turns={status.metrics?.turns} />
      )}
      {overlay !== undefined && overlay !== null && ask === null ? (
        <Box flexGrow={1} flexDirection="column">
          {overlay}
        </Box>
      ) : (
        <>
          <Box ref={ref} flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="column">
            {height > 0 && <Viewport lines={lines} height={height} offset={scroll.offset} unseen={scroll.unseen} />}
          </Box>
          {status.busy && ask === null ? <Spinner /> : null}
          {ask ? <ConfirmDialog ask={ask} /> : null}
          {children}
        </>
      )}
      <StatusBar status={status} {...(connection === undefined ? {} : { connection })} />
      <KeyHints hints={DEFAULT_HINTS('fullscreen')} />
    </Box>
  )
}
