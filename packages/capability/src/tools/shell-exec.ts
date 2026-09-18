import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Tool } from '../types.ts'

export const SHELL_DEFAULT_TIMEOUT_MS = 120_000
export const SHELL_MAX_OUTPUT_BYTES = 100 * 1024
const KEEP_HEAD_BYTES = 20 * 1024
const KEEP_TAIL_BYTES = 20 * 1024

export const ShellExecArgs = z.object({
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  background: z
    .boolean()
    .optional()
    .describe('后台运行：立刻返回 jobId，之后用 shell.output 看输出、shell.kill 终止。适合开发服务器、长时间的构建'),
})
export type ShellExecArgs = z.infer<typeof ShellExecArgs>

export interface ShellExecResult {
  cmd: string
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  truncated?: { omittedBytes: number; totalBytes: number }
  /** 输出被截断时，全文所在的文件（可以用 fs.read 读） */
  fullOutput?: string
  /** 后台运行时：job id（exitCode 为 null、输出为空，之后用 shell.output 取） */
  jobId?: string
  background?: true
}

/**
 * 头尾各留一段，中间标明省了多少字节。
 * 只留头部会丢掉报错（错误通常在末尾），只留尾部会丢掉命令上下文——两头都要。
 */
export function truncateOutput(s: string): { text: string; omitted: number; total: number } {
  const buf = Buffer.from(s, 'utf8')
  if (buf.byteLength <= SHELL_MAX_OUTPUT_BYTES) return { text: s, omitted: 0, total: buf.byteLength }
  const omitted = buf.byteLength - KEEP_HEAD_BYTES - KEEP_TAIL_BYTES
  const head = buf.subarray(0, KEEP_HEAD_BYTES).toString('utf8')
  const tail = buf.subarray(buf.byteLength - KEEP_TAIL_BYTES).toString('utf8')
  const middle = buf.subarray(KEEP_HEAD_BYTES, buf.byteLength - KEEP_TAIL_BYTES).toString('utf8')
  const keys = keyLines(middle)
  const picked =
    keys.length === 0
      ? ''
      : `\n… [省略的部分里像失败 / 报错的行，按原顺序摘出 ${keys.length} 行（全文见 fullOutput）] …\n${keys.join('\n')}`
  return {
    text: `${head}\n… [已省略 ${omitted} 字节，共 ${buf.byteLength} 字节] …${picked}\n${tail}`,
    omitted,
    total: buf.byteLength,
  }
}

/**
 * 省略掉的中段里像「失败的测试名 / 报错 / 报错位置」的行（BUG-M7-003 · PRD-M7-004 AC-4）。
 * 测试跑得长时，失败往往在中间：只留头尾就把最要紧的两样——哪个测试挂了、挂在哪一行——一起丢了
 */
const KEY_LINE = [
  /\bFAIL(?:ED|URE)?\b|\(fail\)|✗|✕|×|\bpanicked\b|^Traceback|AssertionError/,
  /^\s*(?:error|Error|ERROR)\b|\berror(?:\[\w+\])?:|^\s*E\s{2,}/,
  /^\s+at\s.+:\d+(?::\d+)?\)?$|^\s*-->\s*\S+:\d+|^\s*File "[^"]+", line \d+|\S+\.\w{1,5}:\d+:\d+/,
]
const KEY_MAX_LINES = 40
const KEY_MAX_CHARS = 300

export function keyLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    // 只看每行开头一段：超长的单行（压缩过的 JS、进度条）上跑 \S+ 类的正则是平方级的
    const probe = line.length > 1000 ? line.slice(0, 1000) : line
    if (!KEY_LINE.some((re) => re.test(probe))) continue
    out.push(line.length > KEY_MAX_CHARS ? `${line.slice(0, KEY_MAX_CHARS)}…` : line)
    if (out.length >= KEY_MAX_LINES) break
  }
  return out
}

export const shellExec: Tool<ShellExecArgs, ShellExecResult> = {
  name: 'shell.exec',
  capability: 'shell.exec',
  description:
    '在工作目录内执行 shell 命令。默认 120 秒超时，超时会杀掉整个进程组。输出超过 100KB 时只返回头尾，全文落盘。' +
    '长时间运行的命令用 background: true。找文件、搜代码请用 fs.glob / fs.grep。',
  schema: ShellExecArgs,
  execute(args, ctx) {
    if (args.background) {
      if (!ctx.jobs) return Promise.reject(new Error('这个环境不支持后台命令'))
      const { jobId, logFile } = ctx.jobs.start(args.cmd, ctx.cwd)
      return Promise.resolve({
        cmd: args.cmd,
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        jobId,
        background: true as const,
        ...(logFile === undefined ? {} : { fullOutput: logFile }),
      })
    }
    const timeoutMs = args.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS
    return new Promise<ShellExecResult>((resolve) => {
      // detached：让子进程自成进程组，超时时才能用 kill(-pid) 连孙子进程一起杀。
      // 不这么做的话，杀掉 sh 会留下一个仍在跑的 sleep/npm，用户看不见也停不掉。
      const child = spawn('sh', ['-c', args.cmd], { cwd: ctx.cwd, detached: true })
      let out = ''
      let err = ''
      let timedOut = false
      let settled = false

      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf8')
      })
      child.stderr.on('data', (c: Buffer) => {
        err += c.toString('utf8')
      })

      const killGroup = (): void => {
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

      const timer = setTimeout(() => {
        timedOut = true
        killGroup()
      }, timeoutMs)

      const onAbort = (): void => {
        killGroup()
      }
      ctx.signal.addEventListener('abort', onAbort, { once: true })

      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ctx.signal.removeEventListener('abort', onAbort)
        const o = truncateOutput(out)
        const e = truncateOutput(err)
        const omitted = o.omitted + e.omitted
        const res: ShellExecResult = {
          cmd: args.cmd,
          exitCode,
          timedOut,
          stdout: o.text,
          stderr: e.text,
        }
        if (omitted === 0) {
          resolve(res)
          return
        }
        let fullOutput: string | undefined
        if (ctx.outputDir) {
          try {
            mkdirSync(ctx.outputDir, { recursive: true })
            fullOutput = join(ctx.outputDir, `${(ctx.callId ?? `call-${Date.now()}`).replace(/[^\w.-]/g, '_')}.log`)
            writeFileSync(fullOutput, `$ ${args.cmd}\n--- stdout ---\n${out}\n--- stderr ---\n${err}\n`)
          } catch {
            fullOutput = undefined
          }
        }
        resolve({
          ...res,
          truncated: { omittedBytes: omitted, totalBytes: o.total + e.total },
          ...(fullOutput === undefined ? {} : { fullOutput }),
        })
      }

      child.on('close', (code) => finish(code))
      child.on('error', (e) => {
        err += String(e)
        finish(null)
      })
    })
  },
}
