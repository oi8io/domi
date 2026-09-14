/**
 * 重试退避 —— PRD-M1-001 AC-5 · SPEC-M1-002
 *
 * 三条边界，每条都有代价：
 *   1. 只重试**幂等失败**：429 / 5xx / 网络超时。4xx（除 429）不重试——
 *      那是请求本身有问题，重试三次只是把同一个错误犯三遍。
 *   2. **jitter 必须有**。没有 jitter 时多个会话同时被限流会同时重试，
 *      把 429 变成雪崩——这是压测里才会发现、线上一定会遇到的那类问题。
 *   3. **已经吐出事件之后不再重试**。流到一半断掉重来会让用户看到重复的半句话。
 *      那种情况交给 loop 的 error{recoverable:true}，让用户决定。
 */
export interface RetryOptions {
  attempts: number
  baseMs: number
  /** 注入用；默认带 jitter。测试要确定性时传一个固定值 */
  jitter?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseMs: 500 }

export interface HttpLikeError {
  status?: number
  statusCode?: number
  name?: string
  message?: string
}

export function isRetryable(e: unknown): boolean {
  const err = e as HttpLikeError
  const status = err?.status ?? err?.statusCode
  if (typeof status === 'number') return status === 429 || status >= 500
  const text = `${err?.name ?? ''} ${err?.message ?? ''}`.toLowerCase()
  return /timeout|etimedout|econnreset|enotfound|socket hang up|fetch failed/.test(text)
}

export function backoffMs(attempt: number, opts: RetryOptions): number {
  const jitter = (opts.jitter ?? Math.random)()
  return Math.round(opts.baseMs * 2 ** attempt * (1 + jitter))
}

export class RetriesExhaustedError extends Error {
  readonly messageKey = 'error.retries_exhausted'
  constructor(
    readonly attempts: number,
    readonly last: unknown,
  ) {
    super(
      `error.retries_exhausted: 重试 ${attempts} 次仍失败（${
        (last as HttpLikeError)?.message ?? String(last)
      }）。可以换一个模型再试——会话没有丢失。`,
    )
    this.name = 'RetriesExhaustedError'
  }
}

/** 只包"还没产出任何东西"的那一段。产出开始后的失败不归它管 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let last: unknown
  for (let i = 0; i <= opts.attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isRetryable(e) || i === opts.attempts) break
      await sleep(backoffMs(i, opts))
    }
  }
  if (!isRetryable(last)) throw last
  throw new RetriesExhaustedError(opts.attempts, last)
}
