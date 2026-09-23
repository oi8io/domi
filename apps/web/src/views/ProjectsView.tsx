/**
 * 全部项目（`#/projects`）与项目详情（`#/p/<id>`）—— PRD-M8-003 AC-4 / AC-5。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { IconFolder, IconPencil } from '../icons.tsx'
import { dotOf, type ProjectRow, type SessionRow, titleOf } from '../layout/data.ts'
import { formatRoute, navigate } from '../router.ts'
import { Composer } from '../session/SessionView.tsx'
import { Badge, Card, FilterInput, ListRow, Notice, Page } from './Page.tsx'

export function ProjectsView({
  projects,
  showArchived,
  onShowArchived,
  onUnarchive,
  onAdd,
}: {
  projects: readonly ProjectRow[]
  showArchived: boolean
  onShowArchived: (v: boolean) => void
  onUnarchive: (id: string) => void
  onAdd?: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = projects.filter((p) => q === '' || `${p.name} ${p.path}`.toLowerCase().includes(q))
  return (
    <Page view="projects" title={tr('web.sidebar.allProjects')} sub={tr('web.projects.sub')}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <FilterInput value={query} onChange={setQuery} placeholder={tr('web.projects.filter')} />
        </div>
        {onAdd !== undefined && (
          <Button size="md" className="py-[5px]" onClick={onAdd}>
            {tr('web.sidebar.addProject')}
          </Button>
        )}
      </div>
      <label className="mb-3 flex items-center gap-1.5 text-xs text-mut">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onShowArchived(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        {tr('web.projects.showArchived')}
      </label>
      <Card className="px-0 py-2">
        {rows.length === 0 && <p className="px-3.5 py-2 text-[13px] text-mut">{tr('web.projects.none')}</p>}
        {rows.map((p) => (
          <ListRow
            key={p.id}
            href={formatRoute({ view: 'project', id: p.id })}
            state={p.recentTasks.some((t) => t.busy) ? 'running' : 'idle'}
            title={p.name}
            muted={p.archived === true}
            badge={p.archived ? <Badge>{tr('common.archived')}</Badge> : undefined}
            meta={
              <span className="font-mono">{tr('web.projects.meta', { path: p.path, taskCount: p.taskCount })}</span>
            }
            aside={
              p.archived ? (
                <Button size="xs" className="mr-3" onClick={() => onUnarchive(p.id)}>
                  {tr('common.unarchive')}
                </Button>
              ) : undefined
            }
          />
        ))}
      </Card>
    </Page>
  )
}

const MODE_LABEL = () => ({ auto: tr('common.auto'), always: tr('common.always'), never: tr('common.never') }) as const

export function ProjectView({
  client,
  project,
  tasks,
  online,
  focusComposer,
  active,
  onChanged,
}: {
  client: DomiClient
  project: ProjectRow | undefined
  tasks: readonly SessionRow[]
  online: boolean
  focusComposer?: boolean
  active?: { id: string; busy: boolean }
  onChanged: () => void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换项目时重新聚焦
  useEffect(() => {
    if (focusComposer) wrap.current?.querySelector('textarea')?.focus()
  }, [focusComposer, project?.id])

  if (project === undefined)
    return (
      <Page
        view="project"
        narrow
        title={tr('web.sidebar.projects')}
        icon={<IconFolder size={22} className="text-accent" />}
      >
        <Notice>{online ? tr('web.project.notFound') : tr('web.common.connectFirst')}</Notice>
      </Page>
    )

  const act = (p: Promise<unknown>): void => {
    p.then(
      () => {
        setNotice(null)
        onChanged()
      },
      (e: Error) => setNotice(e.message),
    )
  }
  const settings = project.settings ?? { isolation: 'auto', planReview: 'auto' }

  return (
    <Page
      view="project"
      narrow
      icon={<IconFolder size={22} className="text-accent" />}
      title={
        editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() !== '') act(client.updateProject(project.id, { name: name.trim() }))
              setEditing(false)
            }}
          >
            <input
              className="field-input py-0.5 text-lg font-bold"
              value={name}
              aria-label={tr('web.project.name')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
              }}
              // biome-ignore lint/a11y/noAutofocus: 点了改名就该直接能打字
              autoFocus
            />
          </form>
        ) : (
          <span className="group flex items-center gap-2">
            {project.name}
            {project.archived && <Badge>{tr('common.archived')}</Badge>}
            <button
              type="button"
              className="rounded-sm p-1 text-mut opacity-0 group-hover:opacity-100 hover:bg-panel-h hover:text-accent focus-visible:opacity-100"
              title={tr('common.rename')}
              aria-label={tr('common.rename')}
              onClick={() => {
                setName(project.name)
                setEditing(true)
              }}
            >
              <IconPencil size={14} />
            </button>
          </span>
        )
      }
      sub={<span className="font-mono text-xs">{project.path}</span>}
    >
      <div ref={wrap}>
        <Composer
          className="mb-7 px-0 pb-0"
          busy={!online || project.archived === true}
          notice={notice}
          placeholder={project.archived ? tr('web.project.archivedNoTask') : tr('web.project.startPlaceholder')}
          submitLabel={tr('common.startTask')}
          onSubmit={async (goal) => {
            try {
              const { sessionId: id } = await client.createTask(project.id, goal)
              onChanged()
              navigate({ view: 'session', id, tab: 'chat' })
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e))
              throw e
            }
          }}
        />
      </div>
      <div className="caps mb-2">{tr('web.project.history')}</div>
      {tasks.length === 0 && <p className="px-3.5 py-2 text-[13px] text-mut">{tr('web.project.noTasks')}</p>}
      {tasks.map((t) => (
        <ListRow
          key={t.id}
          href={formatRoute({ view: 'session', id: t.id, tab: 'chat' })}
          state={dotOf(t, active)}
          title={titleOf(t)}
          meta={tr('web.sidebar.chatMeta', {
            model: t.model,
            eventCount: t.eventCount,
            v: t.parentId === undefined ? '' : tr('common.branchSuffix'),
          })}
        />
      ))}
      <details className="mt-8 text-[13px]">
        <summary className="cursor-pointer text-mut select-none">{tr('web.project.settings')}</summary>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1">
            <span className="font-medium">{tr('web.project.isolate')}</span>
            <span className="text-[11.5px] text-mut">{tr('web.project.isolateHint')}</span>
            <select
              className="field-input"
              value={settings.isolation}
              onChange={(e) =>
                act(client.updateProject(project.id, { settings: { isolation: e.target.value as 'auto' } }))
              }
            >
              {Object.entries(MODE_LABEL()).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button variant="danger" onClick={() => act(client.archiveProject(project.id, project.archived !== true))}>
              {project.archived ? tr('common.unarchive') : tr('web.project.archive')}
            </Button>
          </div>
        </div>
      </details>
    </Page>
  )
}
