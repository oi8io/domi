/**
 * 定时任务 —— PRD-M8-007：任务页的「定时」分区（列表、暂停 / 恢复、立即运行、编辑、删除、历史运行）
 * 与新建表单里的计划时间（cron + 时区 + 下一次运行预览）。校验与时间计算都在 daemon（schedule.preview）。
 */
import { type DomiClient, DomiRpcError } from '@domi/client-core'
import { useCallback, useEffect, useState } from 'react'
import { StatusDot } from '../components/StatusDot.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconClock, IconList, IconPencil, IconTrash, IconZap } from '../icons.tsx'
import type { ProjectRow } from '../layout/data.ts'
import { cn } from '../lib/cn.ts'
import { formatRoute } from '../router.ts'
import { Card } from './Page.tsx'

export type Schedule = Awaited<ReturnType<DomiClient['listSchedules']>>[number]
type Run = Awaited<ReturnType<DomiClient['scheduleRuns']>>[number]

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 按计划自己的时区显示：9月18日 周五 09:00 */
export function formatWhen(t: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(t)
  } catch {
    return new Date(t).toLocaleString()
  }
}

/** cron + 时区输入，带防抖的预览。valid = daemon 认可 */
export function CronFields({
  client,
  cron,
  tz,
  onChange,
  onValid,
  idPrefix = 'schedule',
}: {
  client: DomiClient
  cron: string
  tz: string
  onChange: (v: { cron: string; tz: string }) => void
  onValid: (ok: boolean) => void
  idPrefix?: string
}) {
  const [preview, setPreview] = useState<{ runs: number[]; tz: string } | { error: string } | null>(null)
  useEffect(() => {
    if (cron.trim() === '') {
      setPreview(null)
      onValid(false)
      return
    }
    let stale = false
    const t = setTimeout(() => {
      client.previewSchedule(cron, tz.trim() === '' ? undefined : tz.trim()).then(
        (r) => {
          if (stale) return
          setPreview({ runs: r.nextRuns, tz: r.tz })
          onValid(true)
        },
        (e: unknown) => {
          if (stale) return
          setPreview({ error: e instanceof DomiRpcError || e instanceof Error ? e.message : String(e) })
          onValid(false)
        },
      )
    }, 300)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [client, cron, tz, onValid])
  return (
    <div className="grid gap-1.5" data-part="cron-fields">
      <div className="grid grid-cols-[1fr_180px] gap-2">
        <input
          id={`${idPrefix}-cron`}
          className="field-input font-mono"
          placeholder="0 9 * * 1-5"
          aria-label="cron 表达式"
          value={cron}
          onChange={(e) => onChange({ cron: e.target.value, tz })}
        />
        <input
          id={`${idPrefix}-tz`}
          className="field-input font-mono"
          placeholder="Asia/Shanghai"
          aria-label="时区"
          value={tz}
          onChange={(e) => onChange({ cron, tz: e.target.value })}
        />
      </div>
      <p className="text-[11.5px] text-mut" data-part="cron-preview">
        {preview === null ? (
          '分 时 日 月 周，例如 0 9 * * 1-5 = 工作日早上 9 点'
        ) : 'error' in preview ? (
          <span className="text-bad">{preview.error}</span>
        ) : (
          <>接下来：{preview.runs.map((r) => formatWhen(r, preview.tz)).join('、')}</>
        )}
      </p>
    </div>
  )
}

const RUN_LABEL: Record<Run['status'], { label: string; cls: string }> = {
  running: { label: '进行中', cls: 'bg-accent-d text-accent' },
  done: { label: '已运行', cls: 'bg-ok-d text-ok' },
  skipped: { label: '跳过', cls: 'bg-warn-d text-warn' },
  failed: { label: '没建成', cls: 'bg-bad-d text-bad' },
}

function Runs({ client, schedule }: { client: DomiClient; schedule: Schedule }) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastFired = schedule.lastRun?.firedAt
  // 有新的触发时重新拉
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastFired 是刷新的触发条件
  useEffect(() => {
    client.scheduleRuns(schedule.id, 20).then(setRuns, (e: Error) => setError(e.message))
  }, [client, schedule.id, lastFired])
  if (error !== null) return <p className="px-3.5 pb-2 text-xs text-bad">{error}</p>
  if (runs === null) return null
  if (runs.length === 0) return <p className="px-9 pb-2 text-xs text-mut">还没有运行过。</p>
  return (
    <ul className="mx-3.5 mb-2 overflow-hidden rounded-md border border-border2" data-part="schedule-runs">
      {runs.map((r) => {
        const s = RUN_LABEL[r.status]
        const body = (
          <>
            <span className={cn('shrink-0 rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold', s.cls)}>
              {s.label}
            </span>
            <span className="font-mono">{formatWhen(r.due, schedule.tz)}</span>
            {r.late && <span className="text-mut2">补跑</span>}
          </>
        )
        const cls = 'flex items-center gap-2 border-b border-border2 px-3 py-1.5 text-xs last:border-b-0'
        return r.sessionId === undefined ? (
          <li key={`${r.due}-${r.firedAt}`} className={cls}>
            {body}
          </li>
        ) : (
          <li key={`${r.due}-${r.firedAt}`}>
            <a
              className={cn(cls, 'hover:bg-panel-h')}
              href={formatRoute({ view: 'session', id: r.sessionId, tab: 'chat' })}
            >
              {body}
              <span className="flex-1" />
              <span className="text-mut">打开任务</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function Editor({
  client,
  schedule,
  onSaved,
  onCancel,
}: {
  client: DomiClient
  schedule: Schedule
  onSaved: () => void
  onCancel: () => void
}) {
  const [goal, setGoal] = useState(schedule.goal)
  const [when, setWhen] = useState({ cron: schedule.cron, tz: schedule.tz })
  const [valid, setValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const onValid = useCallback((ok: boolean) => setValid(ok), [])
  return (
    <div className="mx-3.5 mb-2 grid gap-2 rounded-md border border-border2 p-3" data-part="schedule-editor">
      <textarea
        className="field-input min-h-[60px]"
        aria-label="目标"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />
      <CronFields
        client={client}
        cron={when.cron}
        tz={when.tz}
        onChange={setWhen}
        onValid={onValid}
        idPrefix={`edit-${schedule.id}`}
      />
      {error !== null && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!valid || goal.trim() === ''}
          onClick={() =>
            client
              .updateSchedule({ id: schedule.id, goal: goal.trim(), cron: when.cron, tz: when.tz })
              .then(onSaved, (e: Error) => setError(e.message))
          }
        >
          保存
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}

function ScheduleRow({
  client,
  schedule,
  project,
  onChanged,
  onNotice,
}: {
  client: DomiClient
  schedule: Schedule
  project: string
  onChanged: () => void
  onNotice: (n: string | null) => void
}) {
  const [open, setOpen] = useState<'runs' | 'edit' | null>(null)
  const [armed, setArmed] = useState(false)
  const act = (p: Promise<unknown>): void => {
    p.then(
      () => {
        onNotice(null)
        onChanged()
      },
      (e: Error) => onNotice(e.message),
    )
  }
  const when = schedule.paused
    ? '已暂停'
    : schedule.nextRun === null
      ? '不会再运行'
      : `下次 ${formatWhen(schedule.nextRun, schedule.tz)}`
  return (
    <li data-schedule={schedule.id}>
      <div className="flex items-center gap-2 rounded-md px-3.5 py-2.5 transition-colors duration-150 hover:bg-panel-h">
        <StatusDot state="idle" className={cn('size-2', !schedule.paused && 'bg-accent')} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13.5px] font-medium', schedule.paused && 'text-mut')}>
            {schedule.goal}
          </span>
          <span className="block truncate text-[11.5px] text-mut">
            {project} · <code className="font-mono">{schedule.cron}</code> {schedule.tz} · {when}
          </span>
        </span>
        <Button
          variant="ghost"
          size="xs"
          title="立即运行一次"
          onClick={() =>
            client.runScheduleNow(schedule.id).then(
              (id) => {
                onNotice(null)
                onChanged()
                location.hash = formatRoute({ view: 'session', id, tab: 'chat' })
              },
              (e: Error) => onNotice(e.message),
            )
          }
        >
          <IconZap size={12} />
          运行
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => act(client.updateSchedule({ id: schedule.id, paused: !schedule.paused }))}
          data-action="toggle-pause"
        >
          {schedule.paused ? '恢复' : '暂停'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          title="历史运行"
          className={cn(open === 'runs' && 'bg-panel-h text-ink2')}
          onClick={() => setOpen(open === 'runs' ? null : 'runs')}
        >
          <IconList size={12} />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          title="编辑"
          className={cn(open === 'edit' && 'bg-panel-h text-ink2')}
          onClick={() => setOpen(open === 'edit' ? null : 'edit')}
        >
          <IconPencil size={12} />
        </Button>
        <Button
          variant={armed ? 'armed' : 'ghost'}
          size="xs"
          title="删除定时任务（已经运行过的任务不动）"
          onBlur={() => setArmed(false)}
          onClick={() => {
            if (!armed) setArmed(true)
            else act(client.deleteSchedule(schedule.id))
          }}
        >
          <IconTrash size={12} />
          {armed ? '确认删除' : ''}
        </Button>
      </div>
      {open === 'runs' && <Runs client={client} schedule={schedule} />}
      {open === 'edit' && (
        <Editor
          client={client}
          schedule={schedule}
          onCancel={() => setOpen(null)}
          onSaved={() => {
            setOpen(null)
            onChanged()
          }}
        />
      )}
    </li>
  )
}

export function useSchedules(client: DomiClient, online: boolean) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    client.listSchedules().then(
      (s) => {
        setSchedules(s)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [client])
  // 下一次运行时间与最近一次触发会变：在页面上时每 30 秒刷一次
  useEffect(() => {
    if (!online) return
    reload()
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [online, reload])
  return { schedules, error, reload }
}

export function ScheduleSection({
  client,
  schedules,
  error,
  projects,
  onChanged,
}: {
  client: DomiClient
  schedules: readonly Schedule[] | null
  error: string | null
  projects: readonly ProjectRow[]
  onChanged: () => void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const names = new Map(projects.map((p) => [p.id, p.name]))
  return (
    <>
      <div className="caps mb-2 flex items-center gap-1.5">
        <IconClock size={12} />
        定时任务
        <span className="flex-1" />
        <a
          className="text-[11.5px] font-normal tracking-normal text-accent normal-case hover:underline"
          href={formatRoute({ view: 'tasks', create: true, schedule: true })}
        >
          新建
        </a>
      </div>
      <Card className="px-0 py-2">
        {(notice ?? error) !== null && <p className="px-3.5 pb-1 text-[12.5px] text-bad">{notice ?? error}</p>}
        {schedules === null ? (
          <p className="px-3.5 py-2 text-[13px] text-mut">加载中…</p>
        ) : schedules.length === 0 ? (
          <p className="px-3.5 py-2 text-[13px] text-mut">还没有定时任务。每天或每周要做的事，可以交给它按时跑。</p>
        ) : (
          <ul>
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                client={client}
                schedule={s}
                project={names.get(s.projectId) ?? s.projectId}
                onChanged={onChanged}
                onNotice={setNotice}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
