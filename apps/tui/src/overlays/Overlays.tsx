/**
 * 三个弹层与帮助 —— PRD-M8-015 AC-2 / AC-3 / AC-4。
 * 数据都从 daemon 拿（project.list / session.list / schedule.list），这里只排版与转发按键（INV-02）。
 */
import type { DomiClient } from '@domi/client-core'
import { Box, Text } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import { COMMANDS } from '../commands.ts'
import { Overlay, type OverlayItem } from '../components/Overlay.tsx'
import type { OverlayId } from '../keys.ts'
import { useTheme } from '../theme.ts'
import { TaskForm, type TaskFormValue } from './TaskForm.tsx'

export interface OverlayState {
  id: OverlayId
  /** 任务弹层直接进新建表单（项目弹层里回车过来的带着项目） */
  form?: { projectId?: string }
}

type Project = Awaited<ReturnType<DomiClient['listProjects']>>[number]
type Session = Awaited<ReturnType<DomiClient['listSessions']>>['sessions'][number]
type Schedule = Awaited<ReturnType<DomiClient['listSchedules']>>[number]

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (n: string) => n.padStart(2, '0')

/** 常见的几种 cron 说成人话（原型「每天 23:00」）；认不出的原样给 */
export function describeCron(cron: string): string {
  const [m, h, dom, mon, dow] = cron.split(' ')
  if (!m || !h || !/^\d+$/.test(m) || !/^\d+$/.test(h) || mon !== '*') return cron
  const at = `${pad(h)}:${pad(m)}`
  if (dom === '*' && dow === '*') return `每天 ${at}`
  if (dom === '*' && dow === '1-5') return `工作日 ${at}`
  if (dom === '*' && dow !== undefined && /^[0-7]$/.test(dow)) return `每${WEEK[Number(dow) % 7]} ${at}`
  if (dow === '*' && dom !== undefined && /^\d+$/.test(dom)) return `每月 ${dom} 日 ${at}`
  return cron
}

