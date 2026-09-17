import { Box, Text, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { editAction } from '../components/Prompt.tsx'
import { moveOf } from '../keys.ts'
import { useTheme } from '../theme.ts'

/**
 * 新建任务表单 —— PRD-M8-015 AC-4：项目、目标、可选 cron。
 * Tab / ↑↓ 换字段，项目用 ←→ 选；Enter 提交，Esc 回列表。离开 cron 字段时就校验（daemon 算），非法当场提示是哪一段。
 */
export interface TaskFormValue {
  projectId: string
  goal: string
  cron: string
}

const FIELDS = ['project', 'goal', 'cron'] as const

export function TaskForm({
  projects,
  initialProject,
  error,
  busy,
  validateCron,
  onSubmit,
  onCancel,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>
  initialProject?: string | undefined
  error?: string | null | undefined
  busy: boolean
  /** 合法 → null，否则返回说明 */
  validateCron(cron: string): Promise<string | null>
  onSubmit(v: TaskFormValue): void
  onCancel(): void
}): React.ReactElement {
  const t = useTheme()
  const [field, setField] = useState<(typeof FIELDS)[number]>(initialProject === undefined ? 'project' : 'goal')
  const [pi, setPi] = useState(
    Math.max(
      0,
      projects.findIndex((p) => p.id === initialProject),
    ),
  )
  const [goal, setGoal] = useState('')
  const [cron, setCron] = useState('')
  const [cronError, setCronError] = useState<string | null>(null)
  const [cronHint, setCronHint] = useState<string | null>(null)
  // 项目列表是异步到的：到了再定位到带进来的那个
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current) return
    const i = projects.findIndex((p) => p.id === initialProject)
    if (i >= 0) {
      setPi(i)
      placed.current = true
    }
  }, [projects, initialProject])

  const check = (value: string): void => {
    if (value.trim() === '') {
      setCronError(null)
      setCronHint(null)
      return
    }
    void validateCron(value.trim()).then((e) => {
      setCronError(e)
      setCronHint(e === null ? '时间表可用' : null)
    })
  }

  useInput((input, key) => {
    if (key.escape) return onCancel()
    if (busy) return
    const d = key.tab ? (key.shift ? -1 : 1) : moveOf(input, key)
    if (d !== 0) {
      if (field === 'cron') check(cron)
      const i = FIELDS.indexOf(field)
      setField(FIELDS[(i + d + FIELDS.length) % FIELDS.length] as (typeof FIELDS)[number])
      return
    }
    if (field === 'project') {
      if (key.leftArrow || key.rightArrow) {
        const n = projects.length
        if (n > 0) setPi((x) => (x + (key.leftArrow ? -1 : 1) + n) % n)
        return
      }
    }
    const edit = editAction(input, key)
    if (edit === null) return
    if (edit.kind === 'submit') {
      const project = projects[pi]
      if (!project || goal.trim() === '') return
      if (cron.trim() !== '') {
        void validateCron(cron.trim()).then((e) => {
          setCronError(e)
          if (e === null) onSubmit({ projectId: project.id, goal: goal.trim(), cron: cron.trim() })
        })
        return
      }
      onSubmit({ projectId: project.id, goal: goal.trim(), cron: '' })
      return
    }
    if (field === 'project' || edit.kind === 'newline') return
    const set = field === 'goal' ? setGoal : setCron
    if (edit.kind === 'backspace') set((v) => v.slice(0, -1))
    else set((v) => v + edit.text)
    if (field === 'cron') {
      setCronError(null)
      setCronHint(null)
    }
  })

  const label = (f: (typeof FIELDS)[number], text: string) => (
    <Text {...t.fg(field === f ? 'accent' : 'mut')} bold={field === f}>
      {`${field === f ? '›' : ' '} ${text}`}
    </Text>
  )
  const caret = (f: (typeof FIELDS)[number]) => (field === f && !busy ? <Text inverse> </Text> : null)
  const project = projects[pi]

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Box width={8}>{label('project', '项目')}</Box>
        {projects.length === 0 ? (
          <Text {...t.fg('warn')}>还没有项目，先在 Web 端或用 domi -p 添加</Text>
        ) : (
          <Text {...t.fg('ink2')}>
            {field === 'project' ? '◂ ' : ''}
            {project?.name ?? ''}
            {field === 'project' ? ' ▸' : ''}
            <Text {...t.fg('mut2')}>{projects.length > 1 ? `  (${pi + 1}/${projects.length})` : ''}</Text>
          </Text>
        )}
      </Box>
      <Box>
        <Box width={8} flexShrink={0}>
          {label('goal', '目标')}
        </Box>
        <Box flexShrink={1}>
          <Text {...t.fg(goal === '' ? 'mut2' : 'ink')}>{goal === '' ? '这个任务要达成什么？' : goal}</Text>
          {caret('goal')}
        </Box>
      </Box>
      <Box>
        <Box width={8} flexShrink={0}>
          {label('cron', '定时')}
        </Box>
        <Text {...t.fg(cron === '' ? 'mut2' : 'ink')}>{cron === '' ? '可选：0 9 * * 1-5' : cron}</Text>
        {caret('cron')}
      </Box>
      {cronError !== null && (
        <Box marginLeft={8}>
          <Text {...t.fg('bad')}>{cronError}</Text>
        </Box>
      )}
      {cronHint !== null && cronError === null && (
        <Box marginLeft={8}>
          <Text {...t.fg('ok')}>{cronHint}</Text>
        </Box>
      )}
      {error !== undefined && error !== null && <Text {...t.fg('bad')}>{error}</Text>}
      {busy && <Text {...t.fg('mut')}>正在创建…</Text>}
    </Box>
  )
}
