/** 贴底判定纯函数 —— PRD-M11-001 / PRD-M11-002 */
import { describe, expect, test } from 'bun:test'
import { NEAR_BOTTOM_PX, nextScrollAction, shouldStickToBottom } from '../src/lib/scroll.ts'

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

describe('nextScrollAction —— 新内容来了该贴底还是累计浮条', () => {
  test('用户在底部（没上翻）：内容从 0 → 3，贴底、不累计', () => {
    expect(nextScrollAction({ awayFromBottom: false, prevLen: 0, nextLen: 3 })).toEqual({
      stick: true,
      newCount: 0,
    })
  })

  test('用户在底部（没上翻）：内容 3 → 5，继续贴底、不累计', () => {
    expect(nextScrollAction({ awayFromBottom: false, prevLen: 3, nextLen: 5 })).toEqual({
      stick: true,
      newCount: 0,
    })
  })

  test('用户上翻后：内容 3 → 5，不贴底、累计 2 条新消息', () => {
    expect(nextScrollAction({ awayFromBottom: true, prevLen: 3, nextLen: 5 })).toEqual({
      stick: false,
      newCount: 2,
    })
  })

  test('用户上翻后但没新内容：不贴底、不累计', () => {
    expect(nextScrollAction({ awayFromBottom: true, prevLen: 5, nextLen: 5 })).toEqual({
      stick: false,
      newCount: 0,
    })
  })

  test('条数倒退（防御，不该发生）：不累计出负数', () => {
    expect(nextScrollAction({ awayFromBottom: true, prevLen: 5, nextLen: 3 })).toEqual({
      stick: false,
      newCount: 0,
    })
  })

  test('初始进入（0 → 0、没上翻）：贴底占位、不累计', () => {
    expect(nextScrollAction({ awayFromBottom: false, prevLen: 0, nextLen: 0 })).toEqual({
      stick: true,
      newCount: 0,
    })
  })
})
