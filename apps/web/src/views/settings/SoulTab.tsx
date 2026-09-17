/**
 * 设置 › Soul 与人格 —— PRD-M8-012 AC-5（原型 data-stab="soul"），吸收原 SoulPanel.tsx。
 * Soul 全文可编辑（soul.write，等同手改文件）；domi 提议的改动逐条接受 / 否决（M4-003）；
 * 记忆条目检索、保留 / 否决；导出 / 导入 soul.md（M4-004，导入先预览、按区勾选）。
 * 数据都从 daemon 拿，这里只负责摆出来和把点击转成请求（INV-02）。
 */
import type { DomiClient } from '@domi/client-core'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Field, Saved } from './fields.tsx'

type Soul = Awaited<ReturnType<DomiClient['getSoul']>>
type Change = Awaited<ReturnType<DomiClient['soulChanges']>>[number]
type Item = Awaited<ReturnType<DomiClient['listMemory']>>['items'][number]
type Plan = Awaited<ReturnType<DomiClient['importSoul']>>['plans'][number]

/** 「保留」只是本机的已看过标记（记忆条目没有「已确认」状态；否决 = 删除，才是 daemon 里的动作） */
const KEPT_KEY = 'domi.memory.kept'
function loadKept(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEPT_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function saveKept(s: Set<string>): void {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify([...s].slice(-500)))
  } catch {
    /* 存不了就只在这次有效 */
  }
}

const VOTE = 'rounded-sm px-2 py-0.5 text-[11.5px] text-mut hover:bg-panel-h hover:text-ink'

