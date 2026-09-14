import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { Tool } from '../types.ts'

export const SHELL_DEFAULT_TIMEOUT_MS = 120_000
export const SHELL_MAX_OUTPUT_BYTES = 100 * 1024
const KEEP_HEAD_BYTES = 20 * 1024
const KEEP_TAIL_BYTES = 20 * 1024

export const ShellExecArgs = z.object({
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional(),
})
export type ShellExecArgs = z.infer<typeof ShellExecArgs>

export interface ShellExecResult {
  cmd: string
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  truncated?: { omittedBytes: number; totalBytes: number }
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
  return {
    text: `${head}\n… [已省略 ${omitted} 字节，共 ${buf.byteLength} 字节] …\n${tail}`,
    omitted,
    total: buf.byteLength,
  }
}

export const shellExec: Tool<ShellExecArgs, ShellExecResult> = {
  name: 'shell.exec',
  capability: 'shell.exec',
  description: '在工作目录内执行 shell 命令。默认 120 秒超时，超时会杀掉整个进程组。',
  schema: ShellExecArgs,
  execute(args, ctx) {
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
        resolve(omitted > 0 ? { ...res, truncated: { omittedBytes: omitted, totalBytes: o.total + e.total } } : res)
      }

      child.on('close', (code) => finish(code))
      child.on('error', (e) => {
        err += String(e)
        finish(null)
      })
    })
  },
}
