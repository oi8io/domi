import { describe, expect, test } from 'bun:test'
import { DomiEventSchema, isUnknownEvent, parseEvent, SCHEMA_VERSION } from '../src/index.ts'

describe('PRD-M0-001 / SPEC-M0-004 · 事件 schema 的前向兼容', () => {
  test('已知事件严格解析', () => {
    const ev = parseEvent({ t: 'user.input', text: 'hi' })
    expect(isUnknownEvent(ev)).toBe(false)
    expect(ev).toEqual({ t: 'user.input', text: 'hi' })
  })

  test('未知事件类型降级为 UnknownEvent 并保留原文，不抛错（INV-01）', () => {
    const future = { t: 'soul.evolve', layer: 'L4', diff: '+ 偏好 TypeScript' }
    const ev = parseEvent(future, 7)
    expect(isUnknownEvent(ev)).toBe(true)
    if (!isUnknownEvent(ev)) throw new Error('unreachable')
    expect(ev.t).toBe('soul.evolve')
    expect(ev.__unparsed).toEqual(future)
    expect(ev.__schemaVersion).toBe(7)
  })

  test('已知类型但字段畸形也降级，不抛错（INV-01）', () => {
    const ev = parseEvent({ t: 'tool.result', id: 'x', ok: 'yes' })
    expect(isUnknownEvent(ev)).toBe(true)
    expect(ev.t).toBe('tool.result')
  })

  test('非对象输入不抛错', () => {
    for (const junk of [null, 42, 'nope', undefined, []]) {
      const ev = parseEvent(junk)
      expect(isUnknownEvent(ev)).toBe(true)
      expect(ev.t).toBe('unknown')
    }
  })

  test('SCHEMA_VERSION 与判别联合的分支数一同演进（改动时提醒回写 fixture）', () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(
      Object.keys(
        DomiEventSchema.options.reduce<Record<string, true>>((acc, o) => {
          acc[(o.shape.t as { value: string }).value] = true
          return acc
        }, {}),
      ),
    ).toHaveLength(9)
  })
})
