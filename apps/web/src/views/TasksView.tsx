/**
 * 任务页（`#/tasks`）—— PRD-M8-005 AC-4；新建（`#/tasks/new`，`?schedule=1` 展开计划时间）。
 * 新建 = task.create：系统按项目设置决定隔离与规划，目标作为第一句话发出去（PRD-M8-005）。定时在 TASK-M8-012。
 * 编排运行（DAG）仍用原来的长任务面板。
 */
import type { DomiClient } from '@domi/client-core'
import { useState } from 'react'
import { IconClock } from '../icons.tsx'
import { dotOf, type ProjectRow, type SessionRow, titleOf } from '../layout/data.ts'
import { formatRoute, navigate } from '../router.ts'
import { Composer } from '../session/SessionView.tsx'
import { TaskPanel } from '../TaskPanel.tsx'
import { Card, ListRow, Page } from './Page.tsx'
import { ProjectSelect } from './projectDialogs.tsx'

export function NewTask({
  client,
  online,
  schedule,
  projects,
  projectId: initialProject,
  onCreated,
}: {
  client: DomiClient
  online: boolean
  schedule: boolean
  projects: readonly ProjectRow[]
  projectId?: string | undefined
  onCreated: (id: string) => void
}) {
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const project = projects.find((p) => p.id === projectId)
  return (
    <Card>
      <h3 className="mb-2.5 text-sm font-semibold">{schedule ? '新建定时任务' : '新建任务'}</h3>
      <label className="mb-0.5 block text-[13px] font-medium" htmlFor="task-project">
        项目
      </label>
      <p className="mb-1.5 text-[11.5px] text-mut">任务一定属于某个项目；没有的话先在侧栏「项目」里添加</p>
      <div className="mb-3">
        <ProjectSelect id="task-project" projects={projects} value={projectId} onChange={setProjectId} />
      </div>
      {schedule && (
        <div className="mb-3">
          <label className="mb-0.5 flex items-center gap-1.5 text-[13px] font-medium" htmlFor="task-cron">
            <IconClock size={13} />
            计划时间
          </label>
          <p className="mb-1.5 text-[11.5px] text-mut">cron 表达式，例如 0 9 * * 1-5（定时调度即将可用）</p>
          <input id="task-cron" className="field-input font-mono" placeholder="0 9 * * 1-5" disabled />
        </div>
      )}
      <Composer
        className="px-0 pb-0"
        busy={!online || schedule || project === undefined}
        notice={notice}
        placeholder="这个任务要达成什么？  (Enter 开始)"
        submitLabel="开始任务"
        onSubmit={async (goal) => {
          if (!project) return
          try {
            // 隔离与否、先不先规划，由系统按项目设置决定（PRD-M8-005 / 006）
            const { sessionId: id } = await client.createTask(project.id, goal)
            setNotice(null)
            onCreated(id)
            navigate({ view: 'session', id, tab: 'chat' })
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e))
            throw e
          }
        }}
      />
    </Card>
  )
}

export function TasksView({
  client,
  online,
  create,
  schedule,
  projects,
  projectId,
  tasks,
  active,
  onCreated,
}: {
  client: DomiClient
  online: boolean
  create: boolean
  schedule: boolean
  projects: readonly ProjectRow[]
  projectId?: string | undefined
  /** 单会话的任务（kind = task），最近活动在前 */
  tasks: readonly SessionRow[]
  active?: { id: string; busy: boolean } | undefined
  onCreated: (id: string) => void
}) {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const running = tasks.filter((t) => dotOf(t, active) === 'running')
  const recent = tasks.filter((t) => dotOf(t, active) !== 'running').slice(0, 20)
  const row = (t: SessionRow) => (
    <ListRow
      key={t.id}
      href={formatRoute({ view: 'session', id: t.id, tab: 'chat' })}
      state={dotOf(t, active)}
      title={titleOf(t)}
      meta={`${t.projectId === undefined ? '' : `${names.get(t.projectId) ?? t.projectId} · `}${t.model} · ${t.eventCount} 事件`}
    />
  )
  return (
    <Page view="tasks" title="任务" sub="有明确目标与产出的工作。后台执行，进程重启后自动恢复。">
      {create && (
        <NewTask
          key={`${projectId ?? ''}${schedule ? '-s' : ''}`}
          client={client}
          online={online}
          schedule={schedule}
          projects={projects}
          projectId={projectId}
          onCreated={onCreated}
        />
      )}
      {running.length > 0 && (
        <>
          <div className="caps mb-2">进行中</div>
          <Card className="px-0 py-2">{running.map(row)}</Card>
        </>
      )}
      <div className="caps mb-2">最近任务</div>
      <Card className="px-0 py-2">
        {recent.length === 0 ? <p className="px-3.5 py-2 text-[13px] text-mut">还没有任务。</p> : recent.map(row)}
      </Card>
      <div className="caps mb-2">编排运行</div>
      {online ? (
        <Card className="legacy">
          <TaskPanel client={client} onOpen={(id) => navigate({ view: 'session', id, tab: 'chat' })} />
        </Card>
      ) : (
        <p className="text-[13px] text-mut">连上 daemon 后显示任务。</p>
      )}
    </Page>
  )
}
