/**
 * 钩子 —— PRD-M7-003 · SPEC-M7-003 · ADR-025
 *
 * 用户在 ~/.domi/config.yaml 里写的命令，在工具调用前后、一轮结束后运行。
 * 以用户身份、在会话 cwd 下 `sh -c` 执行，不沙箱——它就是用户自己的工具链。
 * 超时强杀整个进程组，pre 钩子超时按拦截处理（fail-closed）。
 */
import { spawn } from 'node:child_process'
import type { ToolHooks } from '@domi/capability'
import type { DomiConfig } from '@domi/config'
import type { DomiEvent } from '@domi/protocol'

export type HookSpec = DomiConfig['hooks'][number]

/** 进事件与回给模型的钩子输出上限 */
export const HOOK_OUTPUT_MAX = 4000

export interface HookRun {
  exitCode: number | null
  output: string
  timedOut: boolean
  ms: number
}

/** 能力 id 匹配：`*` 全部；精确；`前缀.*` 按段匹配 */
export function hookMatches(pattern: string, capability: string): boolean {
  if (pattern === '*') return true
  if (pattern === capability) return true
  if (pattern.endsWith('.*')) return capability.startsWith(pattern.slice(0, -1))
  return false
}

function clip(s: string): string {
  const t = s.trim()
  return t.length > HOOK_OUTPUT_MAX ? `${t.slice(0, HOOK_OUTPUT_MAX)}\n…[已截断]` : t
}

export function runHookCommand(
  hook: Pick<HookSpec, 'run' | 'timeoutMs'>,
  opts: { cwd: string; env: Record<string, string>; stdin: string },
): Promise<HookRun> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', hook.run], {
      cwd: opts.cwd,
      detached: true,
      env: { ...process.env, ...opts.env },
    })
    let out = ''
    let timedOut = false
    let settled = false
    const onData = (c: Buffer): void => {
      if (out.length < HOOK_OUTPUT_MAX * 4) out += c.toString('utf8')
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.stdin.on('error', () => {
      /* 钩子没读 stdin 就退出了 */
    })
    child.stdin.end(opts.stdin)
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }, hook.timeoutMs)
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code, output: clip(out), timedOut, ms: Math.max(0, Date.now() - t0) })
    }
    child.on('close', (code) => finish(code))
    child.on('error', (e) => {
      out += String(e)
      finish(null)
    })
  })
}

export class HookRunner {
  constructor(
    private readonly hooks: readonly HookSpec[],
    private readonly ctx: { sessionId: string; cwd: string },
  ) {}

  get empty(): boolean {
    return this.hooks.length === 0
  }

  private env(on: string, call?: { name: string; capability: string; args: unknown }): Record<string, string> {
    const env: Record<string, string> = {
      DOMI_HOOK: on,
      DOMI_SESSION: this.ctx.sessionId,
      DOMI_CWD: this.ctx.cwd,
    }
    if (call) {
      env.DOMI_TOOL = call.name
      env.DOMI_CAPABILITY = call.capability
      const a = call.args as { path?: unknown; cmd?: unknown } | null
      if (a && typeof a.path === 'string') env.DOMI_PATH = a.path
      if (a && typeof a.cmd === 'string') env.DOMI_CMD = a.cmd
    }
    return env
  }

  private event(h: HookSpec, r: HookRun, blocked: boolean, capabilityId?: string): DomiEvent {
    return {
      t: 'hook.run',
      name: h.name,
      on: h.on,
      ...(capabilityId === undefined ? {} : { capabilityId }),
      ms: r.ms,
      exitCode: r.exitCode,
      blocked,
      timedOut: r.timedOut,
      ...(r.output === '' ? {} : { output: r.output }),
    }
  }

  /** 给 ToolRegistry 的端口 */
  toolHooks(): ToolHooks {
    return {
      pre: async (call) => {
        const events: DomiEvent[] = []
        for (const h of this.hooks) {
          if (h.on !== 'pre' || !hookMatches(h.match, call.capability)) continue
          const r = await runHookCommand(h, {
            cwd: this.ctx.cwd,
            env: this.env('pre', call),
            stdin: JSON.stringify({ tool: call.name, capability: call.capability, args: call.args }),
          })
          const blocked = r.timedOut || r.exitCode !== 0
          events.push(this.event(h, r, blocked, call.capability))
          if (blocked) {
            const why = r.timedOut
              ? `钩子 ${h.name} 超时（${h.timeoutMs}ms），按拦截处理`
              : `钩子 ${h.name} 拦下了这次调用`
            return { block: true, reason: r.output === '' ? why : `${why}：\n${r.output}`, events }
          }
        }
        return { block: false, events }
      },
      post: async (call, result) => {
        const events: DomiEvent[] = []
        const notes: Array<{ hook: string; exitCode: number | null; output: string }> = []
        for (const h of this.hooks) {
          if (h.on !== 'post' || !hookMatches(h.match, call.capability)) continue
          const r = await runHookCommand(h, {
            cwd: this.ctx.cwd,
            env: this.env('post', call),
            stdin: JSON.stringify({ tool: call.name, capability: call.capability, args: call.args, result }),
          })
          events.push(this.event(h, r, false, call.capability))
          if (r.output !== '' || r.exitCode !== 0 || r.timedOut) {
            notes.push({
              hook: h.name,
              exitCode: r.exitCode,
              output: r.timedOut ? `（超时，已终止）${r.output}` : r.output,
            })
          }
        }
        return { events, notes }
      },
    }
  }

  /** 一轮结束后的钩子。只记录 */
  async stop(): Promise<DomiEvent[]> {
    const events: DomiEvent[] = []
    for (const h of this.hooks) {
      if (h.on !== 'stop') continue
      const r = await runHookCommand(h, { cwd: this.ctx.cwd, env: this.env('stop'), stdin: '{}' })
      events.push(this.event(h, r, false))
    }
    return events
  }
}
