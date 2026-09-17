/**
 * 编排运行（PRD-M5-002 · PRD-M8-005 AC-4）：多节点运行的列表、节点状态、重试失败节点、取消、打开节点会话；
 * 「高级：粘贴 YAML」保留原来的入口（task.start）。状态都从 daemon 拿（task.get），这里不算任何东西（INV-02）。
 */
import type { DomiClient } from '@domi/client-core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { StatusDot } from '../components/StatusDot.tsx'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'

type Run = Awaited<ReturnType<DomiClient['listTasks']>>[number]
type Detail = Awaited<ReturnType<DomiClient['getTask']>>

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '等待', cls: 'bg-panel-h text-mut' },
  running: { label: '进行中', cls: 'bg-accent-d text-accent' },
  done: { label: '完成', cls: 'bg-ok-d text-ok' },
  failed: { label: '失败', cls: 'bg-bad-d text-bad' },
  blocked: { label: '被挡住', cls: 'bg-warn-d text-warn' },
  cancelled: { label: '已取消', cls: 'bg-panel-h text-mut' },
}

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-panel-h text-mut' }
  return (
    <span
      className={cn('shrink-0 rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold', s.cls)}
      data-status={status}
    >
      {s.label}
    </span>
  )
}

export function RunView({
  run,
  onRetry,
  onCancel,
  onOpen,
}: {
  run: Detail
  onRetry?: (nodeId: string) => void
  onCancel?: () => void
  onOpen?: (sessionId: string) => void
}) {
  return (
    <div className="border-t border-border2 px-3.5 pt-3 pb-1" data-part="run">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <span className="truncate">{run.name}</span>
        <Pill status={run.status} />
        {run.status === 'running' && !run.active && (
          <span className="text-[11.5px] font-normal text-mut">等待 domid 恢复</span>
        )}
        <span className="flex-1" />
        {run.status === 'running' && onCancel && (
          <Button variant="danger" size="xs" onClick={onCancel}>
            取消这次运行
          </Button>
        )}
      </div>
      <ol className="mb-2 overflow-hidden rounded-md border border-border2">
        {run.nodes.map((n) => (
          <li key={n.id} className="border-b border-border2 last:border-b-0" data-node={n.id}>
            <div className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
              <Pill status={n.status} />
              <span className="min-w-0 truncate font-medium">{n.title ?? n.id}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-mut2">
                {n.type}
                {n.needs.length > 0 ? ` · 依赖 ${n.needs.join('、')}` : ''}
                {n.attempt > 1 ? ` · 第 ${n.attempt} 次` : ''}
                {n.ms === undefined ? '' : ` · ${(n.ms / 1000).toFixed(1)}s`}
              </span>
              {n.sessionId !== undefined && onOpen && (
                <Button variant="ghost" size="xs" onClick={() => onOpen(n.sessionId as string)}>
                  看过程
                </Button>
              )}
              {n.status === 'failed' && run.status !== 'running' && onRetry && (
                <Button variant="outline" size="xs" onClick={() => onRetry(n.id)}>
                  重试
                </Button>
              )}
            </div>
            {(n.error ?? n.output) !== undefined && (
              <pre
                className={cn(
                  'max-h-[200px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap',
                  n.error !== undefined ? 'text-bad' : 'text-ink2',
                )}
              >
                {n.error ?? n.output}
              </pre>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function RunsPanel({ client, onOpen }: { client: DomiClient; onOpen?: (sessionId: string) => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [current, setCurrent] = useState<Detail | null>(null)
  const [spec, setSpec] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setRuns(await client.listTasks())
    if (current) setCurrent(await client.getTask(current.runId))
  }, [client, current])

  // 运行在 daemon 里走，页面每两秒拉一次（订阅运行会话也行，这里要的是整张节点表）
  useEffect(() => {
    refresh().catch((e: Error) => setNotice(e.message))
    const t = setInterval(() => {
      refresh().catch(() => undefined)
    }, 2000)
    return () => clearInterval(t)
  }, [refresh])

  const act = (p: Promise<unknown>): void => {
    p.then(
      () => refresh(),
      (e: Error) => setNotice(e.message),
    ).catch(() => undefined)
  }

  const start = (e: FormEvent): void => {
    e.preventDefault()
    client.startTask(spec).then(
      async (r) => {
        setSpec('')
        setNotice(null)
        setCurrent(await client.getTask(r.runId))
        await refresh()
      },
      (err: Error) => setNotice(err.message),
    )
  }

  return (
    <div data-part="runs">
      {notice !== null && <p className="px-3.5 pb-2 text-[12.5px] text-bad">{notice}</p>}
      {runs.length === 0 ? (
        <p className="px-3.5 py-2 text-[13px] text-mut">还没有多节点运行。计划拆成多步时会自动出现在这里。</p>
      ) : (
        <ul>
          {runs.map((r) => (
            <li key={r.runId}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3.5 py-2 text-left text-[13.5px] transition-colors duration-150 hover:bg-panel-h',
                  current?.runId === r.runId && 'bg-panel-h',
                )}
                onClick={() =>
                  current?.runId === r.runId ? setCurrent(null) : act(client.getTask(r.runId).then(setCurrent))
                }
              >
                <StatusDot state={r.status === 'running' ? 'running' : 'idle'} className="size-2" />
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <Pill status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <RunView
          run={current}
          onRetry={(id) => act(client.retryTask(current.runId, id))}
          onCancel={() => act(client.cancelTask(current.runId))}
          {...(onOpen ? { onOpen } : {})}
        />
      )}
      <details className="mx-3.5 mt-2 text-[13px]">
        <summary className="cursor-pointer text-mut select-none">高级：粘贴 YAML 开始一次运行</summary>
        <form className="mt-2 grid gap-2" onSubmit={start}>
          <label className="text-[11.5px] text-mut" htmlFor="task-spec">
            写法见 docs/tasks-example.yaml
          </label>
          <textarea
            id="task-spec"
            className="field-input min-h-[140px] font-mono text-xs"
            rows={8}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
          <div>
            <Button type="submit" variant="primary" disabled={spec.trim() === ''}>
              开始
            </Button>
          </div>
        </form>
      </details>
    </div>
  )
}
