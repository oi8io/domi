/**
 * 添加项目、会话转任务 —— PRD-M8-003 AC-2 · PRD-M8-004 AC-4
 */
import type { DomiClient } from '@domi/client-core'
import { useState } from 'react'
import { Dialog, FormField } from '../components/Dialog.tsx'
import { Button } from '../components/ui/button.tsx'
import type { ProjectRow } from '../layout/data.ts'

export function AddProjectDialog({
  client,
  open,
  onClose,
  onAdded,
}: {
  client: DomiClient
  open: boolean
  onClose: () => void
  onAdded: (id: string) => void
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (): void => {
    if (path.trim() === '') return
    setBusy(true)
    client.createProject(path.trim(), name.trim() === '' ? undefined : name.trim()).then(
      (p) => {
        setBusy(false)
        setPath('')
        setName('')
        setError(null)
        onAdded(p.id)
      },
      (e: Error) => {
        setBusy(false)
        setError(e.message)
      },
    )
  }
  return (
    <Dialog open={open} title="添加项目" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FormField label="目录" hint="daemon 那台机器上的已有目录；同一目录只登记一次">
          <input
            className="field-input font-mono"
            placeholder="~/Develop/my-repo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </FormField>
        <FormField label="名字" hint="留空 = 目录名">
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {error !== null && <p className="mb-3 text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy || path.trim() === ''}>
            添加
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  id,
}: {
  projects: readonly ProjectRow[]
  value: string
  onChange: (id: string) => void
  id?: string
}) {
  return (
    <select id={id} className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {value === '' && <option value="">选择项目…</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} — {p.path}
        </option>
      ))}
    </select>
  )
}

export function ToTaskDialog({
  client,
  sessionId,
  projects,
  open,
  onClose,
  onCreated,
}: {
  client: DomiClient
  sessionId: string
  projects: readonly ProjectRow[]
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [projectId, setProjectId] = useState('')
  const [goal, setGoal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (): void => {
    if (projectId === '' || goal.trim() === '') return
    client.sessionToTask(sessionId, projectId, goal.trim()).then(
      (id) => {
        setGoal('')
        setError(null)
        onCreated(id)
      },
      (e: Error) => setError(e.message),
    )
  }
  return (
    <Dialog open={open} title="转为任务" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="mb-3.5 text-[12.5px] text-mut">
          在项目里新建一个任务，这个会话的全文作为引用带过去；这个会话本身不变。
        </p>
        <FormField label="项目">
          <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />
        </FormField>
        <FormField label="目标" hint="这个任务要达成什么、交付什么">
          <textarea className="field-input min-h-20 resize-y" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </FormField>
        {projects.length === 0 && <p className="mb-3 text-[13px] text-mut">还没有项目，先在侧栏「项目」里添加一个。</p>}
        {error !== null && <p className="mb-3 text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={projectId === '' || goal.trim() === ''}>
            开始任务
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
