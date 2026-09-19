/**
 * 三个弹层与帮助 —— PRD-M8-015 AC-2 / AC-3 / AC-4。
 * 数据都从 daemon 拿（project.list / session.list / schedule.list），这里只排版与转发按键（INV-02）。
 */

import type { DomiClient } from '@domi/client-core'
import { getLocale, tr } from '@domi/i18n'
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
type ModelList = Awaited<ReturnType<DomiClient['listModels']>>

const WEEK = () => [
  tr('tui.week.0'),
  tr('tui.week.1'),
  tr('tui.week.2'),
  tr('tui.week.3'),
  tr('tui.week.4'),
  tr('tui.week.5'),
  tr('tui.week.6'),
]
const pad = (n: string) => n.padStart(2, '0')

/** 常见的几种 cron 说成人话（原型「每天 23:00」）；认不出的原样给 */
export function describeCron(cron: string): string {
  const [m, h, dom, mon, dow] = cron.split(' ')
  if (!m || !h || !/^\d+$/.test(m) || !/^\d+$/.test(h) || mon !== '*') return cron
  const at = `${pad(h)}:${pad(m)}`
  if (dom === '*' && dow === '*') return tr('tui.cron.daily', { at })
  if (dom === '*' && dow === '1-5') return tr('tui.cron.weekdays', { at })
  if (dom === '*' && dow !== undefined && /^[0-7]$/.test(dow))
    return tr('tui.cron.weekly', { v: WEEK()[Number(dow) % 7] ?? dow, at })
  if (dow === '*' && dom !== undefined && /^\d+$/.test(dom)) return tr('tui.cron.monthly', { dom, at })
  return cron
}

function ago(t: number, now: number): string {
  const m = Math.floor((now - t) / 60_000)
  if (m < 1) return tr('tui.ago.now')
  if (m < 60) return tr('tui.ago.minutes', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return tr('tui.ago.hours', { h })
  const d = Math.floor(h / 24)
  return d === 1 ? tr('tui.ago.yesterday') : tr('tui.ago.days', { d })
}

export function projectItems(projects: readonly Project[], currentProject?: string): OverlayItem[] {
  return projects.map((p) => ({
    key: p.id,
    label: p.name,
    meta: tr('tui.projects.meta', { path: p.path, taskCount: p.taskCount }),
    search: p.path,
    dot: p.id === currentProject ? 'accent' : 'off',
  }))
}

export function sessionItems(sessions: readonly Session[], projects: readonly Project[], now: number): OverlayItem[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const groupOf = (s: Session) =>
    s.projectId === undefined ? tr('common.noProject') : (names.get(s.projectId) ?? tr('tui.sessions.otherProject'))
  const order = (g: string) => (g === tr('common.noProject') ? 0 : 1)
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
      meta: s.busy
        ? tr('common.running')
        : s.unread
          ? tr('tui.sessions.unread', { ago: ago(s.updatedAt, now) })
          : ago(s.updatedAt, now),
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
      group: tr('common.inProgress'),
      meta: ago(s.updatedAt, now),
      dot: 'running',
    }))
  const timed = schedules.map<OverlayItem>((s) => ({
    key: `c:${s.id}`,
    label: s.goal,
    group: tr('tui.tasks.scheduled'),
    meta: s.paused ? tr('tui.tasks.pausedCron', { describeCron: describeCron(s.cron) }) : describeCron(s.cron),
    dot: s.paused ? 'off' : s.lastRun?.skipped ? 'warn' : 'ok',
  }))
  return [...running, ...timed]
}

/**
 * 模型列表（PRD-M9-003 AC-4）：按供应商分组，同名模型在不同家各占一行；当前在用的点亮。
 * key 是 `provider\n模型名`——身份是这两样一起，光有名字认不出是哪一家
 */
export function modelItems(list: ModelList, current: { provider: string; name: string }): OverlayItem[] {
  return list.models.map((m) => ({
    key: `${m.provider}\n${m.name}`,
    label: m.name,
    group: m.providerName,
    meta: [
      m.provider === list.current.provider && m.name === list.current.name ? tr('tui.models.default') : '',
      m.source === 'manual' ? tr('tui.models.manual') : m.source === 'fallback' ? tr('tui.models.notProbed') : '',
      m.toolCall ? '' : tr('tui.models.noTools'),
      m.vision ? '' : tr('tui.models.noImages'),
    ]
      .filter(Boolean)
      .join(' · '),
    dot: m.provider === current.provider && m.name === current.name ? 'accent' : 'off',
    search: m.providerName,
  }))
}

/** 设置 · 语言（PRD-M10-004 AC-1）：选项与 Web 设置页一致，当前值点亮 */
export function languageItems(current: string): OverlayItem[] {
  return (
    [
      ['auto', tr('common.followSystem')],
      ['zh', tr('web.settings.langZh')],
      ['en', tr('web.settings.langEn')],
    ] as const
  ).map(([value, label]) => ({
    key: value,
    label,
    dot: current === value ? 'accent' : 'off',
  }))
}

function SettingsOverlay({
  client,
  current,
  onClose,
}: {
  client: DomiClient
  current: string
  onClose(): void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <Overlay
      title={tr('tui.settings.title')}
      searchable={false}
      items={languageItems(current)}
      empty={tr('common.none')}
      hints={[
        ['enter', tr('tui.key.select')],
        ['esc', tr('tui.key.close')],
      ]}
      notice={notice}
      onSelect={(it) => {
        client.setSettings({ 'ui.locale': it.key }).then(
          () => setNotice(tr('tui.settings.appliesOnRestart')),
          (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)),
        )
      }}
      onClose={onClose}
    />
  )
}