/** 纯展示（测试与 SSR 用） */
export function SoulView({
  changes,
  items,
  mode,
  kept,
  onReview,
  onKeep,
  onDelete,
}: {
  changes: readonly Change[]
  items: readonly Item[]
  mode?: string
  kept?: ReadonlySet<string>
  onReview?: (id: string, decision: 'accept' | 'reject') => void
  onKeep?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  return (
    <>
      {changes.length > 0 && (
        <Field
          label={`待审阅的改动（${changes.length}）`}
          hint="domi 根据记忆提议的修改。否决会撤回文件里的那一处，之后不再提"
        >
          <div className="overflow-hidden rounded-lg border border-border2 bg-panel" data-part="soul-changes">
            {changes.map((c) => (
              <div key={c.id} className="flex items-start gap-2 border-b border-border2 px-3.5 py-2 last:border-b-0">
                <pre className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap text-ink2">{c.diff}</pre>
                <button type="button" className={VOTE} onClick={() => onReview?.(c.id, 'accept')}>
                  接受
                </button>
                <button type="button" className={cn(VOTE, 'hover:text-bad')} onClick={() => onReview?.(c.id, 'reject')}>
                  否决
                </button>
              </div>
            ))}
          </div>
        </Field>
      )}
      <Field
        label="最近学到的记忆"
        hint={mode === 'keyword' ? '只按关键词匹配（daemon 没有配置 memory.embedding）' : undefined}
      >
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border2 bg-panel" data-part="memory-items">
          {items.length === 0 && <p className="px-3.5 py-2.5 text-[13px] text-mut">没有条目。</p>}
          {items.map((i) => (
            <div
              key={i.id}
              className={cn(
                'flex items-center gap-2.5 border-b border-border2 px-3.5 py-2 text-[13px] last:border-b-0',
                (i.deleted || kept?.has(i.id)) && 'opacity-60',
              )}
              title={i.sourceRefs.map((r) => `${r.sessionId}#${r.seq}`).join(' ')}
            >
              <span className="shrink-0 rounded bg-info-d px-1.5 font-mono text-[10.5px] font-semibold text-info">
                {i.kind}
              </span>
              <span className={cn('min-w-0 flex-1', i.deleted && 'line-through')}>{i.text}</span>
              {!i.deleted && (
                <>
                  <button
                    type="button"
                    className={cn(VOTE, kept?.has(i.id) && 'text-ok')}
                    onClick={() => onKeep?.(i.id)}
                  >
                    {kept?.has(i.id) ? '已保留' : '保留'}
                  </button>
                  <button type="button" className={cn(VOTE, 'hover:text-bad')} onClick={() => onDelete?.(i.id)}>
                    否决
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </Field>
    </>
  )
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function SoulTab({ client }: { client: DomiClient }) {
  const [soul, setSoul] = useState<Soul | null>(null)
  const [draft, setDraft] = useState('')
  const [changes, setChanges] = useState<Change[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [mode, setMode] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [kept, setKept] = useState<Set<string>>(() => loadKept())
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [importing, setImporting] = useState<{ name: string; text: string; plans: Plan[]; pick: Set<string> } | null>(
    null,
  )
  const picker = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [s, c, m] = await Promise.all([client.getSoul(), client.soulChanges(), client.listMemory()])
    setSoul(s)
    setDraft(s.text)
    setChanges(c)
    setItems(m.items)
    setMode(undefined)
  }, [client])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

  const act = (p: Promise<unknown>, ok?: string): void => {
    setError(null)
    setSaved(null)
    p.then(
      () => {
        if (ok !== undefined) setSaved(ok)
        return refresh()
      },
      (e: Error) => setError(e.message),
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
      (err: Error) => setError(err.message),
    )
  }

  const exportSoul = (): void => {
    client.exportSoul().then(
      (r) => {
        if (r.findings.length > 0) {
          setError(
            `导出被拒绝：这些行里有凭据、本机路径或邮箱，改掉再导出——${r.findings.map((f) => `第 ${f.line} 行（${f.kind}）`).join('、')}`,
          )
          return
        }
        download('soul.md', r.text)
      },
      (e: Error) => setError(e.message),
    )
  }

  const readImport = (file: File): void => {
    file.text().then(
      (text) =>
        client.importSoul(text, file.name).then((r) => {
          if (r.plans.length === 0) setSaved('没有新内容可导入')
          else setImporting({ name: file.name, text, plans: r.plans, pick: new Set() })
        }),
      (e: Error) => setError(e.message),
    )
  }

  const dirty = soul !== null && draft !== soul.text

  return (
    <div data-part="soul-tab">
      <Saved error={error} saved={saved} />
      <Field
        label="人格描述（Soul Markdown）"
        hint="人类可读、可 diff、可手改。修改后下次对话生效；你改过的行 domi 不会再动"
        id="soul-text"
      >
        <textarea
          id="soul-text"
          className="field-input min-h-[240px] font-mono text-[12.5px] leading-relaxed"
          value={draft}
          placeholder="还没有内容。对话攒够几轮之后会自动生成，也可以直接写。"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!dirty}
            onClick={() => act(client.writeSoul(draft, soul?.mtime), '已保存')}
          >
            保存
          </Button>
          <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(soul?.text ?? '')}>
            撤销修改
          </Button>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => act(client.updateSoul(), '已用全部记忆过了一遍')}>
            用全部记忆更新
          </Button>
          <Button variant="outline" size="sm" onClick={exportSoul}>
            导出
          </Button>
          <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
            导入…
          </Button>
          <input
            ref={picker}
            type="file"
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readImport(f)
              e.target.value = ''
            }}
          />
        </div>
        {soul !== null && <p className="mt-1.5 font-mono text-[11px] text-mut2">{soul.path}</p>}
      </Field>

      {importing !== null && (
        <Field
          label={`导入 ${importing.name}`}
          hint="别人写的内容只作参考资料，不会被当成指令。勾选要导入的区，导入后仍可在待审阅里逐条否决"
        >
          <div className="overflow-hidden rounded-lg border border-border2 bg-panel" data-part="soul-import">
            {importing.plans.map((p) => (
              <label key={p.section} className="flex gap-2.5 border-b border-border2 px-3.5 py-2 last:border-b-0">
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--accent)]"
                  checked={importing.pick.has(p.section)}
                  onChange={(e) => {
                    const pick = new Set(importing.pick)
                    if (e.target.checked) pick.add(p.section)
                    else pick.delete(p.section)
                    setImporting({ ...importing, pick })
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{p.section}</span>
                  <span className="block font-mono text-xs whitespace-pre-wrap text-ok">
                    {p.add.map((l) => `+ ${l.replace(/\s*<!--.*-->$/, '').replace(/^- /, '')}`).join('\n')}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              disabled={importing.pick.size === 0}
              onClick={() => {
                const it = importing
                setImporting(null)
                act(client.importSoul(it.text, it.name, [...it.pick]).then((r) => setSaved(`导入了 ${r.imported} 条`)))
              }}
            >
              导入选中的 {importing.pick.size} 个区
            </Button>
            <Button variant="ghost" onClick={() => setImporting(null)}>
              取消
            </Button>
          </div>
        </Field>
      )}

      <form className="mb-3 flex gap-2" onSubmit={search}>
        <input
          className="field-input"
          value={query}
          aria-label="检索记忆"
          placeholder="检索记忆…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" variant="outline">
          检索
        </Button>
      </form>
      <SoulView
        changes={changes}
        items={items}
        kept={kept}
        {...(mode === undefined ? {} : { mode })}
        onReview={(id, d) => act(client.reviewSoul(id, d).then((r) => setSaved(r.detail)))}
        onKeep={(id) => {
          const next = new Set(kept)
          next.add(id)
          setKept(next)
          saveKept(next)
        }}
        onDelete={(id) => act(client.deleteMemory(id), '已否决（之后检索不到，事件仍在）')}
      />
    </div>
  )
}
