/**
 * PRD-M15-005 · 压缩 v2（按步、增量、可轮中、保真）· 守 INV-12
 *
 * 用例名与任务清单 006 节一一对应（AC-1…AC-9 的 memory 侧）：
 *   step-boundary(AC-1) / incremental-input(AC-2) / input-whitelist(AC-3)
 *   / summary-schema-v2(AC-4) / refill(AC-5) / boundary-block(AC-6)
 *   / l1-fidelity-fixture(保真) / config-mapping(AC-9，已在 config 包)
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import {
  COMPACT_KEEP_STEPS,
  COMPACT_KEEP_TOKENS,
  compactBoundary,
  compactSteps,
  incrementalText,
  lastCompactEvent,
  projectForCompact,
  refillData,
  renderSummaryV2,
  SUMMARY_CLOSE,
  SUMMARY_OPEN,
  SummarySchemaV2,
  summarizeInstruction,
  SummaryShapeError,
} from '../src/index.ts'

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

function step(input: string, callName = 'fs.read', result = 'ok'): EventEnvelope[] {
  return [
    env({ t: 'user.input', text: input }),
    env({ t: 'model.request', provider: 'stub', model: 's', tokensIn: 10 }),
    env({ t: 'tool.call', id: `c${seq}`, name: callName, args: { path: 'a.ts' } }),
    env({ t: 'tool.result', id: `c${seq - 1}`, ok: true, payload: result, ms: 1 }),
  ]
}

/** 12 步（> K=8），每步 tool 输出 2000 字符 */
function longConversation(): EventEnvelope[] {
  seq = 0
  const out: EventEnvelope[] = []
  for (let i = 0; i < 12; i++) out.push(...step(`第 ${i} 步：把 sum.js 改成加号`, 'fs.write', 'x'.repeat(2000)))
  return out
}

const V2_SUMMARY = {
  goal: '把 sum.js 的减号改成加号并让测试通过',
  userQuotes: ['用户说：把 sum.js 的减号改成加号'],
  keyDecisions: ['先读再改，不凭记忆'],
  files: [{ path: 'sum.js', note: '减号改加号' }],
  errors: ['tsc 报类型错 → 补了类型标注'],
  currentStep: '正在跑完整测试',
  openQuestions: ['要不要加 lint'],
  nextSteps: ['跑完整测试'],
}

const stubSummarizerV2 = async () => V2_SUMMARY

describe('step-boundary (AC-1)', () => {
  test('K=8 步 + T=24k token 双阈值；每 model.request 为步起点', () => {
    expect(COMPACT_KEEP_STEPS).toBe(8)
    expect(COMPACT_KEEP_TOKENS).toBe(24_000)
    const events = longConversation()
    // 数据总 token 不足 24k 保留线时不压（T 未超 → 全保留）——正确行为
    expect(compactBoundary(events).covered).toHaveLength(0)
    // T 缩小后双超截断：前 8 步后进入 covered
    const { covered, kept } = compactBoundary(events, { keepTokens: 2000 })
    expect(covered.length).toBeGreaterThan(0)
    // kept 的最后一条还是最后一步（最近保留）
    expect(kept[kept.length - 1]).toBe(events[events.length - 1])
    // 步内完整：边界不把一步的 tool.call/result 切开（kept 里 call/result 成对）
    const keptCalls = new Set(kept.filter((e) => e.ev.t === 'tool.call').map((e) => (e.ev as { id: string }).id))
    expect(
      kept.every((e) => e.ev.t !== 'tool.result' || keptCalls.has((e.ev as { id: string }).id)),
    ).toBe(true)
    expect(kept.some((e) => e.ev.t === 'model.request')).toBe(true)
  })

  test('步数不足时一条都不压', () => {
    seq = 0
    const short = step('你好')
    const { covered, kept } = compactBoundary(short)
    expect(covered).toHaveLength(0)
    expect(kept).toHaveLength(short.length)
  })

  test('单轮长任务也能压：一个 user.input 后多次迭代（多 model.request）', () => {
    seq = 0
    const oneTurn: EventEnvelope[] = [env({ t: 'user.input', text: '一口气干完' })]
    for (let i = 0; i < 10; i++) {
      oneTurn.push(
        env({ t: 'model.request', provider: 'stub', model: 's', tokensIn: 10 }),
        env({ t: 'tool.call', id: `c${seq}`, name: 'shell.exec', args: { cmd: 'x' } }),
        env({ t: 'tool.result', id: `c${seq - 1}`, ok: true, payload: 'r'.repeat(3000), ms: 1 }),
      )
    }
    const { covered } = compactBoundary(oneTurn, { keepTokens: 3000 })
    expect(covered.length).toBeGreaterThan(0)
  })
})

