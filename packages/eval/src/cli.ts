/**
 * `domi eval` —— PRD-M2-008 AC-1 / AC-2
 *
 * 命令实现住在 **packages/eval 自己**，`packages/cli` 只做一次动态 import 把它接上。
 * 理由是 AC-5：eval 必须能被整个删掉。实现留在 eval 里，删掉时跟着一起走；
 * 接线处只剩一个 try/catch，退化成一句「评估层没装」，而不是让 `domi` 整个起不来。
 *
 * 录制不写任何新埋点 —— 数据来源只有事件流（INV-13）。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tr } from '@domi/i18n'
import { SqliteEventLog } from '@domi/store'
import { type Fixture, parse, record, serialize } from './fixture.ts'
import { formatL2Report, L2_DIR, loadL2Tasks, runL2 } from './l2.ts'
import { mineTasks } from './mine.ts'
import { formatResult, replay } from './replay.ts'

export interface Io {
  out(s: string): void
  err(s: string): void
}

/** fixture 默认落在仓库里，跟着代码一起进版本库 —— 它是测试资产，不是用户数据 */
export const FIXTURE_DIR = join('fixtures', 'sessions')

export const EVAL_HELP = () => tr('eval.help', { FIXTURE_DIR })

function dbPath(): string {
  return join(homedir(), '.domi', 'events.db')
}

async function cmdRecord(sessionId: string | undefined, io: Io): Promise<number> {
  if (!sessionId) {
    io.err(tr('eval.recordUsage'))
    return 2
  }
  const log = new SqliteEventLog({ path: dbPath() })
  try {
    const events = await log.read(sessionId)
    if (events.length === 0) {
      io.err(tr('trace.noEvents', { sessionId }))
      return 1
    }
    const fixture = record(events, sessionId)
    mkdirSync(FIXTURE_DIR, { recursive: true })
    const out = join(FIXTURE_DIR, `${sessionId}.json`)
    writeFileSync(out, serialize(fixture), 'utf8')
    io.out(
      tr('eval.recorded', { out }) +
        tr('eval.recordedDetail', {
          length: events.length,
          length2: fixture.turns.length,
          length3: fixture.expectedCalls.length,
        }),
    )
    return 0
  } finally {
    log.close()
  }
}

function loadFixtures(paths: readonly string[], io: Io): Array<{ path: string; fixture: Fixture }> {
  const files =
    paths.length > 0
      ? [...paths]
      : (() => {
          try {
            return readdirSync(FIXTURE_DIR)
              .filter((f) => f.endsWith('.json'))
              .map((f) => join(FIXTURE_DIR, f))
          } catch {
            return []
          }
        })()

  const out: Array<{ path: string; fixture: Fixture }> = []
  for (const p of files) {
    try {
      out.push({ path: p, fixture: parse(readFileSync(p, 'utf8')) })
    } catch (e) {
      io.err(tr('eval.skip', { p, v: e instanceof Error ? e.message : String(e) }))
    }
  }
  return out
}

async function cmdRun(paths: readonly string[], io: Io): Promise<number> {
  const loaded = loadFixtures(paths, io)
  if (loaded.length === 0) {
    io.err(tr('eval.noFixtures', { FIXTURE_DIR }))
    return 1
  }

  let failed = 0
  for (const { fixture } of loaded) {
    const r = await replay(fixture)
    io.out(formatResult(r))
    if (!r.ok) failed++
  }
  io.out(tr('eval.passed', { v: loaded.length - failed, length: loaded.length }))
  return failed === 0 ? 0 : 1
}

/**
 * L2 的接线（INV-08-LIVE：会发真实模型请求，check-ci-no-live-calls 据此确认 CI 不跑它）。
 * 每题一个临时工作区、一个临时事件库；权限只放行题目声明的能力
 */
