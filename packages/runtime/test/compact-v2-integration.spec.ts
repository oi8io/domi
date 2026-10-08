/**
 * PRD-M15-005 · 压缩 v2 集成（runtime 侧）
 * - 手动压缩落 v2 摘要（AC-8 骨架：/compact；summary 新字段）
 * - 摘要请求复用主前缀（AC-7 / E7）：与主会话请求同一前缀
 * - /compact 重点进指令（AC-8，P1）
 * - 失败落 error{scope:'compact'}（取舍-11；熔断复用 004，overflow.spec 已测）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider, type StubTurn } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-cmp-')))
  dirs.push(d)
  return d
}

/** 大窗口：不触发 preflight 降级，手动压缩走干净路径 */
const cfg = () =>
  ConfigSchema.parse({
    model: { provider: 'stub', name: 'stub-1', apiKey: 'k', contextWindow: 200_000, maxOutput: 2_000 },
  })

const turn: StubTurn = [
  { type: 'delta', text: '好' },
  { type: 'usage', raw: { usage: { inputTokens: 200, outputTokens: 20 } } },
]

const V2_SUMMARY = {
  goal: '把 sum.js 的减号改成加号并让测试通过',
  userQuotes: ['用户说：把 sum.js 的减号改成加号'],
  keyDecisions: ['先读再改，不凭记忆'],
  files: [{ path: 'sum.js', note: '减号改加号' }],
  errors: [],
  currentStep: '正在跑完整测试',
  openQuestions: [],
  nextSteps: ['跑完整测试'],
}

/** 摘要轮：返回 v2 JSON */
const goodSummary: StubTurn = [{ type: 'delta', text: JSON.stringify(V2_SUMMARY) }]
/** 摘要轮：非法 JSON → generateStructured 抛错 → compactNow 失败 */
const badSummary: StubTurn = [{ type: 'delta', text: '这不是 JSON' }]

/** 塞 105 步（每步 tool 输出 3000 字符 ≈ 750 token，总计 ≈78k > 24k 保留线）→ 手动压缩有得压 */
async function seedHistory(s: DomiSession): Promise<void> {
  const evs: Array<Record<string, unknown>> = []
  for (let i = 0; i < 105; i++) {
    const id = `c${i}`
    evs.push(
      {
        t: 'model.request',
        provider: 'stub',
        model: 'stub-1',
        tokensIn: 0,
        messages: [],
        ctx: { layers: [], tools: 0, history: 0 },
      },
      { t: 'tool.call', id, name: 'read', args: { path: `/f${i}.txt` } },
      { t: 'tool.result', id, ok: true, payload: `line-${i}\n${'x'.repeat(3000)}`, ms: 1 },
    )
  }
  evs.push({ t: 'model.usage', raw: { usage: { inputTokens: 10_000, outputTokens: 500 } } })
  await (
    s as unknown as { log: { append(id: string, evs: Array<Record<string, unknown>>): Promise<unknown> } }
  ).log.append(s.id, evs)
}

function evTypes(evs: Array<{ ev: { t: string } }>): string[] {
  return evs.map((e) => e.ev.t)
}

