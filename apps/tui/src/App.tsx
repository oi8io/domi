import type { SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { Box } from 'ink'
import { ConfirmDialog } from './components/ConfirmDialog.tsx'
import { Spinner } from './components/Spinner.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Transcript } from './components/Transcript.tsx'

/**
 * INV-02：`apps/tui` 零业务逻辑。
 * 这个组件只做一件事——把 store 的三个 atom 画出来。
 * 任何 if 里写了"该不该调这个工具""要不要重试"，就是业务逻辑跑到端上来了。
 */
export function App({ store }: { store: SessionStore }): React.ReactElement {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)

  return (
    <Box flexDirection="column">
      <Transcript items={items} />
      {status.busy && ask === null ? <Spinner /> : null}
      {ask ? <ConfirmDialog ask={ask} /> : null}
      <StatusBar status={status} />
    </Box>
  )
}
