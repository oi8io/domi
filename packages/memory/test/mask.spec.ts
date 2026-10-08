/**
 * PRD-M15-004 · 遮蔽与清理（SPEC-M15-004 取舍-3/4 + AC-1…AC-6）
 * - 热区（最近 K=10 步且 T=32k token）原样，冷区才可遮蔽（AC-1，R4 用例：刚读的大文件仍可见）
 * - 遮蔽决定：指针文本 / 工具调用与错误保留 / 单批 ≥8k token / 已遮蔽不再变（AC-2/3）
 * - 确定性规则只作用于冷区、随批次决定（AC-4）
 * - 钉住：ctx.pin 覆盖的 seq 遮蔽跳过（AC-5）
 */
import { describe, expect, test } from 'bun:test'
import type { AnyEvent, EventEnvelope } from '@domi/protocol'
import { cleanup, projectText, type RuleId } from '../src/cleanup.ts'
import {
  applyMask,
  BATCH_MIN_FREED,
  collectMasked,
  collectPinned,
  computeMask,
  HOT_STEPS,
  partitionHotCold,
} from '../src/mask.ts'

let seqCounter = 0
function ev(ev: AnyEvent): EventEnvelope {
  seqCounter += 1
  return { seq: seqCounter, sessionId: 't', parentSeq: null, ts: 0, schemaVersion: 17, ev }
}
/** 一步：request → 调用 → 结果（默认 2000 字符 ≈ 500 token） */
function step(resultSize = 2_000, toolName = 'read', args: unknown = { path: '/a.txt' }): EventEnvelope[] {
  const id = `c${seqCounter + 1}`
  return [
    ev({
      t: 'model.request',
      provider: 'stub',
      model: 'stub-1',
      tokensIn: 0,
      messages: [],
      ctx: { layers: [], tools: 0, history: 0 },
    }),
    ev({ t: 'tool.call', id, name: toolName, args }),
    ev({ t: 'tool.result', id, ok: true, payload: 'x'.repeat(resultSize), ms: 1 }),
  ]
}
/** 连续 N 步 */
function steps(n: number, resultSize = 2_000): EventEnvelope[] {
  const out: EventEnvelope[] = []
  for (let i = 0; i < n; i++) out.push(...step(resultSize))
  return out
}
function resultSeqOf(events: EventEnvelope[], i: number): number {
  // 第 i 步（0 基）的 tool.result seq
  return events[i * 3 + 2]!.seq
}

describe('PRD-M15-004 AC-1 · 热区 / 冷区划分', () => {
  test('最近 K 步内的工具结果进热区，更早的进冷区', () => {
    const events = steps(20)
    const { hot, cold } = partitionHotCold(events)
    // 最后 HOT_STEPS 步的 tool.result 是热区
    for (let i = 20 - HOT_STEPS; i < 20; i++) expect(hot.has(resultSeqOf(events, i))).toBe(true)
    // 更早的全部是冷区
    for (let i = 0; i < 20 - HOT_STEPS; i++) expect(cold.has(resultSeqOf(events, i))).toBe(true)
    // 工具调用与请求本身不进冷区候选（不是 tool.result）
    expect(cold.size).toBe(20 - HOT_STEPS)
  })

  test('R4 复现：刚读的大文件（300 行）在热区原样，模型能看到第 150 行', () => {
    const events = [...step(6_000, 'read', { path: '/big.txt' })] // 最近一步，6000 字符
    const m = computeMask(events)
    expect(m.seqs).toEqual([]) // 热区不遮蔽
    const after = applyMask(events, m.seqs)
    // 原文还在：投影出来的文本仍含文件中部内容
    const result = after.find((e) => e.ev.t === 'tool.result')!
    expect(projectText(result.ev)).toContain('x'.repeat(100))
  })

  test('token 轴兜底：即使步数近，超 T 的工具输出也可进冷区', () => {
    // 每一步都巨大（20k 字符 ≈ 5k token），最近 12 步也远超 32k token
    const events = steps(12, 20_000)
    const { hot, cold } = partitionHotCold(events)
    // 最新的几步仍是热区（token 累加不超过 32k 的范围内）
    expect(hot.size).toBeGreaterThan(0)
    // 靠前的（累计超 32k）进冷区
    expect(cold.size).toBeGreaterThan(0)
  })
})

