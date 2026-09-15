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
import { SqliteEventLog } from '@domi/store'
import { type Fixture, parse, record, serialize } from './fixture.ts'
import { formatL2Report, L2_DIR, loadL2Tasks, runL2 } from './l2.ts'
import { formatResult, replay } from './replay.ts'

export interface Io {
  out(s: string): void
  err(s: string): void
}

/** fixture 默认落在仓库里，跟着代码一起进版本库 —— 它是测试资产，不是用户数据 */
export const FIXTURE_DIR = join('fixtures', 'sessions')

export const EVAL_HELP = `domi eval —— L1 确定性轨迹回放（不联网、不花钱）

  domi eval record <sessionId>   把一条真实会话导出成 fixture
  domi eval run [fixture...]     回放 fixture，断言工具调用序列与录制一致
  domi eval l2 [题 id...] [--rounds N]
                                 L2：用真实模型跑 eval/l2 的题集（花钱、不进 CI），默认 3 轮

fixture 默认读写 ${FIXTURE_DIR}/ 。回放全程不发出任何网络请求。`

function dbPath(): string {
  return join(homedir(), '.domi', 'events.db')
}

async function cmdRecord(sessionId: string | undefined, io: Io): Promise<number> {
  if (!sessionId) {
    io.err('用法：domi eval record <sessionId>\n（会话 id 用 `domi session list` 看）')
    return 2
  }
  const log = new SqliteEventLog({ path: dbPath() })
  try {
    const events = await log.read(sessionId)
    if (events.length === 0) {
      io.err(`会话 ${sessionId} 没有任何事件。用 \`domi session list\` 确认 id。`)
      return 1
    }
    const fixture = record(events, sessionId)
    mkdirSync(FIXTURE_DIR, { recursive: true })
    const out = join(FIXTURE_DIR, `${sessionId}.json`)
    writeFileSync(out, serialize(fixture), 'utf8')
    io.out(
      `已录制 ${out}\n` +
        `  ${events.length} 条事件 → ${fixture.turns.length} 轮、${fixture.expectedCalls.length} 次工具调用`,
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
      io.err(`跳过 ${p}：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

async function cmdRun(paths: readonly string[], io: Io): Promise<number> {
  const loaded = loadFixtures(paths, io)
  if (loaded.length === 0) {
    io.err(`${FIXTURE_DIR}/ 下没有 fixture。先跑一次 \`domi eval record <sessionId>\`。`)
    return 1
  }

  let failed = 0
  for (const { fixture } of loaded) {
    const r = await replay(fixture)
    io.out(formatResult(r))
    if (!r.ok) failed++
  }
  io.out(`\n${loaded.length - failed}/${loaded.length} 通过`)
  return failed === 0 ? 0 : 1
}

/**
 * L2 的接线（INV-08-LIVE：会发真实模型请求，check-ci-no-live-calls 据此确认 CI 不跑它）。
 * 每题一个临时工作区、一个临时事件库；权限只放行题目声明的能力
 */
async function cmdL2(args: readonly string[], io: Io): Promise<number> {
  const roundsArg = args.indexOf('--rounds')
  const rounds = roundsArg >= 0 ? Number(args[roundsArg + 1]) : 3
  const only = args.filter((a, i) => !a.startsWith('--') && (roundsArg < 0 || i !== roundsArg + 1))
  const tasks = loadL2Tasks(undefined, only)
  if (tasks.length === 0) {
    io.err('eval/l2/tasks 下没有题（或者给的题 id 都不存在）')
    return 1
  }
  const { loadConfigOrThrow, ConfigSchema } = await import('@domi/config')
  const { DomiSession } = await import('@domi/runtime')
  const base = loadConfigOrThrow({ home: process.env.HOME || homedir() })
  io.out(`L2：${tasks.length} 题 × ${rounds} 轮，模型 ${base.model.provider}/${base.model.name}。这会产生真实费用。`)
  const report = await runL2(tasks, {
    rounds,
    model: `${base.model.provider}/${base.model.name}`,
    pricing: L2_PRICING,
    onProgress: (a) => io.out(`  ${a.pass ? '✅' : '❌'} ${a.taskId} 第 ${a.round} 轮（${(a.ms / 1000).toFixed(1)}s）`),
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
  io.out(`\n${formatL2Report(report).split('\n').slice(0, 6).join('\n')}\n\n报告：${join(dir, `${stamp}.md`)}`)
  return 0
}

/** 与 trace 同一份口径：没有的模型显示 —，不当成免费 */
const L2_PRICING = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1 },
}

export async function runEval(sub: string | undefined, args: readonly string[], io: Io): Promise<number> {
  switch (sub) {
    case 'record':
      return cmdRecord(args[0], io)
    case 'run':
      return cmdRun(args, io)
    case 'l2':
      return cmdL2(args, io)
    case undefined:
    case 'help':
      io.out(EVAL_HELP)
      return 0
    default:
      io.err(`未知子命令：eval ${sub}\n${EVAL_HELP}`)
      return 2
  }
}
