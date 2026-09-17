/**
 * 全部会话（`#/sessions`）—— PRD-M8-004 AC-6：按「无项目 / 各项目」分组，可筛选，含回收站与恢复。
 */
import { useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { IconRestore } from '../icons.tsx'
import { dotOf, type ProjectRow, type SessionRow, titleOf } from '../layout/data.ts'
import { formatRoute } from '../router.ts'
import { Badge, Card, FilterInput, ListRow, Page } from './Page.tsx'

export function groupSessions(
  sessions: readonly SessionRow[],
  projects: readonly ProjectRow[],
  query: string,
): Array<{ key: string; label: string; rows: SessionRow[] }> {
  const q = query.trim().toLowerCase()
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const groups = new Map<string, { key: string; label: string; rows: SessionRow[] }>()
  for (const s of sessions) {
    const key = s.projectId ?? ''
    const label = key === '' ? '无项目' : (names.get(key) ?? key)
    const hay = `${titleOf(s)} ${s.model} ${label}`.toLowerCase()
    if (q !== '' && !hay.includes(q)) continue
    const g = groups.get(key) ?? { key, label, rows: [] }
    g.rows.push(s)
    groups.set(key, g)
  }
  // 无项目在最前，其余按名字
  return [...groups.values()].sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : a.label.localeCompare(b.label)))
}

export function SessionsView({
  sessions,
  projects,
  showDeleted,
  onShowDeleted,
  onRestore,
  active,
}: {
  sessions: readonly SessionRow[]
  projects: readonly ProjectRow[]
  showDeleted: boolean
  onShowDeleted: (v: boolean) => void
  onRestore: (id: string) => void
  active?: { id: string; busy: boolean }
}) {
  const [query, setQuery] = useState('')
  const groups = groupSessions(sessions, projects, query)
  return (
    <Page view="sessions" title="全部会话" sub="跨项目的所有会话和任务。按项目分组。">
      <FilterInput value={query} onChange={setQuery} placeholder="筛选会话…" />
      <label className="mb-3 flex items-center gap-1.5 text-xs text-mut">
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(e) => onShowDeleted(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        显示已删除（回收站）
      </label>
      <Card className="px-0 py-2">
        {groups.length === 0 && <p className="px-3.5 py-2 text-[13px] text-mut">没有匹配的会话。</p>}
        {groups.map((g, i) => (
          <div key={g.key} data-group={g.label}>
            <div className={`caps px-3.5 ${i === 0 ? 'pt-2' : 'pt-3'} pb-1`}>{g.label}</div>
            {g.rows.map((s) => (
              <ListRow
                key={s.id}
                {...(s.deleted ? {} : { href: formatRoute({ view: 'session', id: s.id, tab: 'chat' }) })}
                state={dotOf(s, active)}
                title={titleOf(s)}
                muted={s.deleted}
                badge={s.kind === 'task' ? <Badge>任务</Badge> : undefined}
                meta={`${s.model} · ${s.eventCount} 事件${s.parentId === undefined ? '' : ' · 分支'}${s.deleted ? ' · 已删除' : ''}`}
                aside={
                  s.deleted ? (
                    <Button size="xs" className="mr-3" onClick={() => onRestore(s.id)}>
                      <IconRestore size={12} />
                      恢复
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        ))}
      </Card>
    </Page>
  )
}
