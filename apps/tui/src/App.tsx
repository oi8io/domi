import type { ConnectionState, SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { Box } from 'ink'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog.tsx'
import { ContextBar, DEFAULT_HINTS, KeyHints } from './components/ContextBar.tsx'
import { Spinner } from './components/Spinner.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Transcript } from './components/Transcript.tsx'

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
}: {
  store: SessionStore
  /** 顶栏；不给就不画（测试、嵌入） */
  context?: { project: string | null; title: string } | undefined
  connection?: ConnectionState | undefined
  /** 输入区：提示信息与输入行 */
  children?: ReactNode
  /** 弹层（PRD-M8-015）：打开时顶替对话区；有确认框时让位给确认框 */
  overlay?: ReactNode
}): React.ReactElement {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)

  return (
    <Box flexDirection="column">
      {context !== undefined && (
        <ContextBar project={context.project} title={context.title} turns={status.metrics?.turns} />
      )}
      {overlay !== undefined && overlay !== null && ask === null ? (
        overlay
      ) : (
        <>
          <Transcript items={items} />
          {status.busy && ask === null ? <Spinner /> : null}
          {ask ? <ConfirmDialog ask={ask} /> : null}
          {children}
        </>
      )}
      <StatusBar status={status} {...(connection === undefined ? {} : { connection })} />
      <KeyHints hints={DEFAULT_HINTS()} />
    </Box>
  )
}
