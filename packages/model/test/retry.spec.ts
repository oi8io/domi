/**
 * PRD-M1-001 AC-5 · 429 / 5xx / 超时的指数退避重试
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_RETRY, RetriesExhaustedError, backoffMs, isRetryable, withRetry } from '../src/index.ts'

const noSleep = { ...DEFAULT_RETRY, sleep: async () => {} }

describe('AC-5 · 哪些错该重试', () => {
  test.each([
    ['429 限流', { status: 429 }],
    ['500', { status: 500 }],
    ['503', { statusCode: 503 }],
    ['超时', { name: 'TimeoutError', message: 'request timeout' }],
    ['连接重置', { message: 'ECONNRESET' }],
    ['fetch failed', { message: 'fetch failed' }],
  ])('%s 会重试', (_l, e) => {
    expect(isRetryable(e)).toBe(true)
  })

  test.each([
    ['400', { status: 400 }],
    ['401 凭据错', { status: 401 }],
    ['404', { status: 404 }],
    ['422', { status: 422 }],
  ])('%s 不重试 —— 重试三次只是把同一个错误犯三遍', (_l, e) => {
    expect(isRetryable(e)).toBe(false)
  })
})

describe('AC-5 · 重试行为', () => {
  test('429 重试 3 次后抛 RetriesExhaustedError，消息里说明可以换模型', async () => {
    let calls = 0
    await expect(
      withRetry(async () => {
        calls++
        throw { status: 429, message: 'rate limited' }
      }, noSleep),
    ).rejects.toThrow(RetriesExhaustedError)
    expect(calls).toBe(4) // 首次 + 3 次重试

    try {
      await withRetry(async () => {
        throw { status: 429, message: 'rate limited' }
      }, noSleep)
    } catch (e) {
      expect((e as Error).message).toContain('换一个模型')
      expect((e as Error).message).toContain('会话没有丢失')
    }
  })

  test('4xx 直接抛原错，不包装也不重试', async () => {
    let calls = 0
    const err = { status: 401, message: 'bad key' }
    await expect(
      withRetry(async () => {
        calls++
        throw err
      }, noSleep),
    ).rejects.toEqual(err)
    expect(calls).toBe(1)
  })

  test('中途成功就返回', async () => {
    let calls = 0
    const r = await withRetry(async () => {
      calls++
      if (calls < 3) throw { status: 500 }
      return 'ok'
    }, noSleep)
    expect(r).toBe('ok')
    expect(calls).toBe(3)
  })

  test('退避是指数的，且**带 jitter** —— 没有 jitter 会把限流变成雪崩', () => {
    const fixed = { ...DEFAULT_RETRY, jitter: () => 0 }
    expect(backoffMs(0, fixed)).toBe(500)
    expect(backoffMs(1, fixed)).toBe(1000)
    expect(backoffMs(2, fixed)).toBe(2000)

    // 真实 jitter：同一 attempt 多次取值不应全部相同
    const samples = new Set(Array.from({ length: 20 }, () => backoffMs(1, DEFAULT_RETRY)))
    expect(samples.size).toBeGreaterThan(1)
  })

  test('退避时长真的被等待了（不是算出来就扔掉）', async () => {
    const waited: number[] = []
    await expect(
      withRetry(
        async () => {
          throw { status: 500 }
        },
        { attempts: 2, baseMs: 100, jitter: () => 0, sleep: async (ms) => void waited.push(ms) },
      ),
    ).rejects.toThrow(RetriesExhaustedError)
    expect(waited).toEqual([100, 200])
  })
})
