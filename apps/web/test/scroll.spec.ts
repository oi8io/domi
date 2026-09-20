/** 贴底判定纯函数 —— PRD-M11-001 / PRD-M11-002 */
import { describe, expect, test } from 'bun:test'
import { NEAR_BOTTOM_PX, shouldStickToBottom } from '../src/lib/scroll.ts'

describe('shouldStickToBottom —— 距底多近算贴底', () => {
  test('贴着底部（距底 0）→ 贴', () => {
    expect(shouldStickToBottom(0)).toBe(true)
  })
  test('距底 100px（在阈值内）→ 贴', () => {
    expect(shouldStickToBottom(100)).toBe(true)
  })
  test('阈值边界 160px 本身 → 不贴（< 才算，沿用现状严格小于）', () => {
    expect(shouldStickToBottom(NEAR_BOTTOM_PX)).toBe(false)
  })
  test('距底 161px（用户上翻了）→ 不打扰', () => {
    expect(shouldStickToBottom(161)).toBe(false)
  })
  test('负距离（内容比视口短）→ 贴', () => {
    expect(shouldStickToBottom(-10)).toBe(true)
  })
})
