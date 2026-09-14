/**
 * docs/adr/009 · client-core 的投影
 * PRD-M0-005 AC-1 的参数摘要规则也在这里定死
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { ARG_SUMMARY_LIMIT, createSessionStore, summarizeArgs } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts: 0, schemaVersion: 2, ev }
}

describe('事件流投影', () => {
  test('连续 delta 合并成一条 assistant，而不是每个 token 一行', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'user.input', text: '你好' }),
      env({ t: 'model.delta', text: '我' }),
      env({ t: 'model.delta', text: '在想' }),
      env({ t: 'model.delta', text: '…' }),
    ])
    const items = s.$items.get()
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ kind: 'assistant', text: '我在想…' })
    expect(s.$streaming.get()).toBe('我在想…')
  })

  test('工具调用之后的 delta 另起一条，不会拼到前一段上', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'model.delta', text: '先读' }),
      env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'a.txt' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: { lines: 3 }, ms: 5 }),
      env({ t: 'model.delta', text: '读完了' }),
    ])
    const kinds = s.$items.get().map((i) => i.kind)
    expect(kinds).toEqual(['assistant', 'tool-call', 'tool-result', 'assistant'])
  })

  test('未知事件被跳过，不进 transcript（INV-01 的下游行为）', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      {
        seq: 99,
        sessionId: 's',
        parentSeq: null,
        ts: 0,
        schemaVersion: 9,
        ev: { t: 'soul.evolve', __unparsed: {}, __schemaVersion: 9 },
      },
      env({ t: 'user.input', text: '你好' }),
    ])
    expect(s.$items.get()).toHaveLength(1)
  })

  test('usage 原始字段整块进状态栏，不在这里挑字段（ADR-004）', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([env({ t: 'model.usage', raw: { input_tokens: 100, cache_read_input_tokens: 88 } })])
    expect(s.$status.get().lastUsage).toEqual({ input_tokens: 100, cache_read_input_tokens: 88 })
  })

  test('权限事件进 transcript 且能看出是准是拒（INV-03 的可见性）', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'permission', capabilityId: 'fs.write', decision: 'deny', source: 'default', matchedRule: null }),
    ])
    expect(s.$items.get()[0]).toMatchObject({ kind: 'permission', text: 'fs.write → deny', ok: false })
  })
})

describe('PRD-M0-005 AC-1 · 参数摘要规则', () => {
  test('短参数原样显示', () => {
    expect(summarizeArgs({ path: 'a.txt' })).toBe('{"path":"a.txt"}')
  })

  test('超过 80 字符截断并加省略号', () => {
    const s = summarizeArgs({ content: 'x'.repeat(200) })
    expect(s).toHaveLength(ARG_SUMMARY_LIMIT + 1)
    expect(s.endsWith('…')).toBe(true)
  })

  test('无法序列化的参数不崩', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => summarizeArgs(circular)).not.toThrow()
  })
})
