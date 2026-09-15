/**
 * Web 端骨架 —— PRD-M3-003
 *
 * 能连上、能列会话、能看到事件流与轨迹、能提交输入。**只渲染**：
 * 状态全在 client-core 的 atom 里，这个文件里没有一行是在算「事件意味着什么」。
 * 与 TUI 的逐项对等见 docs/parity-checklist.md。
 */
import { type ConnectionState, createSessionStore, type DomiClient, type SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { type FormEvent, useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { StatusBar } from './StatusBar.tsx'
import { Transcript } from './Transcript.tsx'

interface SessionRow {
  id: string
  title: string
  model: string
  eventCount: number
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

  useEffect(() => {
    client.start().catch(() => undefined)
    return () => client.close()
  }, [client])

  useEffect(() => {
    if (state !== 'open') return
    client
      .listSessions()
      .then((r) => setSessions(r.sessions))
      .catch(() => undefined)
  }, [client, state])

  const open = (id: string): void => {
    if (active) client.unwatch(active.id)
    const store = createSessionStore()
    setActive({ id, store })
    client.watch(id, store).catch(() => undefined)
  }

  const create = async (): Promise<void> => {
    const id = await client.createSession()
    const r = await client.listSessions()
    setSessions(r.sessions)
    open(id)
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
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className={active?.id === s.id ? 'current' : ''} onClick={() => open(s.id)}>
                <span className="title">{s.title || s.id}</span>
                <span className="meta">
                  {s.model} · {s.eventCount} 条事件
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        {active ? (
          <SessionView key={active.id} client={client} sessionId={active.id} store={active.store} />
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
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
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
