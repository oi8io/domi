/**
 * 沙箱 —— PRD-M6-003 · docs/adr/023
 *
 * 一次工具调用 = 一个沙箱里的子进程。沙箱里没有网络、看不到用户文件、没有环境变量；
 * 插件要读写文件、发请求，都经 stdio 请宿主代做（HostApi），宿主按安装时的权限快照核对。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RUNNER_SOURCE } from './runner-source.ts'

export type SandboxBackend = 'bwrap' | 'sandbox-exec' | 'none'

let detected: SandboxBackend | null = null

/** 这台机器能用哪种沙箱。bwrap 要真跑一次：有的内核关了非特权 user namespace */
export function detectSandbox(platform: NodeJS.Platform = process.platform): SandboxBackend {
  if (detected !== null && platform === process.platform) return detected
  let found: SandboxBackend = 'none'
  if (platform === 'linux') {
    const r = spawnSync('bwrap', ['--unshare-all', '--ro-bind', '/', '/', 'true'], { stdio: 'ignore', timeout: 5000 })
    if (r.status === 0) found = 'bwrap'
  } else if (platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    found = 'sandbox-exec'
  }
  if (platform === process.platform) detected = found
  return found
}

/** 运行 runner 用的可执行文件。单二进制里就是 domi 自己（配合 BUN_BE_BUN=1） */
export function bunExecutable(): string {
  return process.execPath
}

export function ensureRunner(runtimeDir: string): string {
  mkdirSync(runtimeDir, { recursive: true })
  const path = join(runtimeDir, 'runner.mjs')
  writeFileSync(path, RUNNER_SOURCE, 'utf8')
  return path
}

export interface SandboxSpec {
  backend: SandboxBackend
  bun: string
  pluginDir: string
  runnerPath: string
}

/** 沙箱里的路径：Linux 下重映射到固定位置，macOS 下原样 */
export function insidePaths(spec: SandboxSpec): { pluginDir: string; runner: string } {
  return spec.backend === 'bwrap'
    ? { pluginDir: '/plugin', runner: '/runtime/runner.mjs' }
    : { pluginDir: spec.pluginDir, runner: spec.runnerPath }
}

function sbString(s: string): string {
  return JSON.stringify(s)
}

/** macOS 的 sandbox-exec profile（未在真机验证，见 ADR-023） */
export function darwinProfile(spec: SandboxSpec, tmp: string): string {
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork signal sysctl-read mach-lookup)',
    '(allow file-read-metadata)',
    `(allow file-read* (literal "/") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/System") (subpath "/Library/Apple") (subpath "/private/var/db/dyld") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (subpath ${sbString(dirname(spec.bun))}) (subpath ${sbString(spec.pluginDir)}) (subpath ${sbString(dirname(spec.runnerPath))}) (subpath ${sbString(tmp)}))`,
    `(allow file-write* (literal "/dev/null") (subpath ${sbString(tmp)}))`,
    '(deny network*)',
  ].join('\n')
}

/** 组装命令行。backend 为 none 时直接跑（只有用户显式允许时才会走到这里） */
export function sandboxCommand(
  spec: SandboxSpec,
  tmp: string,
): { cmd: string; args: string[]; env: Record<string, string> } {
  const inside = insidePaths(spec)
  const env = {
    HOME: spec.backend === 'bwrap' ? '/tmp' : tmp,
    TMPDIR: spec.backend === 'bwrap' ? '/tmp' : tmp,
    BUN_BE_BUN: '1',
    NO_COLOR: '1',
  }
  if (spec.backend === 'bwrap') {
    const bunDir = dirname(spec.bun)
    const args = [
      '--unshare-all',
      '--die-with-parent',
      '--new-session',
      '--clearenv',
      ...Object.entries(env).flatMap(([k, v]) => ['--setenv', k, v]),
      '--ro-bind-try',
      '/lib',
      '/lib',
      '--ro-bind-try',
      '/lib64',
      '/lib64',
      '--ro-bind-try',
      '/usr/lib',
      '/usr/lib',
      '--ro-bind-try',
      '/usr/lib64',
      '/usr/lib64',
      '--ro-bind',
      bunDir,
      bunDir,
      '--ro-bind',
      spec.pluginDir,
      inside.pluginDir,
      '--ro-bind',
      spec.runnerPath,
      inside.runner,
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--chdir',
      inside.pluginDir,
      spec.bun,
      inside.runner,
    ]
    return { cmd: 'bwrap', args, env: {} }
  }
  if (spec.backend === 'sandbox-exec') {
    return { cmd: '/usr/bin/sandbox-exec', args: ['-p', darwinProfile(spec, tmp), spec.bun, inside.runner], env }
  }
  return { cmd: spec.bun, args: [inside.runner], env: { ...env, PATH: process.env.PATH ?? '' } }
}

