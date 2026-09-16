/**
 * L2 端到端评估 —— PRD-M6-005 · docs/spec/M6.md SPEC-M6-005
 *
 * L1 证明「没改坏」，L2 证明「真能干活」。L2 要花真钱、结果不确定，所以**只进 nightly / 手动**（INV-08）。
 *
 * 一题 = 一个目录：task.yaml（提示与允许的能力）+ workspace/（初始文件）+ check.ts（判据，退出码 0 = 通过）。
 * 每次都复制到新的临时目录跑，题与题、次与次之间没有残留（AC-2）。
 * harness 不认识模型：怎么跑一轮由调用方注入（CLI 用真实的 runtime，测试用替身）。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { aggregate, type PricingTable } from '@domi/kernel'
import type { EventEnvelope } from '@domi/protocol'
import { z } from 'zod'
import { record, serialize } from './fixture.ts'

export const L2_DIR = join('eval', 'l2')

export const L2TaskSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string(),
    prompt: z.string().min(1),
    /** 这一题放行哪些能力（工作区是临时目录，放行是安全的） */
    allow: z.array(z.string()).default(['fs.read', 'fs.write', 'shell.exec']),
    timeoutMs: z.number().int().positive().default(180_000),
    /** 模型开始之前在工作区里跑的准备命令（装依赖）。git 历史出的题会带（PRD-M7-008） */
    setup: z.string().optional(),
    /** 题目出处（git 历史出的题） */
    source: z.object({ repo: z.string(), commit: z.string(), parent: z.string() }).optional(),
  })
  .strict()
export type L2Task = z.infer<typeof L2TaskSchema> & { dir: string }

export function loadL2Tasks(root = join(L2_DIR, 'tasks'), only?: readonly string[]): L2Task[] {
  if (!existsSync(root)) return []
  const out: L2Task[] = []
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id)
    const file = join(dir, 'task.yaml')
    if (!existsSync(file)) continue
    const t = L2TaskSchema.parse(Bun.YAML.parse(readFileSync(file, 'utf8')))
    if (t.id !== id) throw new Error(`${file} 的 id（${t.id}）和目录名不一致`)
    if (!existsSync(join(dir, 'check.ts'))) throw new Error(`${id} 缺少 check.ts`)
    if (only && only.length > 0 && !only.includes(id)) continue
    // 判据脚本在临时工作区里跑，路径必须是绝对的
    out.push({ ...t, dir: resolve(dir) })
  }
  return out
}

/** 跑一轮对话：在 workspace 里、用给定的事件库。返回这次会话的全部事件 */
export type L2Runner = (input: {
  task: L2Task
  workspace: string
  dbPath: string
  sessionId: string
  signal: AbortSignal
}) => Promise<readonly EventEnvelope[]>

export interface L2Attempt {
  taskId: string
  round: number
  pass: boolean
  /** 判据脚本的输出（失败时看这个） */
  checkOutput: string
  tokens: { input: number; output: number; cacheRead: number }
  costUsd: number | null
  ms: number
  toolCalls: number
  /** 失败题落下的 L1 fixture（AC-6） */
  fixture?: string
  error?: string
}

export interface L2Report {
  startedAt: number
  model: string
  rounds: number
  attempts: L2Attempt[]
  /** 每一轮的通过率 */
  passRates: number[]
  interval: { min: number; max: number }
  /** 区间宽度 > 20%（AC-5） */
  lowDiscrimination: boolean
  totalCostUsd: number | null
}

export interface L2Options {
  run: L2Runner
  rounds?: number
  model: string
  pricing?: PricingTable
  /** 失败题的 fixture 写到哪（默认 fixtures/sessions/l2-failed） */
  fixtureDir?: string
  now?: () => number
  /** 判据脚本用哪个 bun 跑 */
  bun?: string
  onProgress?: (a: L2Attempt) => void
}

function checkTask(task: L2Task, workspace: string, bun: string): { pass: boolean; output: string } {
  const r = Bun.spawnSync([bun, join(task.dir, 'check.ts')], {
    cwd: workspace,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: workspace, NO_COLOR: '1' },
    timeout: Math.min(task.timeoutMs, 600_000),
  })
  const output = `${new TextDecoder().decode(r.stdout)}${new TextDecoder().decode(r.stderr)}`.trim().slice(-2000)
  return { pass: r.exitCode === 0, output }
}

