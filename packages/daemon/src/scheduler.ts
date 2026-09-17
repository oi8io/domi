/**
 * 调度器 —— PRD-M8-007 AC-2 / AC-3 · SPEC-M8-007 取舍-7
 *
 * 在 domid 进程里跑，时钟与定时器都注入（测试用假时钟）。每次醒来对每个计划看：
 * 「不晚于现在的最近一个应触发时刻」是否晚于 last_due → 是就触发一次（错过多个周期也只补这一次）。
 * 醒来的间隔 = 到最近一次运行的时间，最长 60 秒（系统休眠之后定时器会漂，靠这个兜底）。
 */
import type { ScheduleRow, ScheduleRunRow } from '@domi/store'
import { nextRun, parseCron, prevRun } from './cron.ts'

/** 应触发时刻之后多久内算准点。超过就是 late（domid 没开、机器睡着了） */
export const LATE_AFTER_MS = 60_000
const MAX_SLEEP_MS = 60_000

export interface ScheduleStore {
  list(): ScheduleRow[]
  get(id: string): ScheduleRow | null
  setLastDue(id: string, due: number): void
  addRun(r: ScheduleRunRow): void
  lastFired(id: string): ScheduleRunRow | null
}

export interface SchedulerDeps {
  store: ScheduleStore
  now(): number
  /** 返回取消函数 */
  setTimer(fn: () => void, ms: number): () => void
  /** 真的去建任务并提交目标，返回会话 id */
  fire(s: ScheduleRow, due: number, late: boolean): Promise<string>
  isBusy(sessionId: string): boolean
  log?(line: string): void
}

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`没有这个定时任务：${id}`)
    this.name = 'ScheduleNotFoundError'
  }
}

export class ScheduleBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleBusyError'
  }
}

export function scheduleNextRun(s: Pick<ScheduleRow, 'cron' | 'tz' | 'paused'>, now: number): number | null {
  if (s.paused) return null
  try {
    return nextRun(parseCron(s.cron), s.tz, now)
  } catch {
    return null
  }
}

export class Scheduler {
  private cancel: (() => void) | null = null
  private ticking: Promise<void> | null = null
  private stopped = true

  constructor(private readonly deps: SchedulerDeps) {}

  /** 启动：先补跑错过的（每个计划最多一次），再排下一次 */
  start(): Promise<void> {
    this.stopped = false
    return this.tick()
  }

  stop(): void {
    this.stopped = true
    this.cancel?.()
    this.cancel = null
  }

  /** 计划有变化（新建 / 改 / 删 / 暂停）后重排定时器 */
  reschedule(): void {
    if (!this.stopped) this.arm()
  }

  /** 醒来一次。并发调用合并成一次 */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking
    this.ticking = this.runDue().finally(() => {
      this.ticking = null
      if (!this.stopped) this.arm()
    })
    return this.ticking
  }

  /** 立即运行一次，不动 last_due。上一次还在跑 → ScheduleBusyError */
  async runNow(id: string): Promise<string> {
    const s = this.deps.store.get(id)
    if (!s) throw new ScheduleNotFoundError(id)
    const busy = this.previousBusy(s.id)
    if (busy) throw new ScheduleBusyError(`上一次运行（${busy}）还没结束`)
    const now = this.deps.now()
    const sessionId = await this.deps.fire(s, now, false)
    this.deps.store.addRun({ scheduleId: s.id, due: now, firedAt: now, sessionId, late: false, skipped: false })
    return sessionId
  }

  private previousBusy(id: string): string | null {
    const prev = this.deps.store.lastFired(id)
    return prev?.sessionId && this.deps.isBusy(prev.sessionId) ? prev.sessionId : null
  }

  private async runDue(): Promise<void> {
    const now = this.deps.now()
    for (const s of this.deps.store.list()) {
      if (s.paused) continue
      let due: number | null
      try {
        due = prevRun(parseCron(s.cron), s.tz, now)
      } catch (e) {
        this.deps.log?.(`定时任务 ${s.id} 的时间表不可用：${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      if (due === null || due <= (s.lastDue ?? s.createdAt)) continue
      // 先记下「这个时刻处理过了」：触发中途崩了也不会重复建任务
      this.deps.store.setLastDue(s.id, due)
      const late = now - due > LATE_AFTER_MS
      const run = { scheduleId: s.id, due, firedAt: now, late }
      if (this.previousBusy(s.id)) {
        this.deps.store.addRun({ ...run, sessionId: null, skipped: true })
        this.deps.log?.(`定时任务 ${s.id}：上一次还没结束，跳过 ${new Date(due).toISOString()}`)
        continue
      }
      try {
        const sessionId = await this.deps.fire(s, due, late)
        this.deps.store.addRun({ ...run, sessionId, skipped: false })
      } catch (e) {
        this.deps.store.addRun({ ...run, sessionId: null, skipped: false })
        this.deps.log?.(`定时任务 ${s.id} 触发失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  private arm(): void {
    this.cancel?.()
    const now = this.deps.now()
    let next: number | null = null
    for (const s of this.deps.store.list()) {
      const n = scheduleNextRun(s, now)
      if (n !== null && (next === null || n < next)) next = n
    }
    const wait = next === null ? MAX_SLEEP_MS : Math.min(Math.max(next - now, 0), MAX_SLEEP_MS)
    this.cancel = this.deps.setTimer(() => void this.tick(), wait)
  }
}
