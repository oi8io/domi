/**
 * `domi task …` —— PRD-M5-002 / 003
 *
 * 编排跑在 domid 里（关掉终端也继续跑），这里只是一个协议客户端：读 YAML、发请求、打印状态。
 * 不在 packages/cli 里：它要拉起 / 连接 domid，那是端的接线（和 connect.ts 同一类东西）。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSessionStore, type DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'

export interface TaskIo {
  out(s: string): void
  err(s: string): void
}

export const TASK_USAGE = () => tr('tui.task.usage')

const ICON: Record<string, string> = { pending: '○', running: '◐', done: '●', failed: '✗', blocked: '⊘' }

export function formatRun(r: Awaited<ReturnType<DomiClient['getTask']>>): string {
  const lines = [
    `${r.name}  ${r.runId}  ${r.status}${r.status === 'running' && !r.active ? tr('tui.task.waitingDaemon') : ''}`,
  ]
  for (const n of r.nodes) {
    const ms = n.ms === undefined ? '' : `  ${(n.ms / 1000).toFixed(1)}s`
    const extra = n.error ?? (n.status === 'done' ? n.output : undefined)
    lines.push(
      `  ${ICON[n.status] ?? '?'} ${n.id} [${n.type}]${n.attempt > 1 ? tr('tui.task.attempt', { attempt: n.attempt }) : ''}${ms}` +
        (extra ? `\n      ${extra.split('\n')[0]?.slice(0, 120)}` : ''),
    )
  }
  return lines.join('\n')
}

export async function runTaskCommand(
  sub: string | undefined,
  args: readonly string[],
  io: TaskIo,
  client: DomiClient,
  opts: { follow?: boolean; cwd: string },
): Promise<number> {
  switch (sub) {
    case 'run': {
      const file = args[0]
      if (!file) {
        io.err(TASK_USAGE())
        return 2
      }
      const r = await client.startTask(readFileSync(resolve(opts.cwd, file), 'utf8'), opts.cwd)
      io.out(
        tr('tui.task.started', { name: r.name, runId: r.runId, length: r.nodes.length, join: r.nodes.join(' → ') }),
      )
      if (!opts.follow) {
        io.out(tr('tui.task.progress', { runId: r.runId }))
        return 0
      }
      const store = createSessionStore()
      await client.watch(r.runId, store)
      let shown = 0
      for (;;) {
        const items = store.$items.get()
        for (const i of items.slice(shown)) if (i.kind === 'task' || i.kind === 'error') io.out(`  ${i.text}`)
        shown = items.length
        const ask = store.$ask.get()
        if (ask) io.out(tr('tui.task.waitingAsk', { capabilityId: ask.capabilityId }))
        const st = await client.getTask(r.runId)
        if (st.status !== 'running') {
          io.out(formatRun(st))
          return st.status === 'done' ? 0 : 1
        }
        await Bun.sleep(ask ? 5000 : 1000)
      }
    }
    case 'list': {
      const runs = await client.listTasks()
      if (runs.length === 0) io.out(tr('tui.task.none'))
      for (const r of runs) io.out(`${r.runId}  ${r.status.padEnd(9)} ${r.name}`)
      return 0
    }
    case 'status': {
      if (!args[0]) {
        io.err(TASK_USAGE())
        return 2
      }
      io.out(formatRun(await client.getTask(args[0])))
      return 0
    }
    case 'retry': {
      if (!args[0] || !args[1]) {
        io.err(TASK_USAGE())
        return 2
      }
      await client.retryTask(args[0], args[1])
      io.out(tr('tui.task.retrying', { v: args[1] }))
      return 0
    }
    case 'cancel': {
      if (!args[0]) {
        io.err(TASK_USAGE())
        return 2
      }
      io.out((await client.cancelTask(args[0])) ? tr('web.runs.cancelled') : tr('tui.task.alreadyEnded'))
      return 0
    }
    default:
      io.err(TASK_USAGE())
      return 2
  }
}
