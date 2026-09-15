/**
 * 按需拉起 domid —— PRD-M3-002 AC-4：`domi` 在 daemon 未运行时自动拉起，并发调用只拉起一个实例
 *
 * 客户端（TUI）不自己判断「该不该起」，只做三步：
 *   1. 看锁：持锁进程活着、端口在听 → 直接连
 *   2. 否则拉起一个**脱离终端**的 domid（关掉终端它照样跑——这是 M3 DoD 的前提）
 *   3. 轮询锁直到有人在听。拉起的那个抢输了也没关系：连赢的那个就行
 *
 * 「只起一个」不靠这里保证，靠 domid 自己的 O_EXCL 锁（lock.ts）。
 * 这里并发调用会各自拉起一个进程，输的那些以 EXIT_LOCK_HELD 退出。
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { isAlive, readLock } from './lock.ts'
import { EXIT_LOCK_HELD } from './main.ts'
import { DEFAULT_HOSTNAME } from './transport-ws.ts'

/** 同一个可执行文件靠这个环境变量切到 daemon 角色（不加子命令，见 docs/adr/008） */
export const DAEMON_ROLE_ENV = 'DOMI_INTERNAL_ROLE'

export function daemonPaths(home: string): { dir: string; lock: string; log: string } {
  const dir = join(home, '.domi')
  return { dir, lock: join(dir, 'domid.lock'), log: join(dir, 'logs', 'domid.log') }
}

export interface DaemonEndpoint {
  url: string
  pid: number
  /** 这次调用拉起的进程就是赢家 */
  spawned: boolean
}

export class DaemonStartError extends Error {
  constructor(
    readonly logPath: string,
    reason: string,
  ) {
    super(`domid 没能起来（${reason}）。日志：${logPath}\n${tail(logPath)}`)
    this.name = 'DaemonStartError'
  }
}

function tail(path: string, lines = 15): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
}

const WILDCARD = new Set(['', '0.0.0.0', '::', '[::]'])

/** 本机客户端该连哪个地址：监听的是通配地址就走回环，否则就是那个地址 */
export function localConnectHost(listenHost: string | undefined): string {
  if (listenHost === undefined || WILDCARD.has(listenHost)) return DEFAULT_HOSTNAME
  return listenHost.replace(/^\[|\]$/g, '')
}

function wsUrl(host: string, port: number): string {
  return `ws://${host.includes(':') ? `[${host}]` : host}:${port}`
}

/** 端口上有没有人在听。锁是在监听之前写的，只看锁会连到一个还没开门的端口 */
function listening(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/** 已经在跑的 domid；没有就返回 null */
export async function findDaemon(home: string): Promise<DaemonEndpoint | null> {
  const info = readLock(daemonPaths(home).lock)
  if (!info || info.port <= 0 || !isAlive(info.pid)) return null
  const host = localConnectHost(info.host)
  if (!(await listening(host, info.port))) return null
  return { url: wsUrl(host, info.port), pid: info.pid, spawned: false }
}

export interface EnsureDaemonOptions {
  home: string
  /** 拉起 domid 的命令（不含环境变量）。开发期是 [bun, main.tsx]，单二进制是 [domi] */
  command: readonly string[]
  env?: Record<string, string | undefined>
  cwd?: string
  timeoutMs?: number
}

export async function ensureDaemon(opts: EnsureDaemonOptions): Promise<DaemonEndpoint> {
  const running = await findDaemon(opts.home)
  if (running) return running

  const paths = daemonPaths(opts.home)
  mkdirSync(dirname(paths.log), { recursive: true })
  // 输出进日志文件而不是管道：拉起它的终端关掉之后，管道另一头就没了
  const fd = openSync(paths.log, 'a')
  const [cmd, ...args] = opts.command
  if (!cmd) throw new Error('ensureDaemon: command 不能为空')
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...(opts.env ?? process.env), HOME: opts.home, [DAEMON_ROLE_ENV]: 'daemon' },
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  })
  closeSync(fd)
  child.unref()

  let exitCode: number | null = null
  let spawnError: Error | null = null
  child.once('exit', (code) => {
    exitCode = code ?? -1
  })
  child.once('error', (e) => {
    spawnError = e
  })

  const deadline = Date.now() + (opts.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    const found = await findDaemon(opts.home)
    if (found) return { ...found, spawned: found.pid === child.pid }
    if (spawnError) throw new DaemonStartError(paths.log, (spawnError as Error).message)
    // 抢输了（EXIT_LOCK_HELD）不是失败：赢家马上就会出现在锁里
    if (exitCode !== null && exitCode !== EXIT_LOCK_HELD) {
      throw new DaemonStartError(paths.log, `退出码 ${exitCode}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new DaemonStartError(paths.log, '等待超时')
}
