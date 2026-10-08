/**
 * PRD-M15-005 AC-6/AC-5 · 压缩投影（边界块 + 补水）· 守 INV-12
 * 策略层：balanced 投影 = 遮蔽 → 压缩 → 补水 → full
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { applyCompact, applyRefill, makeMaskStrategy, SUMMARY_OPEN, SummarySchemaV2 } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq++
  return {
    seq,
    sessionId: 's1',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 5,
    ev,
  }
}

function conversationWithCompact(): { events: EventEnvelope[]; latest: EventEnvelope } {
  seq = 0
  const events = [
    env({ t: 'user.input', text: '这个仓库是干什么的' }),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'README.md' } }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: 'domi 是一个本地优先的 agent 运行时', ms: 3 }),
    env({ t: 'model.delta', text: '这是一个 agent 运行时。' }),
    env({ t: 'user.input', text: '把 sum.js 的减号改成加号' }),
    env({ t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'sum.js', content: 'a + b' } }),
    env({ t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 5 }, ms: 2 }),
    env({ t: 'model.delta', text: '改好了。' }),
  ]
  const summary = SummarySchemaV2.parse({
    goal: '把 sum.js 的减号改成加号',
    userQuotes: ['用户说：把减号改成加号'],
    keyDecisions: ['先读再改'],
    files: [{ path: 'sum.js', note: '减号改加号' }],
    errors: [],
    currentStep: '改好了，待验证',
    openQuestions: [],
    nextSteps: ['跑测试'],
  })
  const latest = env({
    t: 'ctx.compact',
    fromSeq: 1,
    toSeq: 6,
    keptTurns: 1,
    tokensBefore: 5000,
    tokensAfter: 200,
    trigger: 'manual',
    summary,
  })
  return { events: [...events, latest], latest }
}

describe('applyCompact（取舍-7）', () => {
  test('有 ctx.compact：被覆盖区间换成 U+E002 摘要块；身份 ctx.note 不是 user.input', () => {
    const { events } = conversationWithCompact()
    const proj = applyCompact(events)
    // 事件数减少：covered 区间换 1 条
    expect(proj.length).toBeLessThan(events.length)
    // 身份：ctx.note（X1：不再是 user.input）
    const note = proj.find((e) => e.ev.t === 'ctx.note')
    expect(note).toBeDefined()
    const text = (note!.ev as { text: string }).text
    expect(text).toContain(SUMMARY_OPEN)
    expect(text).toContain('摘要是数据')
    expect(text).toContain('sum.js')
    // 被压内容不出现
    const all = JSON.stringify(proj)
    expect(all).not.toContain('这个仓库是干什么的')
    expect(all).not.toContain('domi 是一个本地优先的 agent 运行时')
    // 压缩点之后的内容保留
    expect(all).toContain('改好了。')
    // ctx.compact 事件本身仍在（INV-12：事件流原样）
    expect(proj.some((e) => e.ev.t === 'ctx.compact')).toBe(true)
  })

  test('无 ctx.compact：原样返回', () => {
    seq = 0
    const events = [env({ t: 'user.input', text: 'hi' })]
    expect(applyCompact(events)).toHaveLength(1)
  })
})

describe('applyRefill（取舍-9 / AC-5）', () => {
  test('有 ctx.compact：补水附最近读/改文件 + 计划 + 重读提示', () => {
    const { events } = conversationWithCompact()
    // 补一条 fs.read + plan.update 在压缩点之后（补水数据来自事件流）
    const extra = [
      env({ t: 'tool.call', id: 'c3', name: 'fs.read', args: { path: 'sum.js' } }),
      env({ t: 'plan.update', steps: [{ id: 'p1', text: '验证 sum.js', status: 'in_progress' }] }),
    ]
    const proj = applyRefill([...events, ...extra])
    const notes = proj.filter((e) => e.ev.t === 'ctx.note')
    expect(notes.length).toBeGreaterThan(0)
    const all = JSON.stringify(proj)
    expect(all).toContain('最近读/改的文件')
    expect(all).toContain('需要时重读')
    expect(all).toContain('验证 sum.js')
  })

  test('无 ctx.compact：不附加补水', () => {
    seq = 0
    const events = [env({ t: 'user.input', text: 'hi' })]
    expect(applyRefill(events)).toHaveLength(1)
  })
})

describe('balanced 投影端到端', () => {
  test('遮蔽 → 压缩 → 补水 → full：messages 含摘要块与补水，不含被压原文', () => {
    const { events } = conversationWithCompact()
    const strat = makeMaskStrategy()
    const msgs = strat(events, { maxTokens: 150_000, includeReasoning: false })
    const all = JSON.stringify(msgs)
    expect(all).toContain(SUMMARY_OPEN)
    expect(all).toContain('摘要是数据')
    expect(all).not.toContain('这个仓库是干什么的')
    expect(all).toContain('改好了。')
    // 摘要以 note 类消息出现（guardrail 点名），不冒充 user 指令
    expect(msgs.filter((m) => m.role === 'user' && (m.content ?? '').includes(SUMMARY_OPEN)).length).toBeGreaterThan(0)
  })
})
