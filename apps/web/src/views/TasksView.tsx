/**
 * 任务页（`#/tasks`）—— PRD-M8-005 AC-4；新建（`#/tasks/new`，`?schedule=1` 展开计划时间）。
 * 新建 = 在选中的项目下建任务会话并把目标作为第一句话发出去；系统决定执行形态（TASK-M8-006）与定时（TASK-M8-012）接入后替换。
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
  const [keepTree, setKeepTree] = useState(false)
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
      <details className="mb-3 text-xs text-mut">
        <summary className="cursor-pointer select-none">高级</summary>
        <label className="mt-2 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={keepTree}
            onChange={(e) => setKeepTree(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          不直接改动我的工作区（改完先审阅再带回；之后由系统自动判断）
        </label>
      </details>
      <Composer
        className="px-0 pb-0"
        busy={!online || schedule || project === undefined}
        notice={notice}
        placeholder="这个任务要达成什么？  (Enter 开始)"
        submitLabel="开始任务"
        onSubmit={async (goal) => {
          if (!project) return
          try {
            const id = keepTree
              ? (await client.createIsolatedSession(project.path)).sessionId
              : await client.createSession(undefined, { kind: 'task', projectId: project.id })
            await client.submit(id, goal)
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
