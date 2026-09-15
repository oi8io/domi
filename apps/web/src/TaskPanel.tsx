/**
 * 长任务（PRD-M5-002）。列出运行、看节点状态、重试失败节点、取消、粘贴 YAML 开始一次运行。
 * 状态都从 daemon 拿（task.get），这里不算任何东西（INV-02）。
 */
import type { DomiClient } from '@domi/client-core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

type Run = Awaited<ReturnType<DomiClient['listTasks']>>[number]
type Detail = Awaited<ReturnType<DomiClient['getTask']>>

const STATUS: Record<string, string> = {
  pending: '等待',
  running: '进行中',
  done: '完成',
  failed: '失败',
  blocked: '被挡住',
  cancelled: '已取消',
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
    <div className="run">
      <h2>
        {run.name} <span className={`run-status s-${run.status}`}>{STATUS[run.status]}</span>
        {run.status === 'running' && !run.active && <span className="meta">（等待 domid 恢复）</span>}
      </h2>
      <ol className="nodes">
        {run.nodes.map((n) => (
          <li key={n.id} className={`node s-${n.status}`}>
            <span className="node-status">{STATUS[n.status]}</span>
            <span className="node-id">{n.title ?? n.id}</span>
            <span className="meta">
              {n.type}
              {n.needs.length > 0 ? ` · 依赖 ${n.needs.join('、')}` : ''}
              {n.attempt > 1 ? ` · 第 ${n.attempt} 次` : ''}
              {n.ms === undefined ? '' : ` · ${(n.ms / 1000).toFixed(1)}s`}
            </span>
            {n.sessionId !== undefined && onOpen && (
              <button type="button" onClick={() => onOpen(n.sessionId as string)}>
                看过程
              </button>
            )}
            {n.status === 'failed' && run.status !== 'running' && onRetry && (
              <button type="button" onClick={() => onRetry(n.id)}>
                重试
              </button>
            )}
            {(n.error ?? n.output) !== undefined && <pre className="node-output">{n.error ?? n.output}</pre>}
          </li>
        ))}
      </ol>
      {run.status === 'running' && onCancel && (
        <button type="button" className="danger" onClick={onCancel}>
          取消这次运行
        </button>
      )}
    </div>
  )
}

export function TaskPanel({ client, onOpen }: { client: DomiClient; onOpen?: (sessionId: string) => void }) {
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
    <section className="session tasks">
      {notice !== null && <p className="error">{notice}</p>}
      <ul className="runs">
        {runs.map((r) => (
          <li key={r.runId}>
            <button type="button" onClick={() => act(client.getTask(r.runId).then(setCurrent))}>
              <span className={`run-status s-${r.status}`}>{STATUS[r.status]}</span> {r.name}
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <RunView
          run={current}
          onRetry={(id) => act(client.retryTask(current.runId, id))}
          onCancel={() => act(client.cancelTask(current.runId))}
          {...(onOpen ? { onOpen } : {})}
        />
      )}
      <form className="task-start" onSubmit={start}>
        <label htmlFor="task-spec">新任务（YAML，写法见 docs/tasks-example.yaml）</label>
        <textarea id="task-spec" rows={8} value={spec} onChange={(e) => setSpec(e.target.value)} />
        <button type="submit" disabled={spec.trim() === ''}>
          开始
        </button>
      </form>
    </section>
  )
}