function ModelsOverlay({
  client,
  sessionId,
  current,
  onClose,
}: {
  client: DomiClient
  sessionId: string
  current: { provider: string; name: string }
  onClose(): void
}) {
  const [list, setList] = useState<ModelList | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    client.listModels().then(setList, (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)))
  }, [client])
  const failed = list?.providers.filter((p) => p.status === 'fallback') ?? []
  return (
    <Overlay
      title={tr('web.composer.switchModel')}
      placeholder={tr('tui.models.search')}
      items={list === null ? [] : modelItems(list, current)}
      empty={list === null ? tr('common.loading') : tr('tui.models.none')}
      hints={[
        ['↑↓', tr('tui.key.select')],
        ['enter', tr('tui.key.switch')],
        ['esc', tr('tui.key.close')],
      ]}
      notice={
        notice ??
        (failed.length > 0
          ? tr('tui.models.probeFailed', {
              join: failed
                .map((p) => tr('tui.models.failedItem', { name: p.name, v: p.error ?? tr('common.unknown') }))
                .join(tr('common.listSep')),
            })
          : null)
      }
      onSelect={(it) => {
        const [provider, name] = it.key.split('\n')
        if (!provider || !name) return
        client.switchModel(sessionId, name, provider).then(
          () => onClose(),
          (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)),
        )
      }}
      onClose={onClose}
    />
  )
}

function HelpOverlay({ onClose }: { onClose(): void }) {
  const t = useTheme()
  const keys: Array<[string, string]> = [
    ['p / Ctrl+P', tr('tui.help.projects')],
    ['s / Ctrl+R', tr('tui.help.sessions')],
    ['t / Ctrl+T', tr('tui.help.tasks')],
    ['Enter', tr('tui.help.send')],
    ['Ctrl+J', tr('tui.help.newline')],
    ['/', tr('tui.help.commands')],
    ['y / n / a', tr('tui.help.permission')],
    ['Ctrl+C', tr('tui.help.quit')],
  ]
  return (
    <Overlay
      title={tr('tui.help.title')}
      items={[]}
      searchable={false}
      hints={[['esc', tr('tui.key.close')]]}
      onSelect={() => undefined}
      onClose={onClose}
    >
      <Box flexDirection="column" paddingX={1}>
        <Text {...t.fg('mut2')}>{tr('tui.help.singleKeys')}</Text>
        {keys.map(([k, d]) => (
          <Box key={k}>
            <Box width={14} flexShrink={0}>
              <Text {...t.fg('accent')}>{k}</Text>
            </Box>
            <Text {...t.fg('ink2')}>{d}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text {...t.fg('mut2')}>{tr('tui.help.commandsHeader')}</Text>
        </Box>
        {COMMANDS().map((c) => (
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
  currentModel,
  onChange,
  onOpenSession,
}: {
  client: DomiClient
  state: OverlayState
  sessionId: string
  /** 这个会话当前用的模型（模型列表里点亮它） */
  currentModel?: { provider: string; name: string }
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

  if (state.id === 'settings') {
    return <SettingsOverlay client={client} current={getLocale()} onClose={close} />
  }

  if (state.id === 'help') return <HelpOverlay onClose={close} />
  if (state.id === 'models') {
    return (
      <ModelsOverlay
        client={client}
        sessionId={sessionId}
        current={currentModel ?? { provider: '', name: '' }}
        onClose={close}
      />
    )
  }

  if (state.id === 'projects') {
    return (
      <Overlay
        title={tr('tui.projects.title')}
        placeholder={tr('tui.projects.search')}
        items={projectItems(projects ?? [], currentProject)}
        empty={projects === null ? tr('common.loading') : tr('web.sidebar.noProjects')}
        hints={[
          ['↑↓', tr('tui.key.select')],
          ['enter', tr('tui.key.newTask')],
          ['esc', tr('tui.key.close')],
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
        title={tr('tui.sessions.title')}
        placeholder={tr('tui.sessions.search')}
        items={sessionItems(sessions ?? [], projects ?? [], now)}
        empty={sessions === null ? tr('common.loading') : tr('web.sidebar.noChats')}
        hints={[
          ['↑↓', tr('tui.key.select')],
          ['enter', tr('tui.key.open')],
          ['esc', tr('tui.key.close')],
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
          setNotice(tr('tui.tasks.scheduleCreated'))
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
      title={form ? tr('web.sidebar.createTask') : tr('tui.tasks.title')}
      searchable={false}
      items={taskItems(sessions ?? [], schedules, now)}
      empty={sessions === null ? tr('common.loading') : tr('tui.tasks.none')}
      hints={
        form
          ? [
              ['tab', tr('tui.key.nextField')],
              ['←→', tr('tui.key.pickProject')],
              ['enter', tr('tui.key.create')],
              ['esc', tr('tui.key.back')],
            ]
          : [
              ['n', tr('tui.key.new')],
              ['enter', tr('tui.key.openRun')],
              ['p', tr('tui.key.pauseResume')],
              ['esc', tr('tui.key.close')],
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
