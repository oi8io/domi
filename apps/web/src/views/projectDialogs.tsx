/**
 * 添加项目、会话转任务 —— PRD-M8-003 AC-2 · PRD-M8-004 AC-4
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
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
    <Dialog open={open} title={tr('web.sidebar.addProject')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FormField label={tr('web.addProject.dir')} hint={tr('web.addProject.dirHint')}>
          <input
            className="field-input font-mono"
            placeholder="~/Develop/my-repo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </FormField>
        <FormField label={tr('web.addProject.name')} hint={tr('web.addProject.nameHint')}>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {error !== null && <p className="mb-3 text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || path.trim() === ''}>
            {tr('common.add')}
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
      {value === '' && <option value="">{tr('web.toTask.pickProject')}</option>}
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
    <Dialog open={open} title={tr('web.session.toTask')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="mb-3.5 text-[12.5px] text-mut">{tr('web.toTask.hint')}</p>
        <FormField label={tr('web.sidebar.projects')}>
          <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />
        </FormField>
        <FormField label={tr('common.goal')} hint={tr('web.toTask.goalHint')}>
          <textarea className="field-input min-h-20 resize-y" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </FormField>
        {projects.length === 0 && <p className="mb-3 text-[13px] text-mut">{tr('web.toTask.noProjects')}</p>}
        {error !== null && <p className="mb-3 text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={projectId === '' || goal.trim() === ''}>
            {tr('common.startTask')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
