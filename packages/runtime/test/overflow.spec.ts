/**
 * PRD-M15-002 · 超窗不崩（SPEC-M15-002 取舍-16/17 + AC-4/5/6）
 * - R1 复现用例（AC-4）：第二次 submit 能正常跑（预检 + 降级链兜底，异常不穿出）
 * - 硬顶：停 + error{scope:'context', recoverable:true} + 出路
 * - 熔断（AC-6）：压缩连续失败 N=2 后不再自动触发
 * - 模型切换预检（AC-5）：放不下先压缩再切 + model.switch 旁说明
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider, type StubTurn } from '@domi/model'
import { COMPACT_FAIL_MAX, DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-of-')))
  dirs.push(d)
  return d
}

/** 小窗口：10k 窗口 / 2k 输出 → 有效窗口 max(4096, …) = 4096；mask≥2458 / compact≥3277 / hard≥3768 */
const small = (contextWindow = 10_000, maxOutput = 2_000) =>
  ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k', contextWindow, maxOutput } })

/** 正常对话轮：吐一句 + 报 usage（input 是窗口占用真值） */
const turn = (inputTokens: number): StubTurn => [
  { type: 'delta', text: '好' },
  { type: 'usage', raw: { usage: { inputTokens, outputTokens: 20 } } },
]
/** 摘要轮给非法 JSON → generateStructured 抛错 → compactNow 失败（熔断测试用） */
const badSummary: StubTurn = [{ type: 'delta', text: '这不是 JSON' }]

function evTypes(evs: Array<{ ev: { t: string } }>): string[] {
  return evs.map((e) => e.ev.t)
}

describe('PRD-M15-002 AC-4 · R1 复现：第二次 submit 能正常跑', () => {
  test('预检触发遮蔽档 → 不穿出异常，第二轮照常完成', async () => {
    const s = new DomiSession({
      config: small(23_000, 2_000), // effective 8000：2.5k 真值 + ~3.2k 增量 → 遮蔽档（<6400）
      sessionId: 'r1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn(2_500)], { onExhausted: 'repeat-last' }),
    })
    // 第一次 submit：窗口内，正常跑，usage 2.5k 落盘
    const first = await s.submit('一')
    expect(first.stopReason).toBe('completed')
    // 第二次 submit：占用 2.5k + 增量（system/工具）≈ 3k → 遮蔽档（>2458）
    const second = await s.submit('二')
    expect(second.stopReason).toBe('completed')
    const evs = await s.pumpAll()
    const ts = evTypes(evs)
    // 没有穿出异常；不落 context 错误（compact 失败是可控降级，error{scope:compact} 允许存在）
    expect(
      ts.filter(
        (t) => t === 'error' && (evs.find((e) => e.ev.t === 'error')?.ev as { scope?: string })?.scope === 'context',
      ),
    ).toEqual([])
    await s.flushAndClose()
  })

  test('超硬顶：本轮停 + error{scope:context, recoverable:true}，不穿出 runTurn', async () => {
    const s = new DomiSession({
      config: small(23_000, 2_000), // effective 8000，硬顶 7360
      sessionId: 'hard',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn(6_500)], { onExhausted: 'repeat-last' }),
    })
    await s.submit('一') // usage 6.5k 落盘
    const second = await s.submit('二') // 6.5k+增量 > 7360 → 硬顶
    expect(second.stopReason).not.toBe('completed')
    const evs = await s.pumpAll()
    const errs = evs.filter((e) => e.ev.t === 'error') as Array<{
      ev: { scope?: string; recoverable?: boolean; message?: string }
    }>
    const ctxErr = errs.find((e) => e.ev.scope === 'context')
    expect(ctxErr).toBeDefined()
    expect(ctxErr!.ev.recoverable).toBe(true)
    expect(String(ctxErr!.ev.message)).toContain('开一个新会话')
    await s.flushAndClose()
  })
})

describe('PRD-M15-002 AC-6 · 压缩熔断', () => {
  test(`连续失败 ${COMPACT_FAIL_MAX} 次后不再自动触发`, async () => {
    const s = new DomiSession({
      config: small(23_000, 2_000), // effective 8000，硬顶 7360
      sessionId: 'fuse',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn(6_500)], { onExhausted: 'repeat-last' }),
    })
    await s.submit('一') // usage 6.5k → 之后每次预检都超硬顶 → 链走压缩 → 失败
    await s.submit('二') // 压缩失败 #1（3 次结构化尝试）
    await s.submit('三') // 压缩失败 #2 → 熔断计数到顶
    await s.submit('四') // 熔断生效：不再触发 compactNow
    const evs = await s.pumpAll()
    const compactErrs = evs.filter((e) => e.ev.t === 'error' && (e.ev as { scope?: string }).scope === 'compact')
    expect(compactErrs.length).toBe(COMPACT_FAIL_MAX)
    await s.flushAndClose()
  })
})

describe('PRD-M15-002 AC-5 · 模型切换预检', () => {
  test('切到更小窗口放不下 → 先压缩（失败也说明）→ model.switch 带说明', async () => {
    const s = new DomiSession({
      config: small(5_000, 1_000), // 全局小窗口：effective 4096；usage 2.5k → 遮蔽档
      sessionId: 'sw',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn(2_500)], { onExhausted: 'repeat-last' }),
    })
    await s.submit('一') // usage 2.5k 落盘
    await s.switchModel('deepseek-chat')
    const evs = await s.pumpAll()
    const sw = evs.find((e) => e.ev.t === 'model.switch') as { ev: { reason?: string } } | undefined
    expect(sw).toBeDefined()
    expect(String(sw!.ev.reason)).toContain('切换')
    // 压缩失败路径 → reason 说明「可能放不下」；切换本身完成（不阻断）
    expect(String(sw!.ev.reason)).toContain('压缩')
    await s.flushAndClose()
  })
})
