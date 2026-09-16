/**
 * 后台命令 —— PRD-M7-001 AC-4 / AC-6 · SPEC-M7-001
 *
 * `shell.exec {background:true}` 立刻返回 jobId；`shell.output` 取增量输出（归 fs.read：只读已产生的输出），
 * `shell.kill` 杀进程组（归 shell.exec）。job 随会话关闭一起杀掉。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { JobStarter, Tool } from '../types.ts'
import { truncateOutput } from './shell-exec.ts'

/** 内存里最多留多少输出；更早的丢掉（全文在日志文件里） */
const JOB_MEMORY_BYTES = 4 * 1024 * 1024
const MAX_WAIT_MS = 30_000

interface Job {
  id: string
  cmd: string
  child: ChildProcess
  chunks: string[]
  /** chunks[0] 在全部输出里的起点（字节数按字符近似） */
  base: number
  size: number
  cursor: number
  exitCode: number | null
  running: boolean
  startedAt: number
  logFile?: string
  done: Promise<void>
}

export interface JobOutput {
  jobId: string
  cmd: string
  running: boolean
  exitCode: number | null
  output: string
  /** 内存里已经丢掉、没能返回的部分 */
  dropped?: number
  fullOutput?: string
  truncated?: { omittedBytes: number; totalBytes: number }
}

export class JobTable implements JobStarter {
  private readonly jobs = new Map<string, Job>()
  private seq = 0

  constructor(private readonly opts: { outputDir?: string } = {}) {}

  start(cmd: string, cwd: string): { jobId: string; logFile?: string } {
    const id = `job-${++this.seq}`
    const child = spawn('sh', ['-c', cmd], { cwd, detached: true })
    let logFile: string | undefined
    if (this.opts.outputDir) {
      mkdirSync(this.opts.outputDir, { recursive: true })
      logFile = join(this.opts.outputDir, `${id}-${Date.now()}.log`)
    }
    let resolveDone: () => void = () => {}
    const job: Job = {
      id,
      cmd,
      child,
      chunks: [],
      base: 0,
      size: 0,
      cursor: 0,
      exitCode: null,
      running: true,
      startedAt: Date.now(),
      ...(logFile === undefined ? {} : { logFile }),
      done: new Promise<void>((r) => {
        resolveDone = r
      }),
    }
    const onData = (c: Buffer): void => {
      const s = c.toString('utf8')
      job.chunks.push(s)
      job.size += s.length
      if (logFile) appendFileSync(logFile, s)
      while (job.size - job.base > JOB_MEMORY_BYTES && job.chunks.length > 1) {
        job.base += (job.chunks.shift() as string).length
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const finish = (code: number | null): void => {
      if (!job.running) return
      job.running = false
      job.exitCode = code
      resolveDone()
    }
    child.on('close', finish)
    child.on('error', (e) => {
      onData(Buffer.from(String(e)))
      finish(null)
    })
    this.jobs.set(id, job)
    return { jobId: id, ...(logFile === undefined ? {} : { logFile }) }
  }

  async output(jobId: string, waitMs = 0): Promise<JobOutput> {
    const job = this.get(jobId)
    if (job.running && waitMs > 0) {
      await Promise.race([job.done, new Promise((r) => setTimeout(r, Math.min(waitMs, MAX_WAIT_MS)))])
    }
    const all = job.chunks.join('')
    const from = Math.max(job.cursor, job.base)
    const dropped = from - job.cursor
    const text = all.slice(from - job.base)
    job.cursor = job.base + all.length
    const t = truncateOutput(text)
    return {
      jobId,
      cmd: job.cmd,
      running: job.running,
      exitCode: job.exitCode,
      output: t.text,
      ...(dropped > 0 ? { dropped } : {}),
      ...(job.logFile === undefined ? {} : { fullOutput: job.logFile }),
      ...(t.omitted > 0 ? { truncated: { omittedBytes: t.omitted, totalBytes: t.total } } : {}),
    }
  }

  /** 杀整个进程组，等它真的退出再返回 */
  async kill(jobId: string): Promise<{ jobId: string; killed: boolean; exitCode: number | null }> {
    const job = this.get(jobId)
    if (!job.running) return { jobId, killed: false, exitCode: job.exitCode }
    killGroup(job.child)
    await Promise.race([job.done, new Promise((r) => setTimeout(r, 5000))])
    return { jobId, killed: !job.running, exitCode: job.exitCode }
  }

  list(): Array<{ jobId: string; cmd: string; running: boolean; exitCode: number | null }> {
    return [...this.jobs.values()].map((j) => ({ jobId: j.id, cmd: j.cmd, running: j.running, exitCode: j.exitCode }))
  }

  killAll(): void {
    for (const j of this.jobs.values()) if (j.running) killGroup(j.child)
  }

  private get(jobId: string): Job {
    const job = this.jobs.get(jobId)
    if (!job) {
      const known = [...this.jobs.keys()]
      throw new Error(
        `没有 ${jobId} 这个后台任务。${known.length ? `现有：${known.join('、')}` : '本会话还没有后台任务。'}`,
      )
    }
    return job
  }
}

export function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 已经没了 */
    }
  }
}

export const ShellOutputArgs = z.object({
  jobId: z.string(),
  wait: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('还在跑时最多等多少毫秒再返回'),
})

export function makeShellOutputTool(jobs: JobTable): Tool<z.infer<typeof ShellOutputArgs>, JobOutput> {
  return {
    name: 'shell.output',
    capability: 'fs.read',
    description:
      '读取后台命令（shell.exec background:true 启动的）自上次读取以来的新输出，以及它是否还在运行、退出码。',
    schema: ShellOutputArgs,
    execute: (args) => jobs.output(args.jobId, args.wait ?? 0),
  }
}

export const ShellKillArgs = z.object({ jobId: z.string() })

export function makeShellKillTool(
  jobs: JobTable,
): Tool<z.infer<typeof ShellKillArgs>, { jobId: string; killed: boolean; exitCode: number | null }> {
  return {
    name: 'shell.kill',
    capability: 'shell.exec',
    description: '终止一个后台命令（连同它启动的子进程）。',
    schema: ShellKillArgs,
    execute: (args) => jobs.kill(args.jobId),
  }
}