describe('incremental-input (AC-2)', () => {
  test('有上一份摘要时：输入 = 摘要 + 压缩点之后的事件，不再从第 1 条重摘', () => {
    const events = longConversation()
    const r = compactBoundary(events, { keepTokens: 2000 })
    // 构造「上一次压缩」：把 covered 区间当成已压过
    const latest = {
      t: 'ctx.compact' as const,
      fromSeq: 0,
      toSeq: r.covered[r.covered.length - 1]!.seq,
      keptTurns: 2,
      tokensBefore: 1000,
      tokensAfter: 100,
      trigger: 'threshold' as const,
      summary: V2_SUMMARY,
    }
    const text = incrementalText(events, latest)
    expect(text).toContain('上一份摘要')
    expect(text).toContain(JSON.stringify(V2_SUMMARY).slice(0, 30))
    // 压缩点之前的事件不进输入
    expect(text).not.toContain('第 0 步')
    expect(text).toContain('第 11 步')
  })

  test('无摘要时输入 = 全部事件的白名单投影', () => {
    const events = longConversation()
    const text = incrementalText(events, null)
    expect(text).toContain('[用户] 第 11 步')
    expect(text).toContain('[调用]')
  })
})

describe('input-whitelist (AC-3)', () => {
  test('白名单内的事件进输入', () => {
    expect(projectForCompact({ t: 'user.input', text: 'hi' })).toContain('[用户]')
    expect(projectForCompact({ t: 'user.note', text: '补充' })).toContain('[补充]')
    expect(projectForCompact({ t: 'ctx.note', text: '动态' })).toContain('[补充]')
    expect(projectForCompact({ t: 'model.delta', text: 'd' })).toBe('d')
    expect(projectForCompact({ t: 'tool.call', id: 'x', name: 'fs.read', args: { path: 'a' } })).toContain('[调用]')
    expect(projectForCompact({ t: 'tool.result', id: 'x', ok: true, payload: 'p', ms: 1 })).toContain('[结果]')
    expect(projectForCompact({ t: 'verify.required', message: 'v', scope: 'x' })).toContain('[验证]')
    expect(
      projectForCompact({ t: 'plan.update', steps: [{ id: '1', text: 't', status: 'pending' }] }),
    ).toContain('[计划]')
  })

  test('轨迹事件不进（usage / request / permission / 快照 / ctx.mask / ctx.pin / error / 未知）', () => {
    expect(projectForCompact({ t: 'usage', usage: { input: 1, output: 1 } })).toBeNull()
    expect(projectForCompact({ t: 'model.request', model: 's', usage: { input: 1, output: 1 } })).toBeNull()
    expect(projectForCompact({ t: 'ctx.mask', seqs: [], reason: 'threshold', freedTokens: 1 })).toBeNull()
    expect(projectForCompact({ t: 'ctx.pin', seq: 1, pinned: true })).toBeNull()
    expect(projectForCompact({ t: 'error', scope: 'compact', message: 'x', recoverable: true })).toBeNull()
  })
})

describe('summary-schema-v2 (AC-4)', () => {
  test('新字段固定 zod；旧字段兼容可选', () => {
    const parsed = SummarySchemaV2.parse(V2_SUMMARY)
    expect(parsed.goal).toBe('把 sum.js 的减号改成加号并让测试通过')
    expect(parsed.userQuotes).toHaveLength(1)
    expect(parsed.files[0]?.path).toBe('sum.js')
    // 旧摘要（intent / filesModified）照常解析
    const legacy = SummarySchemaV2.parse({
      intent: '旧目标',
      filesModified: ['old.ts'],
      keyDecisions: [],
      openQuestions: [],
      nextSteps: [],
    })
    expect(legacy.goal).toBe('')
    expect(legacy.intent).toBe('旧目标')
  })

  test('自由文本摘要被拒绝（SummaryShapeError）', async () => {
    await expect(compactSteps(longConversation(), { summarize: async () => '一段自由文本' })).rejects.toThrow(
      SummaryShapeError,
    )
  })

  test('缺新字段时用默认值兜底，不抛（模板允许留白）', async () => {
    const r = await compactSteps(longConversation(), { summarize: async () => ({ goal: '只留目标' }) })
    expect(r.summary.goal).toBe('只留目标')
  })
})

