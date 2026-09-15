/**
 * 状态栏的格式化。TUI 与 Web 共用这一份，两端逐字一致（parity 第 9 项）
 */
import { describe, expect, test } from 'bun:test'
import { formatElapsed } from '../src/index.ts'

describe('formatElapsed · 本轮耗时（BUG-M3-003）', () => {
  test('一分钟以内到 0.1 秒，以上到秒', () => {
    expect(formatElapsed(0)).toBe('0.0s')
    expect(formatElapsed(2_340)).toBe('2.3s')
    expect(formatElapsed(59_949)).toBe('59.9s')
    expect(formatElapsed(60_000)).toBe('1m00s')
    expect(formatElapsed(83_400)).toBe('1m23s')
    expect(formatElapsed(3_725_000)).toBe('62m05s')
  })
})