async function cmdL2(args: readonly string[], io: Io): Promise<number> {
  const roundsArg = args.indexOf('--rounds')
  const rounds = roundsArg >= 0 ? Number(args[roundsArg + 1]) : 3
  const tasksArg = args.indexOf('--tasks')
  const valueAt = new Set([roundsArg + 1, tasksArg + 1].filter((i) => i > 0))
  const only = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i))
  const tasks = loadL2Tasks(tasksArg >= 0 ? args[tasksArg + 1] : undefined, only)
  if (tasks.length === 0) {
    io.err(tr('eval.noTasks'))
    return 1
  }
  const { loadConfigOrThrow, ConfigSchema } = await import('@domi/config')
  const { DomiSession } = await import('@domi/runtime')
  const base = loadConfigOrThrow({ home: process.env.HOME || homedir() })
  io.out(tr('eval.l2Start', { length: tasks.length, rounds, provider: base.model.provider, name: base.model.name }))
  const report = await runL2(tasks, {
    rounds,
    model: `${base.model.provider}/${base.model.name}`,
    pricing: L2_PRICING,
    onProgress: (a) =>
      io.out(
        tr('eval.l2Attempt', {
          v: a.pass ? '✅' : '❌',
          taskId: a.taskId,
          round: a.round,
          toFixed: (a.ms / 1000).toFixed(1),
        }),
      ),
    run: async ({ task, workspace, dbPath, sessionId, signal }) => {
      const config = ConfigSchema.parse({
        ...base,
        memory: { ...base.memory, extractEvery: 0, soul: false },
        mcp: { servers: [], allowedHosts: [], timeoutMs: base.mcp.timeoutMs },
        permissions: { rules: task.allow.map((c) => ({ name: `l2-${c}`, capability: c, decision: 'allow' })) },
      })
      const s = new DomiSession({ config, sessionId, cwd: workspace, dbPath })
      signal.addEventListener('abort', () => void s.flushAndClose())
      try {
        await s.submit(task.prompt)
        return await s.pumpAll()
      } finally {
        await s.flushAndClose().catch(() => undefined)
      }
    },
  })
  const dir = join(L2_DIR, 'reports')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(report.startedAt).toISOString().replace(/[:.]/g, '-')
  writeFileSync(join(dir, `${stamp}.md`), formatL2Report(report), 'utf8')
  writeFileSync(join(dir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  io.out(
    tr('eval.l2Done', {
      join: formatL2Report(report).split('\n').slice(0, 6).join('\n'),
      join2: join(dir, `${stamp}.md`),
    }),
  )
  return 0
}

/** 与 trace 同一份口径：没有的模型显示 —，不当成免费 */
const L2_PRICING = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1 },
}

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function cmdMine(args: readonly string[], io: Io): Promise<number> {
  const values = new Set(
    ['--since', '--limit', '--test-cmd', '--setup', '--out'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0),
  )
  const repo = args.find((a, i) => !a.startsWith('--') && !values.has(i))
  if (!repo) {
    io.err(tr('eval.mineUsage'))
    return 2
  }
  const name =
    repo
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || 'repo'
  const out = flag(args, '--out') ?? join('eval', 'mined', name)
  const limit = flag(args, '--limit')
  try {
    const r = mineTasks({
      repo,
      out,
      since: flag(args, '--since'),
      limit: limit === undefined ? undefined : Number(limit),
      testCmd: flag(args, '--test-cmd'),
      setup: flag(args, '--setup'),
      onProgress: (l) => io.out(l),
    })
    const kept = r.filter((x) => x.kept).length
    io.out(tr('eval.mined', { kept, length: r.length, join: join(out, 'tasks'), join2: join(out, 'mine-report.md') }))
    return kept > 0 ? 0 : 1
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e))
    return 1
  }
}

export async function runEval(sub: string | undefined, args: readonly string[], io: Io): Promise<number> {
  switch (sub) {
    case 'record':
      return cmdRecord(args[0], io)
    case 'run':
      return cmdRun(args, io)
    case 'l2':
      return cmdL2(args, io)
    case 'mine':
      return cmdMine(args, io)
    case undefined:
    case 'help':
      io.out(EVAL_HELP())
      return 0
    default:
      io.err(tr('eval.unknownSub', { sub, EVAL_HELP: EVAL_HELP() }))
      return 2
  }
}