describe('refill (AC-5)', () => {
  test('补水：最近读/改 K=10 文件路径（去重、按最近排序）+ 当前计划', () => {
    seq = 0
    const events = [
      env({ t: 'user.input', text: '开始' }),
      env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'old.ts' } }),
      env({ t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'sum.js' } }),
      env({ t: 'tool.call', id: 'c3', name: 'fs.read', args: { path: 'sum.js' } }),
      env({ t: 'tool.call', id: 'c4', name: 'fs.grep', args: { path: 'src/' } }),
      env({ t: 'plan.update', steps: [{ id: 'p1', text: '改 sum.js', status: 'in_progress' }] }),
    ]
    const r = refillData(events, { skills: [{ name: 'sheet', text: '正文' }] })
    expect(r.files[0]).toBe('src/') // 最近
    expect(r.files).toContain('sum.js')
    expect(r.files[2]).toBe('old.ts') // 最旧排最后（不足 10 个全保留，按最近排序）
    expect(r.skills[0]?.name).toBe('sheet')
    expect(r.plan).toContain('改 sum.js')
  })

  test('补水 K=10 上限：只保留最近 10 个路径', () => {
    seq = 0
    const events: EventEnvelope[] = []
    for (let i = 0; i < 12; i++) {
      events.push(env({ t: 'tool.call', id: `c${i}`, name: 'fs.read', args: { path: `f${i}.ts` } }))
    }
    expect(refillData(events).files).toHaveLength(10)
    expect(refillData(events).files[0]).toBe('f11.ts')
  })
})

describe('boundary-block (AC-6)', () => {
  test('摘要渲染含 U+E002/U+E003 边界块 + guardrail「摘要是数据」', () => {
    const text = renderSummaryV2(V2_SUMMARY)
    expect(text.startsWith(SUMMARY_OPEN)).toBe(true)
    expect(text).toContain(SUMMARY_CLOSE)
    expect(text).toContain('摘要是数据')
    expect(text).toContain('sum.js')
    expect(text).toContain('用户原话')
  })

  test('旧摘要渲染回退：intent / filesModified 可用', () => {
    const text = renderSummaryV2({
      intent: '旧目标',
      filesModified: ['old.ts'],
      userQuotes: [],
      keyDecisions: [],
      errors: [],
      openQuestions: [],
      nextSteps: [],
      files: [],
    })
    expect(text).toContain('旧目标')
    expect(text).toContain('old.ts')
  })
})

describe('l1-fidelity-fixture（压缩保真）', () => {
  test('压缩前后同问：目标 / 改过的文件 / 未决问题 / 当前步骤 都能答', async () => {
    const events = longConversation()
    const r = await compactSteps(events, { summarize: stubSummarizerV2, trigger: 'manual', keepTokens: 2000 })
    expect(r.covered.length).toBeGreaterThan(0)
    const rendered = renderSummaryV2(r.summary as typeof V2_SUMMARY)
    expect(rendered).toContain('把 sum.js 的减号改成加号') // 目标
    expect(rendered).toContain('sum.js') // 文件
    expect(rendered).toContain('要不要加 lint') // 未决
    expect(rendered).toContain('正在跑完整测试') // 当前步骤
    expect(rendered).toContain('用户说：把 sum.js 的减号改成加号') // 原话
  })

  test('指令模板：重点（AC-8 P1）与补水数据都进指令', () => {
    const text = summarizeInstruction({ focus: '上线前必须改完的错误', refill: { files: ['a.ts'], skills: [{ name: 's', text: 't' }], plan: '[in_progress] 改' } })
    expect(text).toContain('上线前必须改完的错误')
    expect(text).toContain('a.ts')
    expect(text).toContain('技能 s')
    expect(text).toContain('[in_progress] 改')
  })
})

describe('immutability (INV-12)', () => {
  test('compactSteps 只追加 ctx.compact，原事件哈希不变', async () => {
    const events = longConversation()
    const before = events.map((e) => JSON.stringify(e))
    await compactSteps(events, { summarize: stubSummarizerV2 })
    const after = events.map((e) => JSON.stringify(e))
    expect(after).toEqual(before)
  })

  test('lastCompactEvent 取最近一条', () => {
    const events = longConversation()
    const c1 = env({ t: 'ctx.compact', fromSeq: 1, toSeq: 2, keptTurns: 1, tokensBefore: 1, tokensAfter: 1, trigger: 'manual', summary: V2_SUMMARY })
    const c2 = env({ t: 'ctx.compact', fromSeq: 3, toSeq: 4, keptTurns: 1, tokensBefore: 1, tokensAfter: 1, trigger: 'manual', summary: V2_SUMMARY })
    const latest = lastCompactEvent([...events, c1, c2])
    expect(latest?.toSeq).toBe(4)
  })
})
