/**
 * 新对话（`#/`）—— PRD-M8-002 AC-5：空白的自由会话。版式沿用原型的项目详情页。
 * 自由会话与项目脱钩（PRD-M8-004）要等协议落地；在那之前新建的会话仍在 domid 的默认目录里。
 * 默认模型还没有 key 时（OPT-M8-001）顶上挂一条引导去设置页，发送也先拦下——不然会先建出一个空会话再被拒。
 */

import { type DomiClient, defaultProviderMissingKey, missingCredentialOf } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { type ReactNode, useEffect, useState } from 'react'
import type { SessionRow } from '../layout/data.ts'
import { dotOf, titleOf } from '../layout/data.ts'
import { formatRoute, navigate } from '../router.ts'
import { CredentialNotice } from '../session/CredentialNotice.tsx'
import { Composer } from '../session/SessionView.tsx'
import { ListRow, Notice, Page } from './Page.tsx'

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
  const [notice, setNotice] = useState<ReactNode>(null)
  // 缺 key 的那一家；null = 不缺或还不知道。每次回到首页都重新问一遍（设置页填完回来就消失）
  const [missing, setMissing] = useState<string | null>(null)
  useEffect(() => {
    if (!online) return
    let live = true
    client.getSettings().then(
      (s) => live && setMissing(defaultProviderMissingKey(s)),
      // 老 domid 没有 config.get：不提前引导，提交时 daemon 照样会说
      () => live && setMissing(null),
    )
    return () => {
      live = false
    }
  }, [client, online])
  return (
    <Page view="home" narrow title={tr('web.sidebar.newChat')} sub={tr('web.home.sub')}>
      {missing !== null && (
        <Notice>
          <CredentialNotice provider={missing} />
        </Notice>
      )}
      <Composer
        className="mb-7 px-0 pb-0"
        busy={!online}
        notice={notice}
        placeholder={tr('web.home.placeholder')}
        submitLabel={tr('web.home.start')}
        tools={{ client, hint: tr('web.home.attachLater') }}
        onSubmit={async (text, extras) => {
          if (missing !== null) {
            setNotice(<CredentialNotice provider={missing} />)
            throw new Error('missing credential')
          }
          try {
            const id = await client.createSession()
            await client.submit(id, text, undefined, { skills: extras.skills })
            onCreated(id)
            navigate({ view: 'session', id, tab: 'chat' })
          } catch (e) {
            const provider = missingCredentialOf(e)
            setNotice(
              provider !== null ? <CredentialNotice provider={provider} /> : e instanceof Error ? e.message : String(e),
            )
            throw e
          }
        }}
      />
      {recent.length > 0 && (
        <>
          <div className="caps mb-2">{tr('web.home.recent')}</div>
          {recent.slice(0, 5).map((s) => (
            <ListRow
              key={s.id}
              href={formatRoute({ view: 'session', id: s.id, tab: 'chat' })}
              state={dotOf(s)}
              title={titleOf(s)}
              meta={tr('web.home.meta', { model: s.model, eventCount: s.eventCount })}
            />
          ))}
        </>
      )}
    </Page>
  )
}
