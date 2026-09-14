/**
 * EventLog —— kernel 只依赖这个接口，不依赖实现（INV-02）。见 docs/spec/M0.md §3.2
 *
 * 接口上**故意没有** update / delete：
 * append-only 是 INV-01，缺口一旦开在接口上，后面谁都堵不住。
 * 另由 scripts/check-append-only.ts 做 AST 扫描兜底（PRD-M0-001 AC-3）。
 */
import type { AnyEvent, DomiEvent, EventEnvelope } from '@domi/protocol'

export interface AppendRange {
  from: number
  to: number
}

export interface ReadOpts {
  fromSeq?: number
  toSeq?: number
}

export interface EventLog {
  /** 追加一批事件，单事务。返回分配到的 seq 区间 */
  append(sessionId: string, evs: DomiEvent[]): Promise<AppendRange>
  /** 按 seq 升序读取。永不抛"无法解析"——未知类型降级为 UnknownEvent（INV-01） */
  read(sessionId: string, opts?: ReadOpts): Promise<EventEnvelope[]>
  /** 当前最大 seq；空会话返回 0 */
  head(sessionId: string): Promise<number>
  close(): void
}

/** 供测试注入：事件里不许出现读时钟的行为（INV-02 纯度要求外溢到 store 边界） */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`)
    this.name = 'NotImplementedError'
  }
}

export function eventOf(env: EventEnvelope): AnyEvent {
  return env.ev
}
