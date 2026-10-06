/**
 * TASK-M14-004 · 进度 tab 纯投影测试（PRD-M14-004 AC-1…AC-6）
 * 测试先行：先写失败测试，再实现 plan.ts。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { planView, stepIntervals, subagentTree, turnSummary } from '../src/plan.ts'

function env(seq: number, ts: number, ev: Record<string, unknown>): EventEnvelope {
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts, schemaVersion: 16, ev: ev as never }
}

function planUpdate(seq: number, ts: number, steps: Array<Record<string, unknown>>): EventEnvelope {
  return env(seq, ts, { t: 'plan.update', steps })
}

describe('planView · 最后一条 plan.update 的步骤状态映射（AC-1）', () => {
  test('状态映射 + dependsOn 缩进深度', () => {
    const evs = [
      planUpdate(1, 1000, [
        { id: 'a', text: '第一步', status: 'done' },
        { id: 'b', text: '第二步', status: 'in_progress', dependsOn: ['a'] },
        { id: 'c', text: '第三步', status: 'pending', dependsOn: ['a', 'b'] },
        { id: 'd', text: '跳过步', status: 'skipped', dependsOn: ['b'] },
      ]),
    ]
    const v = planView(evs, 1)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    expect(v.steps.map((s) => s.step.status)).toEqual(['done', 'in_progress', 'pending', 'skipped'])
    expect(v.steps.map((s) => s.step.depth)).toEqual([0, 1, 2, 2])
    // 没跑过（只有一条 plan.update 且没有 in_progress 历史）→ 区间空
    expect(v.steps[0]!.started).toBe(false)
    expect(v.steps[0]!.startSeq).toBeNull()
    // 进行中 + 已用时（head − startSeq ts）
    expect(v.steps[1]!.started).toBe(true)
  })
})

describe('planView · 步骤区间规则（AC-2）', () => {
  test('回溯 in_progress 起点；之后第一条非 in_progress 的 update seq − 1 为终点；还在跑 → head', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: '开工' }),
      env(2, 2000, { t: 'tool.result', id: 't1', ok: true, payload: {} }),
      planUpdate(3, 3000, [{ id: 'a', text: 'A', status: 'in_progress' }]),
      env(4, 4000, { t: 'tool.result', id: 't2', ok: true, payload: {} }),
      planUpdate(5, 5000, [
        { id: 'a', text: 'A', status: 'done' },
        { id: 'b', text: 'B', status: 'in_progress' },
      ]),
      env(6, 6000, { t: 'tool.result', id: 't3', ok: true, payload: {} }),
      planUpdate(7, 7000, [
        { id: 'a', text: 'A', status: 'done' },
        { id: 'b', text: 'B', status: 'done' },
        { id: 'c', text: 'C', status: 'in_progress' },
      ]),
      env(8, 8000, { t: 'tool.result', id: 't4', ok: true, payload: {} }),
    ]
    const v = planView(evs, 8)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    const a = v.steps.find((s) => s.step.id === 'a')!
    expect(a.started).toBe(true)
    expect(a.startSeq).toBe(3)
    expect(a.endSeq).toBe(4) // 5 − 1
    expect(a.durationMs).toBe(4000 - 3000)
    const b = v.steps.find((s) => s.step.id === 'b')!
    expect(b.startSeq).toBe(5)
    expect(b.endSeq).toBe(6) // 7 − 1
    const c = v.steps.find((s) => s.step.id === 'c')!
    expect(c.startSeq).toBe(7)
    expect(c.endSeq).toBe(8) // 还在跑 → head
    // stepIntervals 输出给改动 tab 的 {step} 范围
    expect(stepIntervals(v)).toEqual({
      a: { startSeq: 3, endSeq: 4 },
      b: { startSeq: 5, endSeq: 6 },
      c: { startSeq: 7, endSeq: 8 },
    })
  })

  test('整份替换：id 变了 = 新步骤；旧 id 消失没 done = 未开始（不造假）', () => {
    const evs = [
      planUpdate(3, 3000, [{ id: 'old1', text: '旧步骤', status: 'in_progress' }]),
      planUpdate(8, 8000, [
        { id: 'new1', text: '新步骤一', status: 'pending' },
        { id: 'new2', text: '新步骤二', status: 'done' },
      ]),
    ]
    const v = planView(evs, 9)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    // 只投影最后一条
    expect(v.steps.map((s) => s.step.id)).toEqual(['new1', 'new2'])
    // 旧步骤没有 done → dropped 且不做成 done
    expect(v.dropped).toEqual([{ id: 'old1', text: '旧步骤', lastStatus: 'in_progress' }])
    expect(v.steps.some((s) => s.step.text === '旧步骤')).toBe(false)
    // 新步骤自己从零算区间
    expect(v.steps[0]!.started).toBe(false)
  })

  test('同 id 换 text = 同一步骤（id 优先）；id 不同但 text 相同 = 按 text 对齐', () => {
    const evs = [
      planUpdate(3, 3000, [{ id: 'x', text: '旧文案', status: 'in_progress' }]),
      planUpdate(9, 9000, [
        { id: 'x', text: '新文案', status: 'done' },
        { id: 'y', text: '旧文案', status: 'pending' },
      ]),
    ]
    const v = planView(evs, 10)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    const x = v.steps.find((s) => s.step.id === 'x')!
    // id 相同：改文案仍是同一步骤，区间贯通
    expect(x.startSeq).toBe(3)
    expect(x.endSeq).toBe(8)
    const y = v.steps.find((s) => s.step.id === 'y')!
    // id 不同但 text 命中旧步骤 → 也视为跑过（按 text 匹配，SPEC 取舍-1）
    expect(y.startSeq).toBe(3)
    expect(y.endSeq).toBe(8)
  })
})

describe('planView · 每步内容（AC-2）+ 子 agent / DAG 归属（AC-3）', () => {
  test('工具调用计数+摘要、改过的文件、耗时、token；task.spawn / task.node 挂到区间', () => {
    const evs = [
      planUpdate(2, 2000, [{ id: 's', text: '做事情', status: 'in_progress' }]),
      env(3, 3000, { t: 'fs.write', path: 'a.txt' }),
      env(4, 4000, { t: 'tool.call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: 'x' } }),
      env(5, 5000, { t: 'fs.snapshot', path: 'a.txt', phase: 'before', sha256: null, bytes: 1 }),
      env(6, 6000, { t: 'fs.snapshot', path: 'b.txt', phase: 'before', sha256: null, bytes: 2 }),
      env(7, 7000, { t: 'tool.call', id: 'c2', name: 'shell.exec', args: { command: 'bun test' } }),
      env(8, 8000, { t: 'model.usage', raw: { inputTokens: 100, outputTokens: 50 } }),
      env(9, 9000, { t: 'task.spawn', childSessionId: 'sub1', goal: '写个测试' }),
      env(10, 10000, { t: 'task.node', nodeId: 'n1', status: 'done', attempt: 1, ms: 500 }),
      env(11, 11000, { t: 'fs.snapshot', path: 'a.txt', phase: 'after', sha256: 'h', bytes: 2 }),
      planUpdate(12, 12000, [{ id: 's', text: '做事情', status: 'done' }]),
    ]
    const v = planView(evs, 12)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    const s = v.steps[0]!
    expect(s.started).toBe(true)
    expect(s.startSeq).toBe(2)
    expect(s.endSeq).toBe(11)
    expect(s.durationMs).toBe(11000 - 2000)
    expect(s.toolCalls).toBe(2)
    expect(s.toolBreakdown).toEqual([
      { name: 'fs.write', count: 1 },
      { name: 'shell.exec', count: 1 },
    ])
    // fs.snapshot 路径去重（a.txt 出现两次）
    expect(s.files).toEqual(['a.txt', 'b.txt'])
    expect(s.tokens).toBe(150)
    expect(s.subagents).toEqual([{ seq: 9, sessionId: 'sub1', goal: '写个测试', status: 'spawned' }])
    expect(s.nodes).toEqual([{ seq: 10, nodeId: 'n1', status: 'done', attempt: 1, ms: 500 }])
    // subagentTree：扁平列表带步骤归属
    const tree = subagentTree(v)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.stepId).toBe('s')
    expect(tree[0]!.subagents[0]!.sessionId).toBe('sub1')
  })

  test('task.end 投影子会话状态（done/failed）；区间外的子 agent 不归属', () => {
    const evs = [
      planUpdate(2, 2000, [{ id: 's', text: '跑子任务', status: 'in_progress' }]),
      env(4, 4000, { t: 'task.spawn', childSessionId: 'sub1', goal: 'G1' }),
      env(5, 5000, { t: 'task.end', status: 'done' }),
      env(8, 8000, { t: 'task.spawn', childSessionId: 'sub2', goal: 'G2' }),
      planUpdate(9, 9000, [{ id: 's', text: '跑子任务', status: 'done' }]),
      env(12, 12000, { t: 'task.spawn', childSessionId: 'sub3', goal: '区间外' }),
    ]
    const v = planView(evs, 12)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    const s = v.steps[0]!
    expect(s.subagents.map((x) => x.sessionId)).toEqual(['sub1', 'sub2'])
    expect(s.subagents[0]!.status).toBe('done') // task.end 之后
    // 区间外的 spawn 不属于任何步骤
    expect(v.steps.every((x) => x.subagents.every((g) => g.sessionId !== 'sub3'))).toBe(true)
  })
})

describe('planView · 无计划 → 本轮动作摘要（AC-5）', () => {
  test('类别计数 + 最近 5 个动作（工具名 + 参数摘要）', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: '你好' }),
      env(2, 2000, { t: 'tool.call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: 'xxxx' } }),
      env(3, 3000, { t: 'tool.call', id: 'c2', name: 'shell.exec', args: { command: 'bun test --long-flag-name' } }),
      env(4, 4000, { t: 'tool.call', id: 'c3', name: 'memory.add', args: { text: '记住' } }),
      env(5, 5000, { t: 'tool.call', id: 'c4', name: 'task.spawn', args: { goal: 'G' } }),
      env(6, 6000, { t: 'tool.call', id: 'c5', name: 'skill.use', args: { name: 'sheet' } }),
      env(7, 7000, { t: 'tool.call', id: 'c6', name: 'mcp.call', args: { server: 'x' } }),
      env(8, 8000, { t: 'tool.call', id: 'c7', name: 'custom.thing', args: {} }),
      env(9, 9000, { t: 'user.input', text: '继续' }),
      env(10, 10000, { t: 'tool.call', id: 'c8', name: 'fs.edit', args: { path: 'b.ts', content: 'y' } }),
    ]
    // 本轮 = 最后一个 user.input（seq 9）起 → 只算 c8
    const s = turnSummary(evs, 10)
    expect(s.kind).toBe('summary')
    expect(s.counts).toEqual({ fs: 1, shell: 0, memory: 0, task: 0, skill: 0, mcp: 0, other: 0 })
    expect(s.total).toBe(1)
    expect(s.recent).toHaveLength(1)
    expect(s.recent[0]!.name).toBe('fs.edit')
    expect(s.recent[0]!.summary).toContain('b.ts')
    // 只看第一轮（没有第二个 user.input）→ 7 类各 1
    const s2 = turnSummary(evs, 8)
    expect(s2.counts).toEqual({ fs: 1, shell: 1, memory: 1, task: 1, skill: 1, mcp: 1, other: 1 })
    expect(s2.total).toBe(7)
    expect(s2.recent).toHaveLength(5)
    // 最近 5 个动作（按 seq 新到旧）：c7..c3
    expect(s2.recent.map((r) => r.name)).toEqual(['custom.thing', 'mcp.call', 'skill.use', 'task.spawn', 'memory.add'])
  })

  test('planView 对自由会话（无 plan.update）降级为摘要视图', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: 'hi' }),
      env(2, 2000, { t: 'tool.call', id: 'c', name: 'fs.write', args: { path: 'a' } }),
    ]
    const v = planView(evs, 2)
    expect(v.kind).toBe('summary')
  })
})

describe('planView · 底部固定区投影（AC-4）', () => {
  test('verify.required 取最近一次（第几次 / 是否最后一次）+ 剩余步数', () => {
    const evs = [
      planUpdate(1, 1000, [
        { id: 'a', text: 'A', status: 'done' },
        { id: 'b', text: 'B', status: 'pending' },
        { id: 'c', text: 'C', status: 'skipped' },
      ]),
      env(2, 2000, { t: 'verify.required', attempt: 1, message: '先验证', final: false }),
      env(3, 3000, { t: 'verify.required', attempt: 2, message: '还是不行', final: true }),
    ]
    const v = planView(evs, 3)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    expect(v.verify).toEqual({ attempt: 2, final: true, message: '还是不行' })
    // 剩 1 步（done/skipped 不算）
    expect(v.remaining).toBe(1)
  })

  test('没有 verify.required → verify null；空计划 → remaining 0', () => {
    const v = planView([planUpdate(1, 1000, [])], 1)
    expect(v.kind).toBe('plan')
    if (v.kind !== 'plan') return
    expect(v.verify).toBeNull()
    expect(v.remaining).toBe(0)
  })
})
