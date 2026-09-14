/**
 * PRD-M0-005 AC-2 · 焦点与按键语义（纯函数，不需要 TTY）
 */
import { describe, expect, test } from 'bun:test'
import { answerFromKey, FOCUS_CONFIRM, FOCUS_INPUT, focusIdOf } from '../src/index.ts'

describe('焦点归属', () => {
  test('没有待确认时焦点在输入框，有待确认时在确认框', () => {
    expect(focusIdOf(null)).toBe(FOCUS_INPUT)
    expect(focusIdOf({ capabilityId: 'fs.write', detail: 'x' })).toBe(FOCUS_CONFIRM)
  })

  test('连续三次渲染（状态其它部分变化）焦点不变', () => {
    const ask = { capabilityId: 'shell.exec', detail: '$ pnpm build' }
    const ids = [focusIdOf(ask), focusIdOf({ ...ask }), focusIdOf({ ...ask, detail: '$ pnpm build --force' })]
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe(FOCUS_CONFIRM)
  })
})

describe('确认框按键语义 —— fail-closed 延续到交互层', () => {
  test.each([
    ['y', true],
    ['Y', true],
    [' y ', true],
    ['n', false],
    ['N', false],
  ])('%s → %p', (input, expected) => {
    expect(answerFromKey(input)).toBe(expected)
  })

  test('Esc 等于拒绝', () => {
    expect(answerFromKey('', { escape: true })).toBe(false)
  })

  test('回车不等于同意 —— 默认拒绝', () => {
    expect(answerFromKey('', { return: true })).toBe(false)
  })

  test('未知按键返回 null（忽略），绝不当成同意', () => {
    for (const k of ['a', '1', 'yes', ' ', 'q']) expect(answerFromKey(k)).toBeNull()
  })
})
