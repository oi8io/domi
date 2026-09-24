/** PRD-M13-001 / PRD-M13-002 · 运行中补充与中断的协议契约（SPEC-M13-001 取舍-5 · SPEC-M13-002 取舍-1） */
import { describe, expect, test } from 'bun:test'
import { METHODS, NOTIFICATIONS } from '../src/index.ts'

describe('PRD-M13-001 AC-5 / AC-6 · session.note / session.note.withdraw', () => {
  test('session.note：文本必填、不能为空', () => {
    const p = METHODS['session.note'].params
    expect(p.safeParse({ sessionId: 's', text: '顺便跑下测试' }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', text: '' }).success).toBe(false)
    expect(p.safeParse({ sessionId: 's' }).success).toBe(false)
  })

  test('session.note 的结果：queued 带 noteId；submitted 不带', () => {
    const r = METHODS['session.note'].result
    expect(r.safeParse({ state: 'queued', noteId: 'n-1' }).success).toBe(true)
    expect(r.safeParse({ state: 'queued' }).success).toBe(false)
    expect(r.safeParse({ state: 'submitted' }).success).toBe(true)
    expect(r.safeParse({ state: 'dropped' }).success).toBe(false)
  })

  test('session.note.withdraw：按 noteId 撤回，回 withdrawn', () => {
    expect(METHODS['session.note.withdraw'].params.safeParse({ sessionId: 's', noteId: 'n-1' }).success).toBe(true)
    expect(METHODS['session.note.withdraw'].result.safeParse({ withdrawn: false }).success).toBe(true)
  })

  test('通知：session.notes 推队列、session.notes.returned 推退回', () => {
    const note = { id: 'n-1', text: 'x', from: 'domi-web' }
    expect(NOTIFICATIONS['session.notes'].params.safeParse({ sessionId: 's', pending: [note] }).success).toBe(true)
    expect(NOTIFICATIONS['session.notes.returned'].params.safeParse({ sessionId: 's', notes: [note] }).success).toBe(
      true,
    )
  })
})

describe('PRD-M13-002 AC-1 · session.interrupt', () => {
  test('只要 sessionId；回 interrupted', () => {
    expect(METHODS['session.interrupt'].params.safeParse({ sessionId: 's' }).success).toBe(true)
    expect(METHODS['session.interrupt'].result.safeParse({ interrupted: true }).success).toBe(true)
    expect(METHODS['session.interrupt'].result.safeParse({}).success).toBe(false)
  })
})