function ago(t: number, now: number): string {
  const m = Math.floor((now - t) / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return d === 1 ? '昨天' : `${d} 天前`
}

export function projectItems(projects: readonly Project[], currentProject?: string): OverlayItem[] {
  return projects.map((p) => ({
    key: p.id,
    label: p.name,
    meta: `${p.path} · ${p.taskCount} 任务`,
    search: p.path,
    dot: p.id === currentProject ? 'accent' : 'off',
  }))
}

export function sessionItems(sessions: readonly Session[], projects: readonly Project[], now: number): OverlayItem[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const groupOf = (s: Session) => (s.projectId === undefined ? '无项目' : (names.get(s.projectId) ?? '其他项目'))
  const order = (g: string) => (g === '无项目' ? 0 : 1)
  return [...sessions]
    .filter((s) => !s.deleted && s.parentId === undefined)
    .sort(
      (a, b) =>
        order(groupOf(a)) - order(groupOf(b)) || groupOf(a).localeCompare(groupOf(b)) || b.updatedAt - a.updatedAt,
    )
    .map((s) => ({
      key: s.id,
      label: s.title.trim() === '' ? s.id : s.title,
      group: groupOf(s),
      meta: s.busy ? '运行中' : s.unread ? `未读 · ${ago(s.updatedAt, now)}` : ago(s.updatedAt, now),
      dot: s.busy ? 'running' : s.unread ? 'warn' : 'off',
      search: s.id,
    }))
}

export function taskItems(sessions: readonly Session[], schedules: readonly Schedule[], now: number): OverlayItem[] {
  const running = sessions
    .filter((s) => s.kind === 'task' && s.busy && !s.deleted)
    .map<OverlayItem>((s) => ({
      key: `s:${s.id}`,
      label: s.title.trim() === '' ? s.id : s.title,
      group: '进行中',
      meta: ago(s.updatedAt, now),
      dot: 'running',
    }))
  const timed = schedules.map<OverlayItem>((s) => ({
    key: `c:${s.id}`,
    label: s.goal,
    group: '定时',
    meta: s.paused ? `${describeCron(s.cron)} · 已暂停` : describeCron(s.cron),
    dot: s.paused ? 'off' : s.lastRun?.skipped ? 'warn' : 'ok',
  }))
  return [...running, ...timed]
}

function HelpOverlay({ onClose }: { onClose(): void }) {
  const t = useTheme()
  const keys: Array<[string, string]> = [
    ['p / Ctrl+P', '项目'],
    ['s / Ctrl+R', '会话'],
    ['t / Ctrl+T', '任务'],
    ['Enter', '发送'],
    ['Ctrl+J', '换行'],
    ['/', '命令（Tab 补全）'],
    ['y / n / a', '允许 / 拒绝 / 本会话始终允许'],
    ['Ctrl+C', '退出（任务在 domid 里继续）'],
  ]
  return (
    <Overlay
      title="帮助"
      items={[]}
      searchable={false}
      hints={[['esc', '关闭']]}
      onSelect={() => undefined}
      onClose={onClose}
    >
      <Box flexDirection="column" paddingX={1}>
        <Text {...t.fg('mut2')}>单键只在输入框为空时生效</Text>
        {keys.map(([k, d]) => (
          <Box key={k}>
            <Box width={14} flexShrink={0}>
              <Text {...t.fg('accent')}>{k}</Text>
            </Box>
            <Text {...t.fg('ink2')}>{d}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text {...t.fg('mut2')}>命令</Text>
        </Box>
        {COMMANDS.map((c) => (
          <Box key={c.name}>
            <Box width={14} flexShrink={0}>
              <Text {...t.fg('accent')}>{c.name}</Text>
            </Box>
            <Text {...t.fg('ink2')} wrap="truncate-end">
              {c.desc}
              <Text {...t.fg('mut2')}>{c.args === undefined ? '' : `  ${c.args}`}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    </Overlay>
  )
}

export function Overlays({
  client,
  state,
  sessionId,
  onChange,
  onOpenSession,
}: {
  client: DomiClient
  state: OverlayState
  sessionId: string
  onChange(next: OverlayState | null): void
  onOpenSession(id: string): void
}): React.ReactElement {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const close = useCallback(() => onChange(null), [onChange])
  const fail = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e))

  const load = useCallback(() => {
    client.listProjects({ recent: 0 }).then(setProjects, () => setProjects([]))
    client.listSessions().then(
      (r) => setSessions(r.sessions),
      (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)),
    )
    client.listSchedules().then(setSchedules, () => setSchedules([]))
  }, [client])
  // 打开时拉一次；列表里有运行中的，每 2 秒刷一次
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换弹层时重新拉
  useEffect(() => {
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [load, state.id])

  const now = Date.now()
  const currentProject = sessions?.find((s) => s.id === sessionId)?.projectId

  if (state.id === 'help') return <HelpOverlay onClose={close} />

  if (state.id === 'projects') {
    return (
      <Overlay
        title="项目选择"
        placeholder="搜索项目…"
        items={projectItems(projects ?? [], currentProject)}
        empty={projects === null ? '加载中…' : '还没有项目'}
        hints={[
          ['↑↓', '选择'],
          ['enter', '新任务'],
          ['esc', '关闭'],
        ]}
        notice={notice}
        onSelect={(it) => onChange({ id: 'tasks', form: { projectId: it.key } })}
        onClose={close}
      />
    )
  }

  if (state.id === 'sessions') {
    return (
      <Overlay
        title="会话历史"
        placeholder="搜索会话…"
        items={sessionItems(sessions ?? [], projects ?? [], now)}
        empty={sessions === null ? '加载中…' : '还没有会话'}
        hints={[
          ['↑↓', '选择'],
          ['enter', '打开'],
          ['esc', '关闭'],
        ]}
        notice={notice}
        onSelect={(it) => {
          close()
          if (it.key !== sessionId) onOpenSession(it.key)
        }}
        onClose={close}
      />
    )
  }

  // 任务
  const form = state.form
  const submit = (v: TaskFormValue): void => {
    setCreating(true)
    setNotice(null)
    const done = v.cron
      ? client.createSchedule({ projectId: v.projectId, goal: v.goal, cron: v.cron }).then(() => {
          setNotice('定时任务已创建')
          onChange({ id: 'tasks' })
          load()
        })
      : client.createTask(v.projectId, v.goal).then((r) => {
          close()
          onOpenSession(r.sessionId)
        })
    done.catch(fail).finally(() => setCreating(false))
  }
  return (
    <Overlay
      title={form ? '新建任务' : '计划任务'}
      searchable={false}
      items={taskItems(sessions ?? [], schedules, now)}
      empty={sessions === null ? '加载中…' : '没有进行中的任务，也没有定时任务。按 n 新建'}
      hints={
        form
          ? [
              ['tab', '换字段'],
              ['←→', '选项目'],
              ['enter', '创建'],
              ['esc', '返回'],
            ]
          : [
              ['n', '新建'],
              ['enter', '打开 / 运行'],
              ['p', '暂停 / 恢复'],
              ['esc', '关闭'],
            ]
      }
      notice={form ? null : notice}
      active={!form}
      onSelect={(it) => {
        const id = it.key.slice(2)
        if (it.key.startsWith('s:')) {
          close()
          onOpenSession(id)
          return
        }
        client.runScheduleNow(id).then((sid) => {
          close()
          onOpenSession(sid)
        }, fail)
      }}
      onKey={(input, it) => {
        if (input === 'n') {
          setNotice(null)
          onChange({ id: 'tasks', form: currentProject === undefined ? {} : { projectId: currentProject } })
          return true
        }
        if (input === 'p' && it?.key.startsWith('c:')) {
          const s = schedules.find((x) => `c:${x.id}` === it.key)
          if (s) client.updateSchedule({ id: s.id, paused: !s.paused }).then(load, fail)
          return true
        }
        return false
      }}
      onClose={close}
    >
      {form ? (
        <TaskForm
          projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
          initialProject={form.projectId}
          busy={creating}
          error={notice}
          validateCron={(cron) =>
            client.previewSchedule(cron).then(
              () => null,
              (e: Error) => e.message,
            )
          }
          onSubmit={submit}
          onCancel={() => {
            setNotice(null)
            onChange({ id: 'tasks' })
          }}
        />
      ) : undefined}
    </Overlay>
  )
}