describe('PRD-M15-005 · 手动压缩 v2（AC-8 骨架）', () => {
  test('compactNow 落 v2 摘要（goal/userQuotes/files…）+ 原始事件不动', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([goodSummary, turn], { onExhausted: 'repeat-last' }),
    })
    await seedHistory(s)
    const r = await s.compactNow('manual')
    expect(r.ok).toBe(true)
    expect(r.freed).toBeGreaterThan(0)
    const evs = await s.pumpAll()
    const compact = evs.find((e) => e.ev.t === 'ctx.compact') as unknown as {
      ev: { fromSeq: number; toSeq: number; trigger: string; summary: typeof V2_SUMMARY }
    }
    expect(compact).toBeDefined()
    expect(compact.ev.trigger).toBe('manual')
    expect(compact.ev.fromSeq).toBeGreaterThan(0)
    expect(compact.ev.summary.goal).toBe('把 sum.js 的减号改成加号并让测试通过')
    expect(compact.ev.summary.files[0]?.path).toBe('sum.js')
    expect(compact.ev.summary.userQuotes[0]).toContain('把 sum.js 的减号改成加号')
    // 原事件一条不少（INV-12）
    const base = evs.filter((e) => e.ev.t !== 'ctx.compact')
    expect(base.length).toBe(105 * 3 + 1)
  })

  test('摘要请求复用主前缀（AC-7 / E7）：与主会话请求前缀一致', async () => {
    const provider = new StubProvider([turn, goodSummary], { onExhausted: 'repeat-last' })
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c2',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider,
    })
    await seedHistory(s)
    // 主会话一次真实请求
    await s.submit('继续')
    // 第一个请求就是主会话请求（标题生成在后）
    const mainReq = provider.calls[0]!
    expect(mainReq.messages.length).toBeGreaterThan(0)
    expect(mainReq.messages[0]?.role).toBe('system')
    const before = provider.calls.length
    const r = await s.compactNow('manual')
    expect(r.ok).toBe(true)
    const summaryReq = provider.calls.at(-1)!
    expect(provider.calls.length).toBeGreaterThan(before)
    // 前缀一致（system + 稳定块）：摘要请求开头与主请求开头逐条相同
    const n = Math.min(3, mainReq.messages.length, summaryReq.messages.length)
    expect(JSON.stringify(summaryReq.messages.slice(0, n))).toBe(JSON.stringify(mainReq.messages.slice(0, n)))
  })

  test('/compact 重点进摘要指令（AC-8，P1）', async () => {
    const provider = new StubProvider([goodSummary], { onExhausted: 'repeat-last' })
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c3',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider,
    })
    await seedHistory(s)
    const r = await s.compactNow('manual', '上线前必须改完的错误')
    expect(r.ok).toBe(true)
    const summaryReq = provider.calls.at(-1)!
    const last = summaryReq.messages[summaryReq.messages.length - 1]
    const content = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
    expect(content).toContain('上线前必须改完的错误')
  })

  test('单轮长任务可压：一个 user.input 后多次迭代（多 model.request）', async () => {
    const provider = new StubProvider([goodSummary], { onExhausted: 'repeat-last' })
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c4',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider,
    })
    // 单轮：1 个 user.input + 12 次迭代（12 个 model.request，每次 tool 输出 3k 字符）
    const evs: Array<Record<string, unknown>> = [
      { t: 'user.input', text: '一口气干完' },
      ...Array.from({ length: 12 }, (_, i) => {
        const id = `k${i}`
        return [
          {
            t: 'model.request',
            provider: 'stub',
            model: 'stub-1',
            tokensIn: 0,
            messages: [],
            ctx: { layers: [], tools: 0, history: 0 },
          },
          { t: 'tool.call', id, name: 'exec', args: { cmd: 'x' } },
          { t: 'tool.result', id, ok: true, payload: 'r'.repeat(12000), ms: 1 },
        ]
      }).flat(),
    ]
    await (
      s as unknown as { log: { append(id: string, evs: Array<Record<string, unknown>>): Promise<unknown> } }
    ).log.append(s.id, evs)
    const r = await s.compactNow('manual')
    expect(r.ok).toBe(true)
    const evsOut = await s.pumpAll()
    expect(evTypes(evsOut)).toContain('ctx.compact')
  })

  test('摘要失败落 error{scope:compact} + ok:false（取舍-11）', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c5',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([badSummary], { onExhausted: 'repeat-last' }),
    })
    await seedHistory(s)
    const r = await s.compactNow('manual')
    expect(r.ok).toBe(false)
    const evs = await s.pumpAll()
    const err = evs.find((e) => e.ev.t === 'error') as { ev: { scope: string; recoverable: boolean } }
    expect(err).toBeDefined()
    expect(err.ev.scope).toBe('compact')
    expect(err.ev.recoverable).toBe(true)
  })
})

describe('PRD-M15-005 · 补水与编辑守卫（AC-5）', () => {
  test('压缩成功后 stamps 全清：改文件前必须重读', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'c6',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([goodSummary], { onExhausted: 'repeat-last' }),
    })
    await seedHistory(s)
    // 模拟本会话已读过 /a.ts（stamps 有记录）
    const tools = (
      s as unknown as { tools: { stamps: { record(p: string, c: string): void; has(p: string): boolean } } }
    ).tools
    tools.stamps.record('/a.ts', 'content')
    expect(tools.stamps.has('/a.ts')).toBe(true)
    const r = await s.compactNow('manual')
    expect(r.ok).toBe(true)
    // 压缩后失效：凭摘要认知，改前必须重读
    expect(tools.stamps.has('/a.ts')).toBe(false)
  })
})
