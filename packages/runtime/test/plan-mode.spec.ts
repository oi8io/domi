/**
 * PRD-M7-005 · 计划模式（AC-1 ~ AC-3）· SPEC-M7-005
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { isTitleRequest, StubProvider, type StubTurn } from '@domi/model'
import { validateSpec } from '@domi/orchestrator'
import { z } from 'zod'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-plan-')))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

const ran: string[] = []
const fakeTool = (name: string) => ({
  name,
  capability: name,
  description: name,
  schema: z.object({}),
  execute: async () => {
    ran.push(name)
    return { ok: true }
  },
})

const PLAN = '改 a.txt：把内容换成「新」。验证：读回来看。'
const STEPS = [
  { id: 'a', goal: '改 a' },
  { id: 'b', goal: '改 b' },
  { id: 'c', goal: '汇总', dependsOn: ['a', 'b'] },
]

function session(turns: StubTurn[], o: { startTask?: (spec: unknown) => Promise<string> } = {}) {
  const cwd = tmp()
  const stub = new StubProvider(turns, { onExhausted: 'repeat-last' })
  const s = new DomiSession({
    config: ConfigSchema.parse({
      model: { provider: 'anthropic', name: 'm', apiKey: 'k' },
      // 规则全都放行：计划模式的拒绝来自模式本身，不靠规则
      permissions: {
        rules: ['fs.read', 'fs.write', 'shell.exec', 'task.spawn', 'mcp.demo.*', 'plugin.demo.*'].map((c) => ({
          name: `allow-${c}`,
          capability: c,
          decision: 'allow',
        })),
      },
      verify: { enabled: false },
    }),
    sessionId: 's1',
    cwd,
    dbPath: join(tmp(), 'e.db'),
    clock,
    provider: stub,
    extraTools: () => [fakeTool('mcp.demo.deploy'), fakeTool('plugin.demo.run')],
    ...(o.startTask ? { startTask: (spec: unknown) => (o.startTask as (s: unknown) => Promise<string>)(spec) } : {}),
  })
  s.on('onAsk', (a) => {
    // PRD-M11-005：危险能力权限问自动过；业务问（plan 审批等）不答 = 没人批（与无 listener 同义）
    if (!a) return
    const c = a.capabilityId
    const dangerous =
      c === 'fs.write' ||
      c === 'fs.delete' ||
      c === 'fs.move' ||
      c === 'fs.append' ||
      c === 'shell.exec' ||
      c === 'web.fetch' ||
      c.startsWith('mcp.') ||
      c.startsWith('plugin.')
    a.answer(dangerous)
  })
  const evs = async () => (await s.pumpAll()).map((e) => e.ev)
  return { s, stub, cwd, evs }
}

function answerPlan(s: DomiSession, allowed: boolean, content?: Record<string, unknown>): PendingAsk[] {
  const seen: PendingAsk[] = []
  s.on('onAsk', (a) => {
    if (!a) return
    seen.push(a)
    a.answer(allowed, content)
  })
  return seen
}

const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
  ({ type: 'tool-call', id, name, args }) as const

describe('PRD-M7-005 AC-1 · 计划模式下写能力一律拒绝，来源是 mode', () => {
  test('fs.write / shell.exec / task.spawn / MCP / 插件工具都被拒，各落一条 permission（source: mode）；读照常', async () => {
    ran.length = 0
    const { s, cwd, evs } = session([
      [
        call('c1', 'fs.write', { path: 'a.txt', content: 'x' }),
        call('c2', 'shell.exec', { cmd: 'touch SHELL_RAN' }),
        call('c3', 'task.spawn', { goal: '去做' }),
        call('c4', 'mcp.demo.deploy'),
        call('c5', 'plugin.demo.run'),
        call('c6', 'fs.glob', { pattern: '*' }),
      ],
      [{ type: 'delta', text: '只能读' }],
    ])
    await s.setMode('plan')
    await s.submit('做点事')
    const perms = (await evs()).filter((e) => e.t === 'permission') as Array<{
      capabilityId: string
      decision: string
      source: string
    }>
    const byCap = Object.fromEntries(perms.map((p) => [p.capabilityId, p]))
    for (const c of ['fs.write', 'shell.exec', 'task.spawn', 'mcp.demo.deploy', 'plugin.demo.run']) {
      expect(byCap[c]).toMatchObject({ decision: 'deny', source: 'mode' })
    }
    expect(byCap['fs.read']).toMatchObject({ decision: 'allow', source: 'config' })
    expect(existsSync(join(cwd, 'a.txt'))).toBe(false)
    expect(existsSync(join(cwd, 'SHELL_RAN'))).toBe(false)
    expect(ran).toEqual([])
    await s.flushAndClose()
  })

  test('plan.submit 在执行模式下不发给模型；计划模式下才在工具清单里', async () => {
    const { s, stub } = session([[{ type: 'delta', text: '好' }]])
    await s.submit('一')
    expect(stub.calls[0]?.tools?.some((t) => t.name === 'plan.submit')).toBe(false)
    await s.setMode('plan')
    await s.submit('二')
    const lastDialogue = stub.calls.filter((c) => !isTitleRequest(c)).at(-1)
    expect(lastDialogue?.tools?.some((t) => t.name === 'plan.submit')).toBe(true)
    await s.flushAndClose()
  })
})

describe('PRD-M7-005 AC-2 · plan.proposed / plan.decided，批准后切回执行模式并保留计划', () => {
  test('批准（带意见）：落两条事件、切回 act，接着按计划写文件；之后的请求里还有计划原文', async () => {
    const { s, stub, cwd, evs } = session([
      [call('p1', 'plan.submit', { plan: PLAN })],
      [call('w1', 'fs.write', { path: 'a.txt', content: '新' })],
      [{ type: 'delta', text: '改好了' }],
    ])
    const asks = answerPlan(s, true, { comment: '顺手加个换行' })
    await s.setMode('plan')
    await s.submit('先出个计划')
    const all = await evs()
    expect(asks.map((a) => a.capabilityId)).toEqual(['plan.input', 'fs.write']) // PRD-M11-005：fs.write 危险要问
    expect(all.find((e) => e.t === 'plan.proposed')).toMatchObject({ plan: PLAN })
    expect(all.find((e) => e.t === 'plan.decided')).toMatchObject({
      approved: true,
      comment: '顺手加个换行',
      source: 'user',
    })
    expect(all.filter((e) => e.t === 'mode.switch').at(-1)).toMatchObject({ to: 'act' })
    expect(s.getMode()).toBe('act')
    expect(await Bun.file(join(cwd, 'a.txt')).text()).toBe('新')
    // 标题生成调用会记进 calls 且时序不定：断言最后一次**对话**调用
    const last = stub.calls.filter((c) => !isTitleRequest(c)).at(-1)
    expect(JSON.stringify(last?.messages)).toContain(PLAN)
    expect(JSON.stringify(last?.messages)).toContain('顺手加个换行')
    await s.flushAndClose()
  })

  test('驳回（带意见）：plan.decided 记下意见，仍在计划模式，意见回给模型', async () => {
    const { s, stub, evs } = session([
      [call('p1', 'plan.submit', { plan: PLAN })],
      [{ type: 'delta', text: '我改改计划' }],
    ])
    answerPlan(s, false, { comment: '不要动 lockfile' })
    await s.setMode('plan')
    await s.submit('先出个计划')
    expect((await evs()).find((e) => e.t === 'plan.decided')).toMatchObject({
      approved: false,
      comment: '不要动 lockfile',
    })
    expect(s.getMode()).toBe('plan')
    expect(JSON.stringify(stub.calls.filter((c) => !isTitleRequest(c)).at(-1)?.messages)).toContain('不要动 lockfile')
    await s.flushAndClose()
  })

  test('没人能审批：等于没批准，不会自己切回执行模式', async () => {
    const { s, evs } = session([[call('p1', 'plan.submit', { plan: PLAN })], [{ type: 'delta', text: '等人' }]])
    await s.setMode('plan')
    await s.submit('先出个计划')
    expect((await evs()).find((e) => e.t === 'plan.decided')).toMatchObject({ approved: false })
    expect(s.getMode()).toBe('plan')
    await s.flushAndClose()
  })
})

describe('PRD-M7-005 AC-3 · 批准时转成长任务', () => {
  test('步骤生成 DAG，经 orchestrator 同一套校验；runId 记进 plan.decided', async () => {
    let got: unknown
    const { s, evs } = session(
      [[call('p1', 'plan.submit', { plan: PLAN, steps: STEPS })], [{ type: 'delta', text: '转了' }]],
      {
        startTask: async (spec) => {
          got = spec
          validateSpec(spec)
          return 'run-42'
        },
      },
    )
    answerPlan(s, true, { asTask: true })
    await s.setMode('plan')
    await s.submit('先出个计划')
    const spec = validateSpec(got)
    expect(spec.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(spec.nodes.find((n) => n.id === 'c')?.needs).toEqual(['a', 'b'])
    expect((await evs()).find((e) => e.t === 'plan.decided')).toMatchObject({
      approved: true,
      asTask: true,
      runId: 'run-42',
      shape: 'dag',
    })
    await s.flushAndClose()
  })

  test('没拆步骤却要转长任务：照常批准，结果里说明为什么没转', async () => {
    let called = false
    const { s, stub } = session([[call('p1', 'plan.submit', { plan: PLAN })], [{ type: 'delta', text: '好' }]], {
      startTask: async () => {
        called = true
        return 'x'
      },
    })
    answerPlan(s, true, { asTask: true })
    await s.setMode('plan')
    await s.submit('先出个计划')
    expect(called).toBe(false)
    expect(JSON.stringify(stub.calls.at(-1)?.messages)).toContain('没有拆好的步骤')
    expect(s.getMode()).toBe('act')
    await s.flushAndClose()
  })

  test('步骤不合法（依赖了不存在的步骤）：校验拒绝，不会带病启动', async () => {
    const bad = [{ id: 'a', goal: 'x', dependsOn: ['ghost'] }]
    const { s, stub } = session(
      [[call('p1', 'plan.submit', { plan: PLAN, steps: bad })], [{ type: 'delta', text: '好' }]],
      {
        startTask: async (spec) => {
          validateSpec(spec)
          return 'never'
        },
      },
    )
    answerPlan(s, true, { asTask: true })
    await s.setMode('plan')
    await s.submit('先出个计划')
    expect(JSON.stringify(stub.calls.at(-1)?.messages)).toContain('taskError')
    expect(JSON.stringify(stub.calls.at(-1)?.messages)).not.toContain('never')
    await s.flushAndClose()
  })
})
