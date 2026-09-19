/**
 * 运行时护栏（PRD-M10-003 AC-1）：config.loop 节。
 * 缺省与 kernel 的 DEFAULT_LIMITS 一致；值域校验在 schema 层。
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema } from '../src/schema.ts'

const minimal = (patch: unknown = {}) =>
  ConfigSchema.parse({ model: { provider: 'anthropic', name: 'x' }, ...(patch as object) })

describe('PRD-M10-003 · loop 节', () => {
  test('缺省 100 / 3 / 600_000，与 kernel DEFAULT_LIMITS 一致', () => {
    expect(minimal().loop).toEqual({ maxToolCalls: 100, maxArgParseRetries: 3, maxWallClockMs: 600_000 })
  })

  test('写得进去', () => {
    const cfg = minimal({ loop: { maxToolCalls: 5, maxArgParseRetries: 2, maxWallClockMs: 30_000 } })
    expect(cfg.loop).toEqual({ maxToolCalls: 5, maxArgParseRetries: 2, maxWallClockMs: 30_000 })
  })

  test('非法值被拒：非整数 / 0 / 负数 / 超上限', () => {
    const bad: unknown[] = [
      { maxToolCalls: 1.5 },
      { maxToolCalls: 0 },
      { maxToolCalls: -1 },
      { maxToolCalls: 1001 },
      { maxArgParseRetries: 0 },
      { maxArgParseRetries: 101 },
      { maxWallClockMs: 999 },
      { maxWallClockMs: 0 },
      { maxWallClockMs: 86_400_001 },
    ]
    for (const patch of bad) expect(() => minimal({ loop: patch })).toThrow()
  })
})
