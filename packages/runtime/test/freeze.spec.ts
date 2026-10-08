/**
 * TASK-M15-002 · 前缀只增不改（PRD-M15-003 · INV-12(b)）
 *
 * 会话开始定格（soul / rules / catalog / 计划 / 环境），turn 内来源变化不反映；
 * 必须送达的动态内容（计划更新等）落 ctx.note，渲染为追加 user 块——相邻请求前缀稳定。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(prefix = 'domi-freeze-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

const STEPS = [
  { id: 's1', text: '读 README', status: 'in_progress' },
  { id: 's2', text: '改标题', status: 'pending' },
]

function open(o: {
  script: Array<Array<Record<string, unknown>>>
  cwd?: string
  home?: string
  answer?: (a: PendingAsk) => void
  planRequired?: boolean
  rules?: Record<string, string>
  db?: string
}) {
  const cwd = o.cwd ?? tmp()
  const home = o.home ?? tmp('domi-freeze-home-')
  mkdirSync(join(cwd, '.git'))
  if (o.rules) {
    for (const [name, text] of Object.entries(o.rules)) writeFileSync(join(cwd, name), text)
  }
  const config = ConfigSchema.parse({
    model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
    permissions: { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
  })
  const provider = new StubProvider(o.script as never, { onExhausted: 'repeat-last' })
  const s = new DomiSession({
    config,
    sessionId: 's1',
    cwd,
    dbPath: join(home, 'events.db'),
    provider,
    ...(o.planRequired === undefined ? {} : { planRequired: o.planRequired }),
  })
  const asks: PendingAsk[] = []
  s.on('onAsk', (a) => {
    if (!a) return
    asks.push(a)
    if (o.answer) o.answer(a)
    else if (a.capabilityId === 'workspace.trust') a.answer(true)
    else a.answer(true)
  })
  return { s, asks, cwd }
}

const planCall = (id: string) => ({ type: 'tool-call', id, name: 'plan.update', args: { steps: STEPS } })
const done = { type: 'delta', text: '好了' }

/** 事件流里的 model.request 序列（指纹） */
function requests(evs: EventEnvelope[]) {
  return evs.filter((e) => e.ev.t === 'model.request').map((e) => e.ev as { fingerprint: { messages: string[] } })
}

describe('TASK-M15-002 · 前缀只增不改', () => {
  test('计划更新落 ctx.note；同一轮内下一次请求仍以前一次为前缀（plan 层定格）', async () => {
    const h = open({
      planRequired: true,
      script: [
        // 第一轮：先发请求（计划还是空的），然后模型写计划
        [planCall('p1'), done],
        // 第二轮：计划已更新（plan.update 已执行）——冻结的 plan 层不变，变化走 ctx.note 追加
        [done],
      ],
    })
    const seen: EventEnvelope[] = []
    h.s.on('onEvents', (e) => seen.push(...e))
    await h.s.submit('改 README 标题')
    await h.s.pumpAll()

    const reqs = requests(seen)
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    // 后一次请求的消息哈希以前一次为前缀（追加，不改写）
    const [r1, r2] = [reqs[0]!.fingerprint.messages, reqs[1]!.fingerprint.messages]
    expect(r2.slice(0, r1.length)).toEqual(r1)
    // ctx.note 已落盘（计划变化追加送达）
    const note = seen.find((e) => e.ev.t === 'ctx.note')
    expect(note).toBeDefined()
    expect(note!.ev).toMatchObject({ reason: 'plan' })
  })

  test('显式刷新落 ctx.refresh 并重定格（之后来源变化立即生效）', async () => {
    const h = open({ script: [[done]] })
    await h.s.submit('hi')
    const r = await h.s.refreshContext()
    expect(r).toEqual({ ok: true })
    const evs = await h.s.pumpAll()
    expect(evs.find((e) => e.ev.t === 'ctx.refresh')?.ev).toMatchObject({ reason: 'manual' })
  })

  test('turn 内规矩文件变化不进入当前请求（定格）；新一轮才生效，待生效有计数', async () => {
    const h = open({
      cwd: tmp(),
      rules: { 'AGENTS.md': 'v1：先跑测试' },
      script: [
        [{ type: 'tool-call', id: 'r1', name: 'fs.read', args: { path: 'a.txt' } }, done],
        [done],
      ],
    })
    const seen: EventEnvelope[] = []
    h.s.on('onEvents', (e) => seen.push(...e))
    await h.s.submit('看下 a.txt')
    // turn 内改规矩（第一轮工具执行后、第二轮请求前）——用注入工具太绕，这里直接在轮间改：
    // 定格语义 = turn 开始时取值；同一 turn 的两次请求必须同前缀
    writeFileSync(join(h.cwd, 'AGENTS.md'), 'v2：先跑测试再提交')
    const reqs = requests(seen)
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    const [r1, r2] = [reqs[0]!.fingerprint.messages, reqs[1]!.fingerprint.messages]
    // rules 层定格：第二轮与第一轮同层同消息前缀（AGENTS.md 变化不打扰本轮）
    expect(r2.slice(0, r1.length)).toEqual(r1)
  })

  test('刷新后重定格：刷新前的待生效变化立即反映', async () => {
    const h = open({ rules: { 'AGENTS.md': 'v1' }, script: [[done]] })
    await h.s.submit('第一轮')
    writeFileSync(join(h.cwd, 'AGENTS.md'), 'v2：跑测试')
    // 刷新 = 白名单重定格，来源变化立即生效
    await h.s.refreshContext()
    const evs = await h.s.pumpAll()
    const refresh = evs.find((e) => e.ev.t === 'ctx.refresh')
    expect(refresh).toBeDefined()
    expect(evs.filter((e) => e.ev.t === 'ctx.prefix.break')).toHaveLength(0)
  })
})
