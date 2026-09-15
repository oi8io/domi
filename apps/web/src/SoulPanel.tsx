/**
 * Soul 与记忆（PRD-M4-001…003）。数据都从 daemon 拿，这里只负责摆出来和把点击转成请求（INV-02）。
 */
import type { DomiClient } from '@domi/client-core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

type Soul = Awaited<ReturnType<DomiClient['getSoul']>>
type Change = Awaited<ReturnType<DomiClient['soulChanges']>>[number]
type Item = Awaited<ReturnType<DomiClient['listMemory']>>['items'][number]

export function SoulView({
  soul,
  changes,
  items,
  mode,
  onReview,
  onDelete,
}: {
  soul: Soul | null
  changes: readonly Change[]
  items: readonly Item[]
  mode?: string
  onReview?: (id: string, decision: 'accept' | 'reject') => void
  onDelete?: (id: string) => void
}) {
  return (
    <div className="soul">
      <section>
        <h2>待审阅的改动</h2>
        {changes.length === 0 ? (
          <p className="empty">没有待审阅的改动。</p>
        ) : (
          <ul className="changes">
            {changes.map((c) => (
              <li key={c.id}>
                <pre>{c.diff}</pre>
                <button type="button" onClick={() => onReview?.(c.id, 'accept')}>
                  接受
                </button>
                <button type="button" className="danger" onClick={() => onReview?.(c.id, 'reject')}>
                  否决
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Soul</h2>
        {soul === null ? null : (
          <>
            <p className="meta">
              文件在 daemon 那台机器的 {soul.path}，可以直接编辑：没有来源注释或改过的行，domi 不会再动。
            </p>
            <pre className="soul-text">{soul.text === '' ? '还没有内容。对话攒够几轮之后会自动生成。' : soul.text}</pre>
          </>
        )}
      </section>
      <section>
        <h2>记下的条目</h2>
        {mode === 'keyword' && <p className="meta">只按关键词匹配（daemon 没有配置 memory.embedding）</p>}
        {items.length === 0 ? (
          <p className="empty">没有条目。</p>
        ) : (
          <ul className="memory-items">
            {items.map((i) => (
              <li key={i.id} className={i.deleted ? 'deleted' : ''}>
                <span className="kind">{i.kind}</span>
                <span className="text">{i.text}</span>
                <span className="meta">{i.sourceRefs.map((r) => `${r.sessionId}#${r.seq}`).join(' ')}</span>
                {!i.deleted && (
                  <button type="button" onClick={() => onDelete?.(i.id)}>
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function SoulPanel({ client }: { client: DomiClient }) {
  const [soul, setSoul] = useState<Soul | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [mode, setMode] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [s, c, m] = await Promise.all([client.getSoul(), client.soulChanges(), client.listMemory()])
    setSoul(s)
    setChanges(c)
    setItems(m.items)
    setMode(undefined)
  }, [client])

  useEffect(() => {
    refresh().catch((e: Error) => setNotice(e.message))
  }, [refresh])

  const act = (p: Promise<unknown>): void => {
    p.then(
      () => refresh(),
      (e: Error) => setNotice(e.message),
    ).catch(() => undefined)
  }

  const search = (e: FormEvent): void => {
    e.preventDefault()
    if (query.trim() === '') {
      act(Promise.resolve())
      return
    }
    client.searchMemory(query.trim()).then(
      (r) => {
        setItems(r.items)
        setMode(r.mode)
      },
      (err: Error) => setNotice(err.message),
    )
  }

  return (
    <section className="session">
      {notice !== null && <p className="error">{notice}</p>}
      <form className="soul-search" onSubmit={search}>
        <label htmlFor="memory-query">检索记忆</label>
        <input id="memory-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="关键词" />
        <button type="submit">查</button>
        <button type="button" onClick={() => act(client.updateSoul())}>
          用全部记忆更新 Soul
        </button>
      </form>
      <SoulView
        soul={soul}
        changes={changes}
        items={items}
        {...(mode === undefined ? {} : { mode })}
        onReview={(id, d) => act(client.reviewSoul(id, d).then((r) => setNotice(r.detail)))}
        onDelete={(id) => act(client.deleteMemory(id))}
      />
    </section>
  )
}
