/**
 * 任务页（`#/tasks`）—— PRD-M8-005 AC-4；新建（`#/tasks/new`，`?schedule=1` 展开计划时间）。
 * 目标驱动的新建与定时要等 TASK-M8-006 / 012 的协议；在那之前新建 = 在给定目录里开一个会话并把目标作为第一句话发出去，
 * 运行列表沿用现有的长任务面板。
 */
import type { DomiClient } from '@domi/client-core'
import { useState } from 'react'
import { IconClock } from '../icons.tsx'
import { navigate } from '../router.ts'
import { Composer } from '../session/SessionView.tsx'
import { TaskPanel } from '../TaskPanel.tsx'
import { Card, Page } from './Page.tsx'

export function NewTask({
  client,
  online,
  schedule,
  onCreated,
}: {
  client: DomiClient
  online: boolean
  schedule: boolean
  onCreated: (id: string) => void
}) {
  const [path, setPath] = useState('')
  const [keepTree, setKeepTree] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <Card>
      <h3 className="mb-2.5 text-sm font-semibold">{schedule ? '新建定时任务' : '新建任务'}</h3>
      <label className="mb-0.5 block text-[13px] font-medium" htmlFor="task-path">
        项目目录
      </label>
      <p className="mb-1.5 text-[11.5px] text-mut">留空 = domid 所在目录</p>
      <input
        id="task-path"
        className="field-input mb-3 font-mono"
        placeholder="~/Develop/my-repo"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
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
        busy={!online || schedule}
        notice={notice}
        placeholder="这个任务要达成什么？  (Enter 开始)"
        submitLabel="开始任务"
        onSubmit={async (goal) => {
          try {
            const cwd = path.trim() === '' ? undefined : path.trim()
            const id = keepTree ? (await client.createIsolatedSession(cwd)).sessionId : await client.createSession(cwd)
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
  onCreated,
}: {
  client: DomiClient
  online: boolean
  create: boolean
  schedule: boolean
  onCreated: (id: string) => void
}) {
  return (
    <Page view="tasks" title="任务" sub="有明确目标与产出的工作。后台执行，进程重启后自动恢复。">
      {create && <NewTask client={client} online={online} schedule={schedule} onCreated={onCreated} />}
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
