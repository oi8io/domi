/**
 * PRD-M0-006 · 上下文拼装是纯函数（AC-1/2/3）
 * PRD-M0-006 AC-4/AC-5 · 拼装策略是可选项（回写自 docs/adr/005）
 * SPEC-M0-002 · §3.5
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import {
  buildContext,
  type ContextPolicy,
  listContextStrategies,
  markToolResult,
  registerContextStrategy,
} from '../src/index.ts'

const P: ContextPolicy = { maxTokens: 100_000, includeReasoning: false }

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: seq > 1 ? seq - 1 : null, ts: 1_756_000_000_000 + seq, schemaVersion: 1, ev }
}
beforeEach(() => {
  seq = 0
})

function conversation(): EventEnvelope[] {
  return [
    env({ t: 'user.input', text: '把 README 的标题改成 domi' }),
    env({ t: 'model.request', provider: 'stub', model: 'stub-1', tokensIn: 64 }),
    env({ t: 'model.reason', text: '先读文件再改' }),
    env({ t: 'model.delta', text: '我先读一下 ' }),
    env({ t: 'model.delta', text: 'README。' }),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'README.md' } }),
    env({ t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'user', matchedRule: null }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: { lines: 3 }, ms: 12 }),
    env({ t: 'model.delta', text: '改好了。' }),
    env({ t: 'model.usage', raw: { input_tokens: 64 } }),
  ]
}

describe('PRD-M0-006 AC-2 · 确定性', () => {
  test('同一事件流两次调用，JSON 序列化后 byte 级相同', () => {
    const evs = conversation()
    const a = JSON.stringify(buildContext(evs, P))
    const b = JSON.stringify(buildContext(evs, P))
    expect(a).toBe(b)
  })
})

describe('PRD-M0-006 AC-3 · 输出可深比较断言', () => {
  test('轨迹专用事件不进上下文；delta 合并；工具结果成独立消息', () => {
    expect(buildContext(conversation(), P)).toEqual([
      { role: 'user', content: '把 README 的标题改成 domi' },
      {
        role: 'assistant',
        content: '我先读一下 README。',
        toolCalls: [{ id: 'c1', name: 'fs.read', args: { path: 'README.md' } }],
      },
      // 内容带边界标记（PRD-M2-006 AC-2）：标记之内的一切都是数据，摊平进单条消息也还在
      { role: 'tool', toolCallId: 'c1', ok: true, content: markToolResult('c1', { lines: 3 }) },
      { role: 'assistant', content: '改好了。' },
    ])
  })

  test('includeReasoning 打开时思维链才进上下文', () => {
    const msgs = buildContext(conversation(), { ...P, includeReasoning: true })
    expect(JSON.stringify(msgs)).toContain('先读文件再改')
    expect(JSON.stringify(buildContext(conversation(), P))).not.toContain('先读文件再改')
  })

  test('未知事件被跳过但不影响其余拼装（INV-01 的下游行为）', () => {
    const evs = conversation()
    evs.splice(1, 0, {
      seq: 99,
      sessionId: 's',
      parentSeq: 1,
      ts: 0,
      schemaVersion: 7,
      ev: { t: 'soul.evolve', __unparsed: { t: 'soul.evolve' }, __schemaVersion: 7 },
    })
    expect(buildContext(evs, P)).toHaveLength(4)
  })

  test('拼完仍超长：明确报错并指出可调的配置，不让模型 400', () => {
    const big = [env({ t: 'user.input', text: 'x'.repeat(10_000) })]
    expect(() => buildContext(big, { maxTokens: 10, includeReasoning: false })).toThrow(
      /maxTokens[\s\S]*context\.strategy/,
    )
  })

  // BUG-M14-001：原来按「字符数 / 4」估，3000 个汉字只算约 770 token，maxTokens=2000 放行，到模型侧才 400
  test('BUG-M14-001 · 中文按 CJK 口径估算：3000 个汉字超过 maxTokens=2000 要报错', () => {
    const big = [env({ t: 'user.input', text: '中'.repeat(3_000) })]
    expect(() => buildContext(big, { maxTokens: 2_000, includeReasoning: false })).toThrow(/maxTokens/)
  })

  test('BUG-M14-001 · 英文口径不变：10000 个 ASCII 字符约 2.5k token，maxTokens=2600 放行', () => {
    const big = [env({ t: 'user.input', text: 'x'.repeat(10_000) })]
    expect(() => buildContext(big, { maxTokens: 2_600, includeReasoning: false })).not.toThrow()
  })
})

describe('PRD-M0-006 AC-4 · 策略是可选项', () => {
  test('不传 strategy 时默认 full', () => {
    expect(listContextStrategies()).toContain('full')
    expect(buildContext(conversation(), P)).toEqual(buildContext(conversation(), { ...P, strategy: 'full' }))
  })

  test('未注册的策略名产生明确错误并列出可用策略，不静默回退', () => {
    expect(() => buildContext(conversation(), { ...P, strategy: 'nope' })).toThrow(/nope[\s\S]*full/)
  })

  test('注册新策略不需要改 buildContext 本身', () => {
    registerContextStrategy('only-user', (evs) =>
      evs.flatMap((e) =>
        'text' in e.ev && e.ev.t === 'user.input' ? [{ role: 'user' as const, content: e.ev.text }] : [],
      ),
    )
    expect(listContextStrategies()).toContain('only-user')
    expect(buildContext(conversation(), { ...P, strategy: 'only-user' })).toEqual([
      { role: 'user', content: '把 README 的标题改成 domi' },
    ])
  })
})

describe('PRD-M0-006 AC-5 · incremental 是占位，不是第二套实现', () => {
  test('调用 incremental 抛出指向 ADR-005 的错误，不静默降级为 full', () => {
    expect(() => buildContext(conversation(), { ...P, strategy: 'incremental' })).toThrow(/adr\/005/)
  })
})

describe('M15 · 前缀只增不改（SPEC-M15-003 · INV-12(b)）', () => {
  test('ctx.note 渲染为追加 user 块，不改已有消息', () => {
    const evs = [
      env({ t: 'user.input', text: '改 README 标题' }),
      env({ t: 'model.request', provider: 'stub', model: 'stub-1', tokensIn: 8 }),
      env({ t: 'model.delta', text: '我先看看。' }),
      // 计划变化 → 追加送达（不重写已发出的内容）
      env({ t: 'ctx.note', text: '计划已更新：先读 README，再改标题', reason: 'plan', ref: 3 }),
      env({ t: 'ctx.note', text: '工作目录变了：/tmp/w2', reason: 'env' }),
      env({ t: 'model.request', provider: 'stub', model: 'stub-1', tokensIn: 9 }),
      env({ t: 'model.delta', text: '好。' }),
    ]
    const out = buildContext(evs, P)
    const roles = out.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'user', 'assistant'])
    // 第一条 user 原样（未被改写）
    expect(out[0]).toEqual({ role: 'user', content: '改 README 标题' })
    // 两条 ctx.note 追加为独立的 user 块
    expect((out[2] as { content: string }).content).toContain('计划已更新')
    expect((out[3] as { content: string }).content).toContain('工作目录变了')
  })
})
