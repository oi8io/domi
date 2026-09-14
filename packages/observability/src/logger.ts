/**
 * 进程级日志 —— PRD-M1-009 · SPEC-M1-009
 *
 * **这里只记与会话无关的东西**：启动、配置装载、provider 连接、重试。
 * 会话内容在事件流里（那才是结构化日志，见 ADR-008 不引 pino 的理由）。
 * 两边都记必然不一致，而不一致的日志比没有日志更误导人。
 *
 * 脱敏**复用 packages/store 的同一份正则**。两处各写一份会漂移：
 * 运行时脱敏 5 类、日志只认 4 类，漏掉的那类会安静地躺在磁盘上。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { redactString } from '@domi/store'

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type Level = (typeof LEVELS)[number]

export const DEFAULT_RETAIN_DAYS = 7
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024

export interface LoggerOptions {
  dir?: string
  level?: Level
  retainDays?: number
  maxFileBytes?: number
  now?: () => number
  /** 注入用；默认写文件 */
  sink?: (line: string) => void
}

function levelRank(l: Level): number {
  return LEVELS.indexOf(l)
}

export function parseLevel(v: string | undefined, fallback: Level = 'info'): Level {
  const s = (v ?? '').toLowerCase()
  return (LEVELS as readonly string[]).includes(s) ? (s as Level) : fallback
}

export function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export class Logger {
  readonly dir: string
  readonly level: Level
  private readonly retainDays: number
  private readonly maxFileBytes: number
  private readonly now: () => number
  private readonly sink: ((line: string) => void) | undefined

  constructor(opts: LoggerOptions = {}) {
    this.dir = opts.dir ?? join(homedir(), '.domi', 'logs')
    this.level = opts.level ?? parseLevel(process.env.DOMI_LOG)
    this.retainDays = opts.retainDays ?? DEFAULT_RETAIN_DAYS
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.now = opts.now ?? (() => Date.now())
    this.sink = opts.sink
    if (!this.sink) mkdirSync(this.dir, { recursive: true })
  }

  filePath(ts = this.now()): string {
    return join(this.dir, `domi-${dayOf(ts)}.log`)
  }

  private write(level: Level, msg: string, fields?: Record<string, unknown>): void {
    if (levelRank(level) < levelRank(this.level)) return
    const ts = this.now()
    const record = { ts: new Date(ts).toISOString(), level, msg, ...(fields ?? {}) }
    // 脱敏整条 JSON：凭据藏在哪个字段都跑不掉
    const line = redactString(JSON.stringify(record))

    if (this.sink) {
      this.sink(line)
      return
    }
    this.rotateIfNeeded(ts)
    appendFileSync(this.filePath(ts), `${line}\n`, 'utf8')
    this.prune(ts)
  }

  /** 单文件超上限时切一个带序号的副本出去，当天的主文件继续写 */
  private rotateIfNeeded(ts: number): void {
    const p = this.filePath(ts)
    if (!existsSync(p)) return
    if (statSync(p).size < this.maxFileBytes) return
    let i = 1
    while (existsSync(`${p}.${i}`)) i++
    renameSync(p, `${p}.${i}`)
  }

  /** 保留 N 天。按文件名里的日期算，不看 mtime——mtime 会被备份工具改掉 */
  private prune(ts: number): void {
    const cutoff = dayOf(ts - this.retainDays * 86_400_000)
    for (const name of readdirSync(this.dir)) {
      const m = name.match(/^domi-(\d{4}-\d{2}-\d{2})\.log/)
      if (!m) continue
      if ((m[1] as string) < cutoff) rmSync(join(this.dir, name), { force: true })
    }
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.write('debug', msg, fields)
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.write('info', msg, fields)
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.write('warn', msg, fields)
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.write('error', msg, fields)
  }
}