export async function runOne(task: L2Task, round: number, opts: L2Options): Promise<L2Attempt> {
  const now = opts.now ?? Date.now
  const base = mkdtempSync(join(tmpdir(), `domi-l2-${task.id}-`))
  const workspace = join(base, 'ws')
  mkdirSync(workspace, { recursive: true })
  if (existsSync(join(task.dir, 'workspace'))) cpSync(join(task.dir, 'workspace'), workspace, { recursive: true })
  const sessionId = `l2-${task.id}-${round}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), task.timeoutMs)
  const t0 = now()
  let events: readonly EventEnvelope[] = []
  let error: string | undefined
  if (task.setup) {
    const s = Bun.spawnSync(['sh', '-c', task.setup], {
      cwd: workspace,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 600_000,
    })
    if (s.exitCode !== 0)
      error = `准备命令失败（${task.setup}）：${new TextDecoder().decode(s.stderr).trim().slice(-500)}`
  }
  try {
    if (error !== undefined) throw new Error(error)
    events = await opts.run({ task, workspace, dbPath: join(base, 'events.db'), sessionId, signal: ac.signal })
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timer)
  }
  const ms = Math.max(0, now() - t0)
  const check =
    error === undefined ? checkTask(task, workspace, opts.bun ?? process.execPath) : { pass: false, output: '' }
  const m = aggregate(events, { pricing: opts.pricing ?? {} })
  const attempt: L2Attempt = {
    taskId: task.id,
    round,
    pass: check.pass,
    checkOutput: check.output,
    tokens: m.tokens,
    costUsd: m.costUsd,
    ms,
    toolCalls: m.toolCalls,
    ...(error === undefined ? {} : { error }),
  }
  if (!attempt.pass && events.length > 0) {
    const dir = opts.fixtureDir ?? join('fixtures', 'sessions', 'l2-failed')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${sessionId}-${t0}.json`)
    writeFileSync(path, serialize(record([...events], sessionId)), 'utf8')
    attempt.fixture = path
  }
  rmSync(base, { recursive: true, force: true })
  return attempt
}

export async function runL2(tasks: readonly L2Task[], opts: L2Options): Promise<L2Report> {
  const rounds = opts.rounds ?? 3
  const startedAt = (opts.now ?? Date.now)()
  const attempts: L2Attempt[] = []
  for (let round = 1; round <= rounds; round++) {
    for (const t of tasks) {
      const a = await runOne(t, round, opts)
      attempts.push(a)
      opts.onProgress?.(a)
    }
  }
  const passRates = Array.from({ length: rounds }, (_, i) => {
    const inRound = attempts.filter((a) => a.round === i + 1)
    return inRound.length === 0 ? 0 : inRound.filter((a) => a.pass).length / inRound.length
  })
  const min = Math.min(...passRates)
  const max = Math.max(...passRates)
  const priced = attempts.filter((a) => a.costUsd !== null)
  return {
    startedAt,
    model: opts.model,
    rounds,
    attempts,
    passRates,
    interval: { min, max },
    lowDiscrimination: max - min > 0.2,
    totalCostUsd: priced.length === 0 ? null : priced.reduce((s, a) => s + (a.costUsd ?? 0), 0),
  }
}

const pct = (x: number): string => `${Math.round(x * 100)}%`

export function formatL2Report(r: L2Report): string {
  const lines = [
    `# L2 报告 · ${new Date(r.startedAt).toISOString()}`,
    '',
    `模型：${r.model} · ${r.rounds} 轮 · ${new Set(r.attempts.map((a) => a.taskId)).size} 题`,
    `通过率：${r.passRates.map(pct).join(' / ')}（区间 ${pct(r.interval.min)}–${pct(r.interval.max)}）`,
    r.lowDiscrimination ? '⚠ 区间宽度超过 20%：这套题集判别力不足，单次结果不足以比较模型或改动' : '',
    `总花费：${r.totalCostUsd === null ? '—（价目表里没有这个模型）' : `$${r.totalCostUsd.toFixed(4)}`}`,
    '',
    '| 题 | 轮 | 结果 | tokens（入/出） | 金额 | 耗时 | 工具调用 | 失败轨迹 |',
    '|---|---|---|---|---|---|---|---|',
    ...r.attempts.map(
      (a) =>
        `| ${a.taskId} | ${a.round} | ${a.pass ? '✅' : '❌'} | ${a.tokens.input}/${a.tokens.output} | ${
          a.costUsd === null ? '—' : `$${a.costUsd.toFixed(4)}`
        } | ${(a.ms / 1000).toFixed(1)}s | ${a.toolCalls} | ${a.fixture ?? ''} |`,
    ),
  ]
  const failed = r.attempts.filter((a) => !a.pass)
  if (failed.length > 0) {
    lines.push('', '## 失败详情', '')
    for (const a of failed) {
      lines.push(
        `### ${a.taskId} · 第 ${a.round} 轮`,
        '',
        '```',
        (a.error ?? a.checkOutput) || '（判据脚本没有输出）',
        '```',
        '',
      )
    }
  }
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n')
}
