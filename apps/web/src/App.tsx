/**
 * Web 端骨架 —— PRD-M3-003
 *
 * 能连上、能列会话、能看到事件流与轨迹、能提交输入。**只渲染**：
 * 状态全在 client-core 的 atom 里，这个文件里没有一行是在算「事件意味着什么」。
 * 与 TUI 的逐项对等见 docs/parity-checklist.md。
 */
import { type ConnectionState, createSessionStore, type DomiClient, type SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { StatusBar } from './StatusBar.tsx'
import { Transcript } from './Transcript.tsx'

interface SessionRow {
  id: string
  title: string
  model: string
  eventCount: number
  deleted: boolean
}

const STATE_LABEL: Record<ConnectionState, string> = {
  idle: '未连接',
  connecting: '连接中…',
  open: '已连接',
  reconnecting: '断线，重连中…',
  incompatible: '协议版本不兼容',
  closed: '已断开',
}

export function App({ client, daemonUrl }: { client: DomiClient; daemonUrl: string }) {
  const state = useStore(client.$state)
  const lastError = useStore(client.$lastError)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [active, setActive] = useState<{ id: string; store: SessionStore } | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  useEffect(() => {
    client.start().catch(() => undefined)
    return () => client.close()
  }, [client])

  const refresh = useCallback(async (): Promise<void> => {
    const r = await client.listSessions({ includeDeleted: showDeleted })
    setSessions(r.sessions)
  }, [client, showDeleted])

  useEffect(() => {
    if (state !== 'open') return
    refresh().catch(() => undefined)
  }, [state, refresh])

  const open = (id: string): void => {
    if (active) client.unwatch(active.id)
    const store = createSessionStore()
    setActive({ id, store })
    client.watch(id, store).catch(() => undefined)
  }

  const create = async (): Promise<void> => {
    const id = await client.createSession()
    await refresh()
    open(id)
  }

  const removed = async (): Promise<void> => {
    if (active) client.unwatch(active.id)
    setActive(null)
    await refresh()
  }

  const restore = async (id: string): Promise<void> => {
    await client.restoreSession(id)
    await refresh()
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="brand">
          <span className="logo">domi</span>
          <span className={`conn conn-${state}`} title={daemonUrl}>
            {STATE_LABEL[state]}
          </span>
        </header>
        {lastError !== null && <p className="error">{lastError}</p>}
        <button type="button" className="new" disabled={state !== 'open'} onClick={() => void create()}>
          新建会话
        </button>
        <label className="toggle">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          显示已删除
        </label>
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id} className={s.deleted ? 'deleted' : ''}>
              <button type="button" className={active?.id === s.id ? 'current' : ''} onClick={() => open(s.id)}>
                <span className="title">{s.title || s.id}</span>
                <span className="meta">
                  {s.model} · {s.eventCount} 条事件{s.deleted ? ' · 已删除' : ''}
                </span>
              </button>
              {s.deleted && (
                <button type="button" className="restore" onClick={() => void restore(s.id)}>
                  恢复
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        {active ? (
          <SessionView
            key={active.id}
            client={client}
            sessionId={active.id}
            store={active.store}
            onDeleted={() => void removed()}
          />
        ) : (
          <p className="empty">从左边选一个会话，或者新建一个。</p>
        )}
      </main>
    </div>
  )
}

export function SessionView({
  client,
  sessionId,
  store,
  onDeleted,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  onDeleted?: () => void
}) {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const t = text.trim()
    if (t === '') return
    client.submit(sessionId, t).then(
      () => {
        setText('')
        setNotice(null)
      },
      // SESSION_BUSY 之类的结构化错误原样给人看（PRD-M3-004 AC-3）
      (err: Error) => setNotice(err.message),
    )
  }

  const answer = (allowed: boolean): void => {
    if (!ask?.askId) return
    client.answer(ask.askId, allowed).then(
      (applied) => {
        // 没生效 = 别的客户端已经答过了；确认框会随 askDone 关掉，这里只说明一下
        if (!applied) setNotice('这个询问已经在别处回答过了')
      },
      (err: Error) => setNotice(err.message),
    )
  }

  return (
    <section className="session">
      <SessionTools
        client={client}
        sessionId={sessionId}
        busy={status.busy}
        onNotice={setNotice}
        {...(onDeleted === undefined ? {} : { onDeleted })}
      />
      <StatusBar status={status} />
      <Transcript items={items} />
      {ask !== null && <ConfirmDialog ask={ask} onAnswer={answer} />}
      <form className="composer" onSubmit={submit}>
        {notice !== null && <p className="error">{notice}</p>}
        <textarea
          value={text}
          placeholder={status.busy ? '正在处理上一条…' : '说点什么'}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        <button type="submit" disabled={status.busy}>
          发送
        </button>
      </form>
    </section>
  )
}

/**
 * 会话级操作：切换模型、删除。都是「发一个请求，结果看事件流或列表」——
 * 切换成功后 model.switch 事件自己会出现在对话里，这里只显示会失去的能力。
 * 删除要点两下：第一下变成「确认删除」，防手滑（软删除，可以在回收站恢复）。
 */
export function SessionTools({
  client,
  sessionId,
  busy,
  onNotice,
  onDeleted,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  onNotice: (msg: string | null) => void
  onDeleted?: () => void
}) {
  const [model, setModel] = useState('')
  const [armed, setArmed] = useState(false)

  const switchModel = (e: FormEvent): void => {
    e.preventDefault()
    const [name, provider] = model.trim().split(/\s+/)
    if (!name) return
    client.switchModel(sessionId, name, provider).then(
      (lost) => {
        setModel('')
        onNotice(lost.length > 0 ? `已切换。新模型不支持：${lost.join('、')}` : null)
      },
      (err: Error) => onNotice(err.message),
    )
  }

  const remove = (): void => {
    if (!armed) {
      setArmed(true)
      return
    }
    client.deleteSession(sessionId).then(
      () => onDeleted?.(),
      (err: Error) => {
        setArmed(false)
        onNotice(err.message)
      },
    )
  }

  return (
    <div className="tools">
      <form onSubmit={switchModel}>
        <input
          value={model}
          placeholder="切换模型：名字 [provider]"
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || model.trim() === ''}>
          切换
        </button>
      </form>
      <button type="button" className={armed ? 'danger armed' : 'danger'} disabled={busy} onClick={remove}>
        {armed ? '确认删除' : '删除会话'}
      </button>
    </div>
  )
}
