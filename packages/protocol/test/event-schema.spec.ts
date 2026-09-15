import { describe, expect, test } from 'bun:test'
import { DomiEventSchema, isKnownEvent, isUnknownEvent, parseEvent, SCHEMA_VERSION } from '../src/index.ts'

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
    // 这两个数字是**故意**写死的。改它们之前先回答三个问题：
    //   1. 旧版本写下的事件，新代码还能解析吗？（新增类型 / 可选字段 = 能；改既有字段 = 不能）
    //   2. fixtures/events/legacy-v{n}.jsonl 补了吗？
    //   3. packages/protocol/.api.md 重新生成了吗？
    // 三个都答完再改数字。这条测试的价值就在于逼人停一下。
    expect(SCHEMA_VERSION).toBe(8)
    const tags = DomiEventSchema.options.map(
      (o) => (o.shape.t as unknown as { _zod: { def: { values: string[] } } })._zod.def.values[0],
    )
    expect(tags).toHaveLength(23)
    expect(new Set(tags).size).toBe(tags.length)
    expect(tags).toContain('fs.snapshot')
    expect(tags).toContain('revert')
    expect(tags).toContain('ctx.cleanup')
    expect(tags).toContain('ctx.compact')
    expect(tags).toContain('ctx.ref')
    expect(tags).toContain('memory.write')
    for (const t of ['task.spawn', 'task.run', 'task.node', 'task.resume', 'task.retry', 'task.end']) {
      expect(tags).toContain(t)
    }
  })
})

describe('INV-01 · 判别函数对脏输入也不抛错', () => {
  test('非对象输入返回 false，而不是 TypeError', () => {
    // 正常路径（parseEvent）永远给对象，但这两个函数是导出的，谁都能拿脏数据来调。
    // 这条是在写 client-core 的测试时真撞出来的：`"__unparsed" in 1` 直接抛。
    for (const junk of [null, undefined, 42, 'nope']) {
      expect(() => isKnownEvent(junk as never)).not.toThrow()
      expect(isKnownEvent(junk as never)).toBe(false)
      expect(isUnknownEvent(junk as never)).toBe(false)
    }
  })
})
