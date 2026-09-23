/**
 * 计划流 —— PRD-M12-004 AC-5 / AC-6 / AC-8 / AC-9 · SPEC-M12-004 第二轮 取舍-2 / 3
 *
 * 计划必须（任务强制、会话可选）；审批跟确认模式走；阻止提示优先级最高；计划常驻上下文、重开还在；
 * 审批时可转长任务。闸门拒绝的调用不落 permission 事件、这一轮不结束。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { type EventEnvelope, questionsOf } from '@domi/protocol'
import { blockingHint, DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-plan-'))
  dirs.push(d)
  return d
}

const config = ConfigSchema.parse({
  model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
  permissions: { rules: [{ name: 'w', capability: 'fs.write', decision: 'allow' }] },
})

const STEPS = [
  { id: 's1', text: '读现有实现', status: 'done' },
  { id: 's2', text: '写 a.txt', status: 'in_progress' },
  { id: 's3', text: '跑测试', status: 'pending' },
]
const plan = (id: string, steps: unknown = STEPS) => ({ type: 'tool-call', id, name: 'plan.update', args: { steps } })
const write = (id: string) => ({ type: 'tool-call', id, name: 'fs.write', args: { path: 'a.txt', content: 'x\n' } })
const done = { type: 'delta', text: '好了' }

type Turn = Array<Record<string, unknown>>

function open(o: {
  script: Turn[]
  planRequired?: boolean
  mode?: 'always-ask' | 'on-demand' | 'allow-all'
  answer?: (a: PendingAsk) => void
  cwd?: string
  db?: string
  startTask?: (spec: unknown) => Promise<string>
}) {
  const cwd = o.cwd ?? tmp()
  const provider = new StubProvider(o.script as never, { onExhausted: 'repeat-last' })
  const s = new DomiSession({
    config,
    sessionId: 's1',
    cwd,
    dbPath: o.db ?? join(tmp(), 'e.db'),
    provider,
    ...(o.planRequired === undefined ? {} : { planRequired: o.planRequired }),
    ...(o.startTask ? { startTask: (spec: unknown) => o.startTask!(spec) } : {}),
  })
  const asks: PendingAsk[] = []
  s.on('onAsk', (a) => {
    if (!a) return
    asks.push(a)
    if (o.answer) o.answer(a)
    else a.answer(true)
  })
  return { s, asks, cwd, provider, mode: o.mode }
}

async function run(h: ReturnType<typeof open>, text: string): Promise<EventEnvelope[]> {
  if (h.mode) await h.s.setPermissionsMode(h.mode)
  await h.s.submit(text)
  return h.s.pumpAll()
}
const results = (evs: EventEnvelope[]) =>
  evs.filter((e) => e.ev.t === 'tool.result').map((e) => e.ev as { id: string; ok: boolean; reason?: string })
const approveAnswer = (label: string, other?: string) => (a: PendingAsk) => {
  if (a.capabilityId === 'plan.update')
    a.answer(true, { answers: [{ selected: label ? [label] : [], ...(other ? { other } : {}) }] })
  else a.answer(true)
}

describe('PRD-M12-004 AC-9 · 阻止提示', () => {
  test('中文与英文的「先别动」都认', () => {
    for (const t of [
      '先别动代码，给我个方案',
      '先给方案，我确认后再改',
      '不要直接改，等我确认',
      '只要计划，别急着动手',
      "Don't start yet, just give me a plan",
      'wait for my approval before changing anything',
      'plan only please',
    ]) {
      expect(blockingHint(t)).not.toBeNull()
    }
  })
  test('普通的请求不算', () => {
    for (const t of [
      '把 a.txt 改成 x',
      '修一下这个 bug',
      '不要用 lodash，直接写',
      '别忘了跑测试',
      'fix the failing test',
    ]) {
      expect(blockingHint(t)).toBeNull()
    }
  })
})

describe('PRD-M12-004 AC-8 · 计划必须（任务强制）', () => {
  test('任务里没写计划就动手：被拦下（plan_required，不落 permission），这一轮不结束；写了计划再动手就行', async () => {
    const h = open({ planRequired: true, script: [[write('w1')], [plan('p1')], [write('w2')], [done]] })
    const evs = await run(h, '把 a.txt 写成 x')
    const r = results(evs)
    expect(r.map((x) => [x.id, x.ok, x.reason])).toEqual([
      ['w1', false, 'plan_required'],
      ['p1', true, undefined],
      ['w2', true, undefined],
    ])
    const perms = evs.filter((e) => e.ev.t === 'permission').map((e) => (e.ev as { capabilityId: string }).capabilityId)
    expect(perms).toEqual(['plan.update', 'fs.write'])
    expect(evs.find((e) => e.ev.t === 'plan.update')?.ev).toMatchObject({ steps: STEPS })
    expect(existsSync(join(h.cwd, 'a.txt'))).toBe(true)
    await h.s.flushAndClose()
  })

  test('只读的工具不用计划：读文件、问用户、写计划本身', async () => {
    const h = open({
      planRequired: true,
      script: [[{ type: 'tool-call', id: 'r1', name: 'fs.read', args: { path: 'nope.txt' } }], [done]],
    })
    const r = results(await run(h, '看看'))
    expect(r[0]?.reason).not.toBe('plan_required')
    await h.s.flushAndClose()
  })

  test('自由会话不强制：没计划照样能写', async () => {
    const h = open({ script: [[write('w1')], [done]] })
    expect(results(await run(h, '写'))[0]).toMatchObject({ ok: true })
    await h.s.flushAndClose()
  })

  test('计划常驻上下文：下一次请求模型时带着步骤与状态', async () => {
    const h = open({ planRequired: true, script: [[plan('p1')], [done]] })
    await run(h, '开始')
    // calls[0] 是写计划前的那次请求，calls[1] 是写完计划之后的（再往后是自动起标题，不算）
    const last = JSON.stringify(h.provider.calls[1])
    expect(last).toContain('读现有实现')
    expect(last).toContain('[x]')
    expect(last).toContain('[>]')
    await h.s.flushAndClose()
  })

  test('任务里还没有计划时，提示词里写明先写计划', async () => {
    const h = open({ planRequired: true, script: [[done]] })
    await run(h, '开始')
    expect(JSON.stringify(h.provider.calls[0])).toContain('先用 plan.update 写出计划')
    await h.s.flushAndClose()
  })

  test('重开会话：计划从事件流恢复，不用再写就能动手', async () => {
    const cwd = tmp()
    const db = join(tmp(), 'e.db')
    const a = open({ planRequired: true, cwd, db, script: [[plan('p1')], [done]] })
    await run(a, '先写计划')
    await a.s.flushAndClose()
    const b = open({ planRequired: true, cwd, db, script: [[write('w1')], [done]] })
    const r = results(await run(b, '继续'))
    expect(r.at(-1)).toMatchObject({ id: 'w1', ok: true })
    await b.s.flushAndClose()
  })

  test('计划参数不合法（没有步骤）→ 参数错，不算写了计划', async () => {
    const h = open({ planRequired: true, script: [[plan('p1', [])], [write('w1')], [done]] })
    const r = results(await run(h, '开始'))
    expect(r.map((x) => x.reason)).toEqual(['invalid_args', 'plan_required'])
    await h.s.flushAndClose()
  })
})

describe('PRD-M12-004 AC-9 · 审批跟确认模式走', () => {
  test('每次都问：写出计划就弹审批问题框；批准后才能动手，落 plan.decided（source: user）', async () => {
    const h = open({
      planRequired: true,
      mode: 'always-ask',
      answer: approveAnswer('批准，开始执行'),
      script: [[plan('p1')], [write('w1')], [done]],
    })
    const evs = await run(h, '开始')
    const approval = h.asks.find((a) => a.capabilityId === 'plan.update')
    expect(questionsOf(approval?.form?.schema)?.[0]?.options.map((o) => o.label)).toContain('批准，开始执行')
    expect(evs.find((e) => e.ev.t === 'plan.decided')?.ev).toMatchObject({ approved: true, source: 'user' })
    expect(results(evs).at(-1)).toMatchObject({ id: 'w1', ok: true })
    await h.s.flushAndClose()
  })

  test('驳回（写了修改意见）：意见交给模型；没批准前动手被拦（plan_unapproved）', async () => {
    const h = open({
      planRequired: true,
      mode: 'always-ask',
      answer: approveAnswer('', '第二步别改 a.txt'),
      script: [[plan('p1')], [write('w1')], [done]],
    })
    const evs = await run(h, '开始')
    expect(evs.find((e) => e.ev.t === 'plan.decided')?.ev).toMatchObject({
      approved: false,
      comment: '第二步别改 a.txt',
    })
    const r = results(evs)
    expect(JSON.stringify(r[0])).toContain('第二步别改 a.txt')
    expect(r.at(-1)).toMatchObject({ id: 'w1', ok: false, reason: 'plan_unapproved' })
    await h.s.flushAndClose()
  })

  test('只改步骤状态不用重新批准；步骤变了要重新批准', async () => {
    const moved = STEPS.map((s) => (s.id === 's2' ? { ...s, status: 'done' } : s))
    const changed = [...STEPS, { id: 's4', text: '顺手重构', status: 'pending' }]
    const h = open({
      planRequired: true,
      mode: 'always-ask',
      answer: approveAnswer('批准，开始执行'),
      script: [[plan('p1')], [plan('p2', moved)], [plan('p3', changed)], [done]],
    })
    await run(h, '开始')
    expect(h.asks.filter((a) => a.capabilityId === 'plan.update')).toHaveLength(2)
    await h.s.flushAndClose()
  })

  test('按需 + 阻止提示：要批准', async () => {
    const h = open({ planRequired: true, answer: approveAnswer('批准，开始执行'), script: [[plan('p1')], [done]] })
    await run(h, '先别动代码，给我个方案')
    expect(h.asks.filter((a) => a.capabilityId === 'plan.update')).toHaveLength(1)
    await h.s.flushAndClose()
  })

  test('按需、没有阻止提示：不审批，写完计划直接干', async () => {
    const h = open({ planRequired: true, script: [[plan('p1')], [write('w1')], [done]] })
    const evs = await run(h, '把 a.txt 写成 x')
    expect(h.asks.filter((a) => a.capabilityId === 'plan.update')).toHaveLength(0)
    expect(evs.some((e) => e.ev.t === 'plan.decided')).toBe(false)
    expect(results(evs).at(-1)).toMatchObject({ ok: true })
    await h.s.flushAndClose()
  })

  test('全部放行：有阻止提示也不审批', async () => {
    const h = open({ planRequired: true, mode: 'allow-all', script: [[plan('p1')], [write('w1')], [done]] })
    const evs = await run(h, '先别动代码，给我个方案')
    expect(h.asks).toHaveLength(0)
    expect(results(evs).at(-1)).toMatchObject({ ok: true })
    await h.s.flushAndClose()
  })

  test('自由会话里用户说了「先别动」：没有批准过的计划就不能动手', async () => {
    const h = open({ script: [[write('w1')], [done]] })
    const r = results(await run(h, '先别动，给我个方案'))
    expect(r[0]).toMatchObject({ ok: false, reason: 'plan_unapproved' })
    await h.s.flushAndClose()
  })

  test('没人能审批（非交互）：不算批准，动手被拦', async () => {
    const provider = new StubProvider([[plan('p1')], [write('w1')], [done]] as never, { onExhausted: 'repeat-last' })
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider,
      planRequired: true,
    })
    await s.setPermissionsMode('always-ask')
    await s.submit('开始')
    const r = results(await s.pumpAll())
    expect(r.at(-1)).toMatchObject({ ok: false, reason: 'plan_unapproved' })
    await s.flushAndClose()
  })
})

describe('PRD-M12-004 AC-5 · 批准并转成长任务', () => {
  test('选「批准并转成长任务」：步骤变成 DAG 交给 startTask，结果告诉模型别在本会话接着做', async () => {
    const specs: unknown[] = []
    const h = open({
      planRequired: true,
      mode: 'always-ask',
      answer: approveAnswer('批准并转成长任务'),
      startTask: async (spec) => {
        specs.push(spec)
        return 'run-1'
      },
      script: [[plan('p1')], [done]],
    })
    const evs = await run(h, '开始')
    // 已经做完的步骤不再进长任务
    expect((specs[0] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(['s2', 's3'])
    expect(evs.find((e) => e.ev.t === 'plan.decided')?.ev).toMatchObject({
      approved: true,
      asTask: true,
      runId: 'run-1',
    })
    expect(JSON.stringify(results(evs)[0])).toContain('run-1')
    await h.s.flushAndClose()
  })
})

describe('PRD-M12-004 AC-10 · 续跑要的计划进度', () => {
  const env = (seq: number, ev: Record<string, unknown>) =>
    ({ seq, sessionId: 's', parentSeq: seq - 1 || null, ts: seq, schemaVersion: 14, ev }) as EventEnvelope

  test('没有计划 → null；有计划 → 总数与剩余（done / skipped 不算剩余）', async () => {
    const { planProgress } = await import('../src/index.ts')
    expect(planProgress([env(1, { t: 'user.input', text: 'x' })])).toBeNull()
    expect(planProgress([env(1, { t: 'plan.update', steps: STEPS })])).toEqual({
      total: 3,
      remaining: 2,
      interrupted: false,
    })
  })

  test('计划之后出了错 / 工具被中断 → interrupted；用户再说一句就不算了', async () => {
    const { planProgress } = await import('../src/index.ts')
    const base = [env(1, { t: 'plan.update', steps: STEPS })]
    expect(
      planProgress([...base, env(2, { t: 'error', scope: 'recovery', message: 'x', recoverable: true })])?.interrupted,
    ).toBe(true)
    expect(
      planProgress([
        ...base,
        env(2, { t: 'tool.result', id: 'a', ok: false, payload: {}, ms: 0, reason: 'interrupted' }),
      ])?.interrupted,
    ).toBe(true)
    expect(
      planProgress([...base, env(2, { t: 'tool.result', id: 'a', ok: false, payload: {}, ms: 0, reason: 'not_run' })])
        ?.interrupted,
    ).toBe(true)
    expect(
      planProgress([
        ...base,
        env(2, { t: 'error', scope: 'recovery', message: 'x', recoverable: true }),
        env(3, { t: 'user.input', text: '继续' }),
      ])?.interrupted,
    ).toBe(false)
    // 被计划闸门拦下不算中断（那是正常流程）
    expect(
      planProgress([
        ...base,
        env(2, { t: 'tool.result', id: 'a', ok: false, payload: {}, ms: 0, reason: 'plan_required' }),
      ])?.interrupted,
    ).toBe(false)
  })

  test('状态栏指标带着计划进度推给端', async () => {
    const h = open({ planRequired: true, script: [[plan('p1')], [done]] })
    const seen: Array<{ plan?: unknown }> = []
    h.s.on('onMetrics', (m) => seen.push(m))
    await run(h, '开始')
    expect(seen.at(-1)?.plan).toEqual({ total: 3, remaining: 2, interrupted: false })
    await h.s.flushAndClose()
  })
})
