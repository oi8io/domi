/**
 * kernel 需要的**端口**（ports）。
 *
 * 为什么不直接 import `@domi/store` 的 `EventLog`：
 * 那个包的 index 会连带 re-export SQLite 实现，于是 kernel 的依赖闭包里会出现
 * `bun:sqlite`——即便只是 `import type` 也让 INV-02 的边界变成"靠写法小心"而不是硬边界。
 * 这里让 kernel 自己声明它需要的最小接口，`SqliteEventLog` 在结构上自然满足它。
 * 好处是 kernel 的 package.json 里除了 @domi/protocol 一无所有，这条能被机器验证。
 */
import type { DomiEvent, EventEnvelope, ToolSchema } from '@domi/protocol'

export interface EventSink {
  append(sessionId: string, evs: DomiEvent[]): Promise<{ from: number; to: number }>
  read(sessionId: string, opts?: { fromSeq?: number; toSeq?: number }): Promise<EventEnvelope[]>
  head(sessionId: string): Promise<number>
}

export interface ToolCallRequest {
  id: string
  name: string
  args: unknown
}

export interface ToolOutcome {
  ok: boolean
  payload: unknown
  /**
   * 失败原因。loop 只特别对待两个值：
   * - 'invalid_args' → 计入参数解析重试（PRD-M0-002 AC-3）
   * - 'user_denied'  → 不是错误，是用户的决定（PRD-M0-003 AC-2）
   */
  reason?: string
}

export interface ToolRunner {
  schemas(): ToolSchema[]
  run(call: ToolCallRequest, signal: AbortSignal): Promise<ToolOutcome>
}

/** 时间从外部注入——kernel 不读时钟（PRD-M0-006 AC-1，由 check-kernel-purity 守） */
export interface Clock {
  now(): number
}