/** 插件代码能用的宿主调用（ctx 上的方法）。改它就是改插件 API，快照里看得见 */
export const HOST_CALLS = ['readFile', 'writeFile', 'fetch', 'log'] as const

/** 宿主代理的四个调用。实现方负责核对权限，拒绝时抛错（错误文字会原样交给插件） */
export interface HostApi {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  fetch(req: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    status: number
    headers: Record<string, string>
    text: string
  }>
  log(message: string): Promise<void>
}

export interface SandboxResult {
  ok: boolean
  payload?: unknown
  error?: string
  /** 进程级的故障（崩溃、超时、协议错乱），要落 plugin.error */
  crashed?: boolean
  timedOut?: boolean
  stderr: string
  pid?: number
}

const MAX_OUTPUT = 1024 * 1024

export async function runSandboxed(
  spec: SandboxSpec,
  start: { entry: string; args: unknown; cwd: string },
  host: HostApi,
  opts: { timeoutMs: number; signal?: AbortSignal; tmpDir: string },
): Promise<SandboxResult> {
  mkdirSync(opts.tmpDir, { recursive: true })
  const { cmd, args, env } = sandboxCommand(spec, opts.tmpDir)
  const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  const inside = insidePaths(spec)
  let stderr = ''
  let buf = ''
  let settled = false
  let result: SandboxResult | null = null
  let outBytes = 0

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(-1))
  })
  const kill = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  const reply = (msg: unknown): void => {
    if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  const handle = async (msg: {
    t?: string
    id?: number
    op?: string
    params?: Record<string, unknown>
  }): Promise<void> => {
    if (msg.t === 'result') {
      const m = msg as { ok?: boolean; payload?: unknown; error?: string }
      result = m.ok
        ? { ok: true, payload: m.payload, stderr: '' }
        : { ok: false, error: String(m.error ?? '插件报错'), stderr: '' }
      return
    }
    if (msg.t !== 'call' || typeof msg.id !== 'number') throw new Error('插件发来了看不懂的消息')
    const p = msg.params ?? {}
    try {
      let value: unknown = null
      if (msg.op === 'readFile') value = await host.readFile(String(p.path))
      else if (msg.op === 'writeFile') await host.writeFile(String(p.path), String(p.content ?? ''))
      else if (msg.op === 'fetch') {
        value = await host.fetch({
          url: String(p.url),
          ...(typeof p.method === 'string' ? { method: p.method } : {}),
          ...(p.headers && typeof p.headers === 'object' ? { headers: p.headers as Record<string, string> } : {}),
          ...(typeof p.body === 'string' ? { body: p.body } : {}),
        })
      } else if (msg.op === 'log') await host.log(String(p.message ?? ''))
      else throw new Error(`没有这个宿主调用：${msg.op}`)
      reply({ t: 'reply', id: msg.id, ok: true, value })
    } catch (e) {
      reply({ t: 'reply', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  child.stderr.on('data', (c: Buffer) => {
    if (stderr.length < 16_000) stderr += c.toString('utf8')
  })
  child.stdout.on('data', (c: Buffer) => {
    outBytes += c.length
    if (outBytes > MAX_OUTPUT) {
      result = { ok: false, error: `插件输出超过 ${MAX_OUTPUT} 字节`, crashed: true, stderr }
      kill()
      return
    }
    buf += c.toString('utf8')
    let i = buf.indexOf('\n')
    while (i >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
      if (line.trim() === '') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        result = { ok: false, error: '插件输出不是协议消息', crashed: true, stderr }
        kill()
        return
      }
      void handle(parsed as never).catch((e) => {
        result = { ok: false, error: String(e instanceof Error ? e.message : e), crashed: true, stderr }
        kill()
      })
    }
  })

  const timer = setTimeout(() => {
    if (settled) return
    result = { ok: false, error: `插件执行超过 ${opts.timeoutMs}ms，已强制终止`, crashed: true, timedOut: true, stderr }
    kill()
  }, opts.timeoutMs)
  const onAbort = (): void => {
    result = { ok: false, error: '已取消', crashed: false, stderr }
    kill()
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  reply({
    t: 'start',
    entry: join(inside.pluginDir, start.entry),
    args: start.args,
    cwd: start.cwd,
  })

  const code = await exited
  settled = true
  clearTimeout(timer)
  opts.signal?.removeEventListener('abort', onAbort)
  const pid = child.pid
  const final: SandboxResult =
    result ??
    ({
      ok: false,
      error: `插件进程退出（退出码 ${code}），没有给出结果${stderr ? `：${stderr.trim().split('\n').slice(-3).join(' / ')}` : ''}`,
      crashed: true,
      stderr,
    } satisfies SandboxResult)
  return { ...final, stderr, ...(pid === undefined ? {} : { pid }) }
}
