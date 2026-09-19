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

  test('BUG-M3-001 · 连续 reason 也合并成一条思考，而不是一个 token 一行', () => {
    // 现场（2026-09-15，GLM 经 z.ai）：思考过程逐 token 推来，Web 和 TUI 都是一行一个字
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'user.input', text: 'Hi' }),
      env({ t: 'model.reason', text: '用户' }),
      env({ t: 'model.reason', text: '在打' }),
      env({ t: 'model.reason', text: '招呼' }),
      env({ t: 'model.delta', text: '你好' }),
      env({ t: 'model.delta', text: '！' }),
    ])
    expect(s.$items.get().map((i) => [i.kind, i.text])).toEqual([
      ['user', 'Hi'],
      ['reason', '用户在打招呼'],
      ['assistant', '你好！'],
    ])
    // 流式的「当前回答」只看 assistant，思考不算
    expect(s.$streaming.get()).toBe('你好！')
  })

  test('思考与回答交替时各自成段，不会跨段拼接', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'model.reason', text: '先想' }),
      env({ t: 'model.delta', text: '答一' }),
      env({ t: 'model.reason', text: '再想' }),
      env({ t: 'model.delta', text: '答二' }),
    ])
    expect(s.$items.get().map((i) => i.text)).toEqual(['先想', '答一', '再想', '答二'])
  })

  test('模型切换出现在对话里，失去的能力写在摘要里', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'model.switch', from: 'a', to: 'b' }),
      env({ t: 'model.switch', from: 'b', to: 'weak', lostCapabilities: ['toolCall', 'vision'] }),
    ])
    // ts 是事件时间戳（M8-008 的时间线要它）；这里的 env 都给 0
    expect(s.$items.get()).toEqual([
      { seq: 1, ts: 0, kind: 'context', text: '模型切换 a → b' },
      { seq: 2, ts: 0, kind: 'context', text: '模型切换 b → weak', summary: '新模型不支持：toolCall、vision' },
    ])
  })

  test('PRD-M9-003 AC-7 · 带 provider 的切换（schema 12）：条目里标出 provider，失去的能力照列', () => {
    seq = 0
    const s = createSessionStore()
    s.applyEvents([
      env({ t: 'model.switch', from: 'claude-sonnet', to: 'qwen', provider: 'local', lostCapabilities: ['toolCall'] }),
    ])
    const [item] = s.$items.get()
    expect(item?.text).toContain('qwen')
    expect(item?.text).toContain('local')
    expect(item?.summary).toContain('toolCall')
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

describe('PRD-M2-002 / M2-003 · 上下文事件也在对话里看得见', () => {
  test('ctx.cleanup 投影成一条 context 条目，带各类别削减', () => {
    const store = createSessionStore()
    store.applyEvents([
      env({
        t: 'ctx.cleanup',
        fromSeq: 1,
        toSeq: 9,
        tokensBefore: 900,
        tokensAfter: 400,
        saved: { dedupe: 300, verbose: 100, resolvedError: 80, stack: 20 },
        preserved: [7],
      }),
    ])
    const item = store.$items.get()[0]
    expect(item?.kind).toBe('context')
    expect(item?.text).toContain('900 → 400')
    expect(item?.summary).toContain('去重 300')
  })

  test('ctx.compact 投影时把 intent 显示出来 —— 压缩之后最该确认的就是「它还记得我要干什么吗」', () => {
    const store = createSessionStore()
    store.applyEvents([
      env({
        t: 'ctx.compact',
        fromSeq: 1,
        toSeq: 9,
        keptTurns: 2,
        tokensBefore: 6100,
        tokensAfter: 1800,
        trigger: 'manual',
        summary: {
          intent: '把 sum.js 的减号改成加号',
          filesModified: ['sum.js'],
          keyDecisions: [],
          openQuestions: [],
          nextSteps: [],
        },
      }),
    ])
    const item = store.$items.get()[0]
    expect(item?.kind).toBe('context')
    expect(item?.text).toContain('保留最近 2 轮')
    expect(item?.summary).toBe('把 sum.js 的减号改成加号')
  })
})
