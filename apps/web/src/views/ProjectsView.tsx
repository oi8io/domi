/**
 * 全部项目（`#/projects`）与项目详情（`#/p/<id>`）—— PRD-M8-003 AC-4 / AC-5。
 * 项目接口（TASK-M8-004）落地前显示说明。
 */
import { useState } from 'react'
import { IconFolder } from '../icons.tsx'
import type { ProjectRow } from '../layout/data.ts'
import { dotOf, titleOf } from '../layout/data.ts'
import { formatRoute } from '../router.ts'
import { Card, FilterInput, ListRow, Notice, Page } from './Page.tsx'

const UNAVAILABLE = '项目管理即将可用：之后在某个目录里开始任务时，项目会自动出现在这里，也可以手动添加。'

export function ProjectsView({ projects, available }: { projects: readonly ProjectRow[]; available: boolean }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = projects.filter((p) => q === '' || `${p.name} ${p.path}`.toLowerCase().includes(q))
  return (
    <Page view="projects" title="全部项目" sub="所有 workspace / 仓库。点击进入项目详情。">
      {!available && <Notice>{UNAVAILABLE}</Notice>}
      <FilterInput value={query} onChange={setQuery} placeholder="筛选项目…" />
      <Card className="px-0 py-2">
        {rows.length === 0 && <p className="px-3.5 py-2 text-[13px] text-mut">没有项目。</p>}
        {rows.map((p) => (
          <ListRow
            key={p.id}
            href={formatRoute({ view: 'project', id: p.id })}
            state="idle"
            title={p.name}
            meta={
              <span className="font-mono">
                {p.path} · {p.taskCount} 个任务
              </span>
            }
          />
        ))}
      </Card>
    </Page>
  )
}

export function ProjectView({ project, available }: { project: ProjectRow | undefined; available: boolean }) {
  if (project === undefined)
    return (
      <Page view="project" narrow title="项目" icon={<IconFolder size={22} className="text-accent" />}>
        <Notice>{available ? '找不到这个项目，它可能已被归档。' : UNAVAILABLE}</Notice>
      </Page>
    )
  return (
    <Page
      view="project"
      narrow
      title={project.name}
      icon={<IconFolder size={22} className="text-accent" />}
      sub={<span className="font-mono text-xs">{project.path}</span>}
    >
      <div className="caps mb-2">历史任务</div>
      {project.recentTasks.map((t) => (
        <ListRow
          key={t.id}
          href={formatRoute({ view: 'session', id: t.id, tab: 'chat' })}
          state={dotOf(t)}
          title={titleOf(t)}
        />
      ))}
    </Page>
  )
}
