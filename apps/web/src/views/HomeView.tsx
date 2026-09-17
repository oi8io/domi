/**
 * 新对话（`#/`）—— PRD-M8-002 AC-5：空白的自由会话。版式沿用原型的项目详情页。
 * 自由会话与项目脱钩（PRD-M8-004）要等协议落地；在那之前新建的会话仍在 domid 的默认目录里。
 */
import type { DomiClient } from '@domi/client-core'
import { useState } from 'react'
import type { SessionRow } from '../layout/data.ts'
import { dotOf, titleOf } from '../layout/data.ts'
import { formatRoute, navigate } from '../router.ts'
import { Composer } from '../session/SessionView.tsx'
import { ListRow, Page } from './Page.tsx'

export function HomeView({
  client,
  online,
  recent,
  onCreated,
}: {
  client: DomiClient
  online: boolean
  recent: readonly SessionRow[]
  onCreated: (id: string) => void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <Page view="home" narrow title="新对话" sub="不关联项目的自由讨论。要在某个仓库里动手，用「新任务」。">
      <Composer
        className="mb-7 px-0 pb-0"
        busy={!online}
        notice={notice}
        placeholder="有什么想聊的？  (Enter 发送，Shift+Enter 换行)"
        submitLabel="开始对话"
        onSubmit={async (text) => {
          try {
            const id = await client.createSession()
            await client.submit(id, text)
            onCreated(id)
            navigate({ view: 'session', id, tab: 'chat' })
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e))
            throw e
          }
        }}
      />
      {recent.length > 0 && (
        <>
          <div className="caps mb-2">最近会话</div>
          {recent.slice(0, 5).map((s) => (
            <ListRow
              key={s.id}
              href={formatRoute({ view: 'session', id: s.id, tab: 'chat' })}
              state={dotOf(s)}
              title={titleOf(s)}
              meta={`${s.model} · ${s.eventCount} 事件`}
            />
          ))}
        </>
      )}
    </Page>
  )
}
