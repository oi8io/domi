/**
 * TASK-M14-006 · 上下文 tab 投影测试（PRD-M14-006 AC-1…AC-8）
 * 测试先行：先写失败测试，再实现 context.ts。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { type CtxStatic, contextView } from '../src/context.ts'
import type { MetricsSnapshot } from '../src/store.ts'

function env(seq: number, ts: number, ev: Record<string, unknown>): EventEnvelope {
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts, schemaVersion: 16, ev: ev as never }
}

const STATIC: CtxStatic = {
  trusted: true,
  rules: ['AGENTS.md', 'docs/rules.md'],
  skillsTotal: 42,
  mcp: [{ server: 'github', tools: ['mcp.github.create_issue'] }],
  strategy: 'compact',
  thresholdPercent: 70,
  pending: { soul: false, rules: false, catalog: false, skills: false },
}

const METRICS = {
  contextTokens: 40_000,
  contextMaxTokens: 150_000,
  cacheHitPercent: 55,
  cost: '¥0.32',
  contextPercent: 40,
} as const satisfies Partial<MetricsSnapshot>

const LAYERS = [
  { id: 'builtin.identity', role: 'system' as const, cacheable: true, approxTokens: 400 },
  { id: 'builtin.guardrail', role: 'system' as const, cacheable: true, approxTokens: 300 },
  { id: 'builtin.conventions', role: 'system' as const, cacheable: true, approxTokens: 200 },
  { id: 'builtin.workspace', role: 'system' as const, cacheable: false, approxTokens: 100 },
  { id: 'builtin.soul', role: 'system' as const, cacheable: true, approxTokens: 1_500 },
  { id: 'project.rules', role: 'system' as const, cacheable: true, approxTokens: 800 },
  { id: 'builtin.skills', role: 'system' as const, cacheable: true, approxTokens: 600 },
  { id: 'session.plan', role: 'user' as const, cacheable: false, approxTokens: 250 },
]

function req(seq: number, ts: number): EventEnvelope {
  return env(seq, ts, {
    t: 'model.request',
    provider: 'x',
    model: 'm',
    tokensIn: 5,
    ctx: { layers: LAYERS, tools: 4_000, history: 25_000 },
  })
}

describe('contextView · 九段映射（AC-1）', () => {
  test('内置层 / Soul / 项目规矩 / 技能目录 / 计划分组合并；工具与历史估算单列', () => {
    const evs = [env(1, 1000, { t: 'user.input', text: 'a' }), req(2, 2000)]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.hasLayers).toBe(true)
    const seg = Object.fromEntries(v.segments.map((s) => [s.id, s.tokens]))
    expect(seg.builtin).toBe(400 + 300 + 200 + 100)
    expect(seg.soul).toBe(1_500)
    expect(seg.rules).toBe(800)
    expect(seg.skills).toBe(600)
    expect(seg.plan).toBe(250)
    expect(seg.tools).toBe(4_000)
    expect(seg.history).toBe(25_000)
  })

  test('AC-1 · 未归类差额 = 真实总量 − 估算和；为负归零并标「估算偏差」', () => {
    const evs = [env(1, 1000, { t: 'user.input', text: 'a' }), req(2, 2000)]
    const v = contextView(evs, METRICS, STATIC)
    const est = v.segments.reduce((n, s) => n + s.tokens, 0)
    expect(v.unclassified).toBe(40_000 - est)
    expect(v.deviation).toBe(false)

    // 估算超过真实总量 → 归零 + deviation
    const v2 = contextView(evs, { ...METRICS, contextTokens: 1_000 }, STATIC)
    const est2 = v2.segments.reduce((n, s) => n + s.tokens, 0)
    expect(est2).toBeGreaterThan(1_000)
    expect(v2.unclassified).toBe(0)
    expect(v2.deviation).toBe(true)
  })

  test('附件段 = 窗口内 uploads size/4 + 图片数 ×1600（约）', () => {
    const evs = [
      env(1, 1000, {
        t: 'user.input',
        text: 'a',
        uploads: [
          { id: 'u1', name: 'a.txt', mime: 'text/plain', size: 4_000 },
          { id: 'u2', name: 'b.png', mime: 'image/png', size: 8_000 },
        ],
      }),
      req(2, 2000),
    ]
    const v = contextView(evs, METRICS, STATIC)
    const seg = Object.fromEntries(v.segments.map((s) => [s.id, s.tokens]))
    expect(seg.uploads).toBe(4_000 / 4 + 8_000 / 4 + 1 * 1_600)
  })

  test('没有 ctx 的请求（旧事件 / 回放）→ hasLayers=false，只有端上能估的段', () => {
    const evs = [env(1, 1000, { t: 'user.input', text: 'a' })]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.hasLayers).toBe(false)
    expect(v.segments.every((s) => s.id === 'compact' || s.id === 'uploads')).toBe(true)
  })
})

describe('contextView · 同源断言（AC-8）', () => {
  test('总量 / 窗口 / 命中率直接来自 metrics（与状态栏同源，不另算）', () => {
    const evs = [env(1, 1000, { t: 'user.input', text: 'a' }), req(2, 2000)]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.total).toBe(40_000)
    expect(v.window).toBe(150_000)
    expect(v.cacheHitPercent).toBe(55)
    expect(v.strategy).toBe('compact')
    expect(v.thresholdPercent).toBe(70)
  })
})

describe('contextView · 压缩记录（AC-4）', () => {
  test('ctx.compact / ctx.cleanup 一行（时间 / 触发 / 前后 token / 覆盖区间 / 摘要原文 / 定位 seq）', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: 'a' }),
      env(2, 2000, {
        t: 'ctx.compact',
        fromSeq: 1,
        toSeq: 10,
        keptTurns: 2,
        tokensBefore: 120_000,
        tokensAfter: 30_000,
        trigger: 'threshold',
        summary: { intent: '继续实现', filesModified: ['a.ts'], keyDecisions: [], openQuestions: [], nextSteps: [] },
      }),
      env(3, 3000, {
        t: 'ctx.cleanup',
        fromSeq: 1,
        toSeq: 20,
        tokensBefore: 30_000,
        tokensAfter: 25_000,
        saved: { dedupe: 3_000, verbose: 2_000, resolvedError: 0, stack: 0 },
        preserved: [5],
      }),
    ]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.compacts).toHaveLength(2)
    expect(v.compacts[0]).toMatchObject({
      seq: 2,
      kind: 'compact',
      fromSeq: 1,
      toSeq: 10,
      tokensBefore: 120_000,
      tokensAfter: 30_000,
      trigger: 'threshold',
    })
    expect(v.compacts[0]?.summary?.intent).toBe('继续实现')
    expect(v.compacts[1]?.kind).toBe('cleanup')
    expect(v.compacts[1]?.seq).toBe(3)
  })
})

describe('contextView · 加载清单（AC-5）', () => {
  test('最近一次请求的层清单（含 cacheable）、未信任 rules 置空、skill.load 过的、ctx.ref、附件', () => {
    const evs = [
      env(1, 1000, {
        t: 'user.input',
        text: 'a',
        uploads: [{ id: 'u1', name: 'a.txt', mime: 'text/plain', size: 100 }],
      }),
      env(2, 2000, { t: 'ctx.ref', sessionId: 's9', fromSeq: 3, toSeq: 9 }),
      env(3, 3000, { t: 'tool.call', id: 't1', name: 'skill.load', args: { name: 'html' } }),
      env(4, 4000, { t: 'tool.result', id: 't1', ok: true, payload: {} }),
      req(5, 5000),
    ]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.layers?.map((l) => l.id)).toEqual(LAYERS.map((l) => l.id))
    expect(v.layers?.every((l) => typeof l.cacheable === 'boolean')).toBe(true)
    expect(v.rules).toEqual(['AGENTS.md', 'docs/rules.md'])
    expect(v.trusted).toBe(true)
    expect(v.skillsTotal).toBe(42)
    expect(v.skills.map((s) => s.name)).toEqual(['html'])
    expect(v.refs).toHaveLength(1)
    expect(v.refs[0]).toMatchObject({ sessionId: 's9', fromSeq: 3, toSeq: 9 })
    expect(v.uploads).toHaveLength(1)
    // 未信任 → rules 不展示加载路径
    const v2 = contextView(evs, METRICS, { ...STATIC, trusted: false, rules: [] })
    expect(v2.rules).toEqual([])
    expect(v2.trusted).toBe(false)
  })
})

describe('contextView · 读过的（AC-6）', () => {
  test('fs.read / fs.glob / fs.grep 路径去重按次数排序，带首次 seq；MCP 工具调用计数', () => {
    const evs = [
      env(1, 1000, { t: 'tool.call', id: 't1', name: 'fs.read', args: { path: 'a.ts' } }),
      env(2, 2000, { t: 'tool.result', id: 't1', ok: true, payload: {} }),
      env(3, 3000, { t: 'tool.call', id: 't2', name: 'fs.read', args: { path: 'a.ts' } }),
      env(4, 4000, { t: 'tool.result', id: 't2', ok: true, payload: {} }),
      env(5, 5000, { t: 'tool.call', id: 't3', name: 'fs.glob', args: { pattern: 'src/*.ts' } }),
      env(6, 6000, { t: 'tool.result', id: 't3', ok: true, payload: { files: [] } }),
      env(7, 7000, { t: 'tool.call', id: 't4', name: 'fs.grep', args: { pattern: 'x', path: 'b.ts' } }),
      env(8, 8000, { t: 'tool.result', id: 't4', ok: true, payload: { matches: [] } }),
      env(9, 9000, { t: 'tool.call', id: 't5', name: 'mcp.github.create_issue', args: {} }),
      env(10, 10000, { t: 'tool.result', id: 't5', ok: true, payload: {} }),
    ]
    const v = contextView(evs, METRICS, STATIC)
    expect(v.reads.map((r) => [r.path, r.count])).toEqual([
      ['a.ts', 2],
      ['b.ts', 1],
      ['src/*.ts', 1],
    ])
    expect(v.reads[0]?.firstSeq).toBe(1)
    expect(v.mcpCalls).toHaveLength(1)
    expect(v.mcpCalls[0]?.server).toBe('github')
    expect(v.mcpCalls[0]?.tools[0]).toMatchObject({ name: 'mcp.github.create_issue', count: 1, firstSeq: 9 })
  })
})

describe('contextView · M15 上下文 tab 补全（PRD-M15-011）', () => {
  const EVENTS = [
    req(2, 100),
    env(3, 101, { t: 'ctx.mask', seqs: [1], reason: 'budget', freedTokens: 12_000 }),
    env(4, 102, {
      t: 'ctx.prefix.break',
      prevSeq: 2,
      nextSeq: 8,
      cause: 'plan.update',
      layer: 'session.plan',
      msgIndex: 3,
    }),
    env(5, 103, { t: 'ctx.mask', seqs: [1], reason: 'budget', freedTokens: 3_000 }),
    env(6, 104, { t: 'ctx.pin', seq: 3, pinned: true }),
    env(7, 105, { t: 'ctx.pin', seq: 3, pinned: false }),
    env(9, 106, { t: 'ctx.pin', seq: 5, pinned: true }),
  ]

  test('AC-1 · maskedTokens = ctx.mask.freedTokens 累计（用量条「已遮蔽」行）', () => {
    const v = contextView(EVENTS, METRICS, STATIC)
    expect(v.maskedTokens).toBe(15_000)
  })

  test('AC-2 · ctx.prefix.break 收集为列表（cause / layer / msgIndex 可定位）', () => {
    const v = contextView(EVENTS, METRICS, STATIC)
    expect(v.breaks).toHaveLength(1)
    expect(v.breaks[0]).toMatchObject({
      prevSeq: 2,
      nextSeq: 8,
      cause: 'plan.update',
      layer: 'session.plan',
      msgIndex: 3,
    })
  })

  test('AC-2 · avoidableLoss 透传 metrics（老 daemon 无字段 → null）', () => {
    const v = contextView(EVENTS, { ...METRICS, avoidableLoss: 799_000 }, STATIC)
    expect(v.avoidableLoss).toBe(799_000)
    const legacy = contextView(EVENTS, METRICS, STATIC)
    expect(legacy.avoidableLoss).toBeNull()
  })

  test('AC-4 · pinned 取最近状态（解钉后移除，升序）', () => {
    const v = contextView(EVENTS, METRICS, STATIC)
    expect(v.pinned).toEqual([5])
  })

  test('AC-4 · thresholdGap = 压缩阈值 − 当前占用百分比（负 = 已过阈值）', () => {
    const v = contextView(EVENTS, { ...METRICS, contextPercent: 40 }, STATIC)
    expect(v.thresholdGap).toBe(30)
    const over = contextView(EVENTS, { ...METRICS, contextPercent: 80 }, STATIC)
    expect(over.thresholdGap).toBe(-10)
    const none = contextView(
      EVENTS,
      { contextTokens: 40_000, contextMaxTokens: 150_000, cacheHitPercent: 55, cost: '¥0.32' },
      STATIC,
    )
    expect(none.thresholdGap).toBeNull()
  })
})
