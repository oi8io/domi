/**
 * 任务页（`#/tasks`）—— PRD-M8-005 AC-4 · PRD-M8-007；新建（`#/tasks/new`，`?schedule=1` 是定时任务）。
 * 新建 = task.create：系统按项目设置决定隔离与规划，目标作为第一句话发出去（PRD-M8-005）。
 * 定时 = schedule.create：到点由 daemon 按同一个目标建任务。多节点运行在「编排运行」里。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useCallback, useState } from 'react'
import { IconClock } from '../icons.tsx'
import { dotOf, type ProjectRow, type SessionRow, titleOf } from '../layout/data.ts'
import { formatRoute, navigate } from '../router.ts'
import { Composer } from '../session/SessionView.tsx'
import { Card, ListRow, Page } from './Page.tsx'
import { ProjectSelect } from './projectDialogs.tsx'
import { RunsPanel } from './RunsPanel.tsx'
import { browserTimeZone, CronFields, ScheduleSection, useSchedules } from './Schedules.tsx'

export function NewTask({
  client,
  online,
  schedule,
  projects,
  projectId: initialProject,
  onCreated,
  onScheduled,
}: {
  client: DomiClient
  online: boolean
  schedule: boolean
  projects: readonly ProjectRow[]
  projectId?: string | undefined
  onCreated: (id: string) => void
  onScheduled?: () => void
}) {
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const [when, setWhen] = useState({ cron: '', tz: browserTimeZone() })
  const [cronOk, setCronOk] = useState(false)
  const onValid = useCallback((ok: boolean) => setCronOk(ok), [])
  const project = projects.find((p) => p.id === projectId)
  return (
    <Card>
      <h3 className="mb-2.5 text-sm font-semibold">
        {schedule ? tr('web.tasks.newSchedule') : tr('web.sidebar.createTask')}
      </h3>
      <label className="mb-0.5 block text-[13px] font-medium" htmlFor="task-project">
        {tr('web.sidebar.projects')}
      </label>
      <p className="mb-1.5 text-[11.5px] text-mut">{tr('web.tasks.projectHint')}</p>
      <div className="mb-3">
        <ProjectSelect id="task-project" projects={projects} value={projectId} onChange={setProjectId} />
      </div>
      {schedule && (
        <div className="mb-3">
          <label className="mb-0.5 flex items-center gap-1.5 text-[13px] font-medium" htmlFor="task-cron">
            <IconClock size={13} />
            {tr('web.tasks.when')}
          </label>
          <p className="mb-1.5 text-[11.5px] text-mut">{tr('web.tasks.whenHint')}</p>
          <CronFields
            client={client}
            cron={when.cron}
            tz={when.tz}
            onChange={setWhen}
            onValid={onValid}
            idPrefix="task"
          />
        </div>
      )}
      <Composer
        className="px-0 pb-0"
        busy={!online || project === undefined || (schedule && !cronOk)}
        notice={notice}
        placeholder={schedule ? tr('web.tasks.schedulePlaceholder') : tr('web.tasks.taskPlaceholder')}
        submitLabel={schedule ? tr('web.tasks.createSchedule') : tr('common.startTask')}
        onSubmit={async (goal) => {
          if (!project) return
          if (schedule) {
            try {
              await client.createSchedule({ projectId: project.id, goal, cron: when.cron, tz: when.tz })
              setNotice(null)
              setWhen({ cron: '', tz: when.tz })
              onScheduled?.()
              navigate({ view: 'tasks' })
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e))
              throw e
            }
            return
          }
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
  const sched = useSchedules(client, online)
  const running = tasks.filter((t) => dotOf(t, active) === 'running')
  const recent = tasks.filter((t) => dotOf(t, active) !== 'running').slice(0, 20)
  const row = (t: SessionRow) => (
    <ListRow
      key={t.id}
      href={formatRoute({ view: 'session', id: t.id, tab: 'chat' })}
      state={dotOf(t, active)}
      title={titleOf(t)}
      meta={tr('web.tasks.meta', {
        v: t.projectId === undefined ? '' : `${names.get(t.projectId) ?? t.projectId} · `,
        model: t.model,
        eventCount: t.eventCount,
      })}
    />
  )
  return (
    <Page view="tasks" title={tr('web.tasks.title')} sub={tr('web.tasks.sub')}>
      {create && (
        <NewTask
          key={`${projectId ?? ''}${schedule ? '-s' : ''}`}
          client={client}
          online={online}
          schedule={schedule}
          projects={projects}
          projectId={projectId}
          onCreated={onCreated}
          onScheduled={sched.reload}
        />
      )}
      {running.length > 0 && (
        <>
          <div className="caps mb-2">{tr('common.inProgress')}</div>
          <Card className="px-0 py-2">{running.map(row)}</Card>
        </>
      )}
      <div className="caps mb-2">{tr('web.tasks.recent')}</div>
      <Card className="px-0 py-2">
        {recent.length === 0 ? (
          <p className="px-3.5 py-2 text-[13px] text-mut">{tr('web.project.noTasks')}</p>
        ) : (
          recent.map(row)
        )}
      </Card>
      {online ? (
        <>
          <ScheduleSection
            client={client}
            schedules={sched.schedules}
            error={sched.error}
            projects={projects}
            onChanged={sched.reload}
          />
          <div className="caps mb-2">{tr('web.tasks.runs')}</div>
          <Card className="px-0 py-2">
            <RunsPanel client={client} onOpen={(id) => navigate({ view: 'session', id, tab: 'chat' })} />
          </Card>
        </>
      ) : (
        <p className="text-[13px] text-mut">{tr('web.tasks.connectFirst')}</p>
      )}
    </Page>
  )
}