describe('PRD-M15-004 AC-2/3 · 遮蔽决定', () => {
  test('冷区工具结果换指针（工具名 / 参数摘要 / 原始大小 / 需要时重读），工具调用与错误保留', () => {
    const events = steps(20, 4_000) // 前 10 步冷区（每步 1k token）
    const m = computeMask(events)
    expect(m.seqs.length).toBeGreaterThan(0)
    expect(m.freedTokens).toBeGreaterThanOrEqual(BATCH_MIN_FREED)
    const after = applyMask(events, m.seqs)
    const masked = after.filter((e) => e.ev.t === 'tool.result' && m.seqs.includes(e.seq))
    for (const env of masked) {
      const text = projectText(env.ev)
      expect(text).toContain('read')
      expect(text).toContain('需要时重读')
      expect(text).toMatch(/原始 \d+ 字符/)
    }
    // 工具调用原样（没被遮蔽成指针）
    const calls = after.filter((e) => e.ev.t === 'tool.call')
    expect(calls.length).toBe(20)
  })

  test('单批至少腾出 X token：冷区太少不值得付缓存重写 → 不落事件', () => {
    const events = steps(12, 200) // 前 2 步冷区，各 ~50 token，总计远不足 8k
    const m = computeMask(events)
    expect(m.seqs).toEqual([])
    expect(m.freedTokens).toBe(0)
  })

  test('已遮蔽不再变：同一批只决定一次（INV-12）', () => {
    const events = steps(20, 4_000)
    const m1 = computeMask(events)
    expect(m1.seqs.length).toBeGreaterThan(0)
    // 把第一批遮蔽记录成 ctx.mask 事件，再算 → 已遮蔽的 seq 不再重复遮蔽
    const withMaskEv = [
      ...events,
      ev({ t: 'ctx.mask', seqs: m1.seqs, reason: 'threshold', freedTokens: m1.freedTokens }),
    ]
    const m2 = computeMask(withMaskEv)
    for (const seq of m1.seqs) expect(m2.seqs).not.toContain(seq)
  })
})

describe('PRD-M15-004 AC-4 · 确定性规则只作用于冷区', () => {
  test('热区里重复调用不去重；冷区里去重照旧', () => {
    // 同一把 read 成功调用两次：一次在冷区（第 1 步），最后一次在热区（第 11 步，是「当前状态」）
    const events = [
      ...step(2_000, 'read', { path: '/same' }), // 第 1 步：冷区
      ...steps(9, 2_000),
      ...step(2_000, 'read', { path: '/same' }), // 第 11 步：热区（最后一次）
    ]
    const { cold: coldSet } = partitionHotCold(events)
    const r = cleanup(events, { coldSeqs: coldSet })
    const applied = new Map(r.items.map((i) => [i.seq, i.appliedRules]))
    // 冷区那次被 dedupe（旧结果换指针）
    expect(applied.get(events[2]!.seq)).toContain<RuleId>('dedupe')
    // 热区都不动（AC-4：不再回溯改写热区）
    expect(applied.get(events[11 * 3 - 1]!.seq)).toEqual([])
    expect(applied.get(events[3 * 3 + 2]!.seq)).toEqual([])
  })

  test('不传 coldSeqs 时行为不变（老调用方兼容）', () => {
    const events = steps(15, 4_000)
    const r1 = cleanup(events)
    expect(r1.items.length).toBe(events.length)
  })
})

describe('PRD-M15-004 AC-5 · 钉住', () => {
  test('被钉住的冷区 seq 遮蔽跳过', () => {
    const events = [...steps(5, 6_000), ...steps(14, 2_000)]
    const pinned = resultSeqOf(events, 2) // 钉住第 3 步（冷区）
    const withPin = [...events, ev({ t: 'ctx.pin', seq: pinned, pinned: true })]
    expect(collectPinned(withPin).has(pinned)).toBe(true)
    const m = computeMask(withPin)
    expect(m.seqs).not.toContain(pinned)
    // 解钉后恢复可遮蔽
    const withUnpin = [...withPin, ev({ t: 'ctx.pin', seq: pinned, pinned: false })]
    expect(collectPinned(withUnpin).has(pinned)).toBe(false)
    const m2 = computeMask(withUnpin)
    // 这一步仍冷区且未被遮蔽过 → 重新可遮蔽
    expect(m2.seqs).toContain(pinned)
  })
})

describe('mask 辅助', () => {
  test('collectMasked 收集 ctx.mask.seqs 并集', () => {
    const events = [
      ev({ t: 'ctx.mask', seqs: [1, 2], reason: 'threshold', freedTokens: 100 }),
      ev({ t: 'ctx.mask', seqs: [3], reason: 'cold', freedTokens: 50 }),
    ]
    const s = collectMasked(events)
    expect(s.has(1) && s.has(2) && s.has(3)).toBe(true)
    expect(s.size).toBe(3)
  })
  test('常量口径：HOT_STEPS=10', () => {
    expect(HOT_STEPS).toBe(10)
  })
})
