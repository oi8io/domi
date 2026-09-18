/**
 * PRD-M7-009 · 任务预算（AC-1 / AC-2）· SPEC-M7-009
 *
 * 每次工具调用都往一个日志文件里追加一行：「暂停发生在越限后的第一个工具调用之前」
 * 断言的是**副作用**（日志行数），不只是事件——被拦下的那一次绝不能已经执行了。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider, type StubTurn } from '@domi/model'
import { DomiSession, effectiveLimits, type PendingAsk, usage } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-budget-')))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

/** 每轮一次工具调用（追加一行日志）+ 一点 token 用量；永远不停——停不停由预算决定 */
const loop =
  (usageTokens = 100): StubTurn =>
  (_req, i) => [
    { type: 'usage', raw: { input_tokens: usageTokens, output_tokens: 0 } },
    { type: 'tool-call', id: `c${i}`, name: 'shell.exec', args: { cmd: `echo ${i} >> calls.log` } },
  ]

function session(o: {
  budget?: unknown
  turns?: StubTurn[]
  answer?: (a: PendingAsk) => void
  db?: string
  cwd?: string
}) {
  const cwd = o.cwd ?? tmp()
  const s = new DomiSession({
    config: ConfigSchema.parse({
      model: { provider: 'anthropic', name: 'm', apiKey: 'k' },
      permissions: { rules: [{ name: 's', capability: 'shell.exec', decision: 'allow' }] },
      verify: { enabled: false },
      ...(o.budget === undefined ? {} : { budget: o.budget }),
    }),
    sessionId: 's1',
    cwd,
    dbPath: o.db ?? join(tmp(), 'e.db'),
    clock,
    provider: new StubProvider(o.turns ?? [loop()], { onExhausted: 'repeat-last' }),
  })
  const asks: PendingAsk[] = []
  if (o.answer) {
    const answer = o.answer
    s.on('onAsk', (a) => {
      if (!a) return
      asks.push(a)
      answer(a)
    })
  }
  const calls = (): number =>
    existsSync(join(cwd, 'calls.log')) ? readFileSync(join(cwd, 'calls.log'), 'utf8').trim().split('\n').length : 0
  const evs = async () => (await s.pumpAll()).map((e) => e.ev as Record<string, unknown> & { t: string })
  return { s, asks, calls, evs, cwd }
}

describe('PRD-M7-009 AC-1 · 上限：80% 提醒，100% 暂停转人工', () => {
  test('工具调用次数：到 80% 落一次 budget.warn；越限的那一次调用被拦在执行之前，选「停止」就结束这一轮', async () => {
    const { s, asks, calls, evs } = session({ budget: { toolCalls: 5 }, answer: (a) => a.answer(false) })
    await s.submit('一直干')
    expect(calls()).toBe(5)
    const all = await evs()
    const warns = all.filter((e) => e.t === 'budget.warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatchObject({ kind: 'toolCalls', limit: 5 })
    expect(asks.map((a) => a.capabilityId)).toEqual(['budget.exceeded'])
    expect(all.find((e) => e.t === 'budget.decided')).toMatchObject({ action: 'stop', kind: 'toolCalls' })
    // 第 6 次调用有 tool.call，结果是 budget_stop，没有执行
    const last = all.filter((e) => e.t === 'tool.result').at(-1)
    expect(last).toMatchObject({ ok: false, reason: 'budget_stop' })
    await s.flushAndClose()
  }, 20_000)

  test('提高上限：按用户给的新上限继续，到新上限再问', async () => {
    let n = 0
    const { s, calls, evs } = session({
      budget: { toolCalls: 3 },
      answer: (a) => (++n === 1 ? a.answer(true, { action: 'raise', limit: 6 }) : a.answer(false)),
    })
    await s.submit('一直干')
    expect(calls()).toBe(6)
    const decided = (await evs()).filter((e) => e.t === 'budget.decided')
    expect(decided.map((d) => [d.action, d.limit])).toEqual([
      ['raise', 6],
      ['stop', undefined],
    ])
    await s.flushAndClose()
  }, 20_000)

  test('继续：上限放宽一半', async () => {
    let n = 0
    const { s, calls } = session({
      budget: { toolCalls: 4 },
      answer: (a) => (++n === 1 ? a.answer(true, { action: 'continue' }) : a.answer(false)),
    })
    await s.submit('一直干')
    expect(calls()).toBe(6)
    await s.flushAndClose()
  }, 20_000)

  test('token 上限：到顶就停（没人能回答 = 停止），不多执行一次', async () => {
    const { s, calls, evs } = session({ budget: { tokens: 350 } })
    await s.submit('一直干')
    // 每轮 100 token：第 4 轮请求后到 400 ≥ 350，那一轮的调用被拦
    expect(calls()).toBe(3)
    expect((await evs()).find((e) => e.t === 'budget.decided')).toMatchObject({ action: 'stop', kind: 'tokens' })
    await s.flushAndClose()
  }, 20_000)

  test('会话 / 长任务节点单独设的上限（setBudget）覆盖配置，并落事件', async () => {
    const { s, calls, evs } = session({ budget: { toolCalls: 100 } })
    await s.setBudget({ toolCalls: 2 })
    await s.submit('一直干')
    expect(calls()).toBe(2)
    expect((await evs()).find((e) => e.t === 'budget.decided')).toMatchObject({
      action: 'raise',
      kind: 'toolCalls',
      limit: 2,
    })
    await s.flushAndClose()
  }, 20_000)
})

describe('PRD-M7-009 AC-2 · 用量只从事件投影', () => {
  test('usage / effectiveLimits 只读事件；重开会话后已用量从事件接着算，不从 0 重新开始', async () => {
    const cwd = tmp()
    const db = join(tmp(), 'e.db')
    const a = session({ db, cwd })
    await a.s.setBudget({ toolCalls: 3 })
    await a.s.submit('干')
    expect(a.calls()).toBe(3)
    const events = await a.s.pumpAll()
    expect(usage(events, {}).toolCalls).toBe(4) // 第 4 次有 tool.call，但被拦下没执行
    expect(effectiveLimits({}, events).toolCalls).toBe(3)
    await a.s.flushAndClose()

    // 重开：配置里没写上限，会话里设过的从事件恢复；已经在上限上，新的一轮一个调用都不执行
    const b = session({ db, cwd })
    await b.s.submit('再干')
    expect(b.calls()).toBe(3)
    const reopened = await b.s.pumpAll()
    expect(effectiveLimits({}, reopened).toolCalls).toBe(3)
    expect(
      reopened.filter((e) => e.ev.t === 'budget.decided' && (e.ev as { action: string }).action === 'stop'),
    ).toHaveLength(2)
    await b.s.flushAndClose()
  }, 30_000)
})
