/**
 * PRD-M15-004 · 遮蔽与清理集成（runtime 侧）
 * - 预检触发遮蔽：超遮蔽阈值 + 冷区够大 → 一批 ctx.mask 落盘，本轮照常完成（AC-3）
 * - 钉住：/pin 语义（session.pin）落 ctx.pin；被钉冷区 seq 遮蔽跳过（AC-5）
 * - 确定性规则随遮蔽批次只动冷区（AC-4 已由 memory 单测覆盖，这里验证 preflight 不回溯）
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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-mask-')))
  dirs.push(d)
  return d
}

const cfg = () =>
  ConfigSchema.parse({
    model: { provider: 'stub', name: 'stub-1', apiKey: 'k', contextWindow: 25_000, maxOutput: 2_000 },
  })

const turn: StubTurn = [
  { type: 'delta', text: '好' },
  { type: 'usage', raw: { usage: { inputTokens: 200, outputTokens: 20 } } },
]

/** 塞 20 步历史（热区=后 10 步；冷区 10 步 × 6k 字符 ≈ 15k token）+ usage 基准 3.2k */
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
      { t: 'tool.result', id, ok: true, payload: `line-${i}\n${'x'.repeat(500)}`, ms: 1 },
    )
  }
  // usage = 模型真实收到的输入（≈ 事件文本总量 16k+，与拼装一致；preflight 用它做占用基准）
  evs.push({ t: 'model.usage', raw: { usage: { inputTokens: 15_500, outputTokens: 500 } } })
  await (
    s as unknown as { log: { append(id: string, evs: Array<Record<string, unknown>>): Promise<unknown> } }
  ).log.append(s.id, evs)
}

describe('PRD-M15-004 · 预检遮蔽（AC-3）', () => {
  test('超遮蔽阈值 + 冷区够大 → 落一批 ctx.mask，本轮照常完成', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'm1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn], { onExhausted: 'repeat-last' }),
    })
    await seedHistory(s)
    const r = await s.submit('继续')
    // 预检走 hard 档 → 遮蔽一批（freed ≥8k）→ 占用打下来 → 照常完成
    expect(r.stopReason).toBe('completed')
    const evs = await s.pumpAll()
    const masks = evs.filter((e) => e.ev.t === 'ctx.mask') as Array<{
      ev: { seqs: number[]; reason: string; freedTokens: number }
    }>
    expect(masks.length).toBe(1)
    expect(masks[0]!.ev.reason).toBe('threshold')
    expect(masks[0]!.ev.seqs.length).toBeGreaterThan(0)
    expect(masks[0]!.ev.freedTokens).toBeGreaterThanOrEqual(8_000)
    await s.flushAndClose()
  })

  test('钉住冷区 seq → 遮蔽跳过（AC-5），解钉后恢复', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'm2',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn], { onExhausted: 'repeat-last' }),
    })
    await seedHistory(s)
    // 冷区第 1 步的 tool.result 是事件流第 3 条（index 2）
    const evs = await s.pumpAll()
    const pinnedSeq = evs[2]!.seq
    const pin = await s.pin(pinnedSeq, true)
    expect(pin.ok).toBe(true)
    const r = await s.submit('继续')
    expect(r.stopReason).toBe('completed')
    const after = await s.pumpAll()
    const masks = after.filter((e) => e.ev.t === 'ctx.mask') as Array<{ ev: { seqs: number[] } }>
    expect(masks.length).toBe(1)
    expect(masks[0]!.ev.seqs).not.toContain(pinnedSeq)
    // 解钉的恢复语义由 memory 层 mask.spec 覆盖；这里验证解钉本身落 ctx.pin
    await s.pin(pinnedSeq, false)
    const pins = await s.pumpAll()
    const pinEvs = pins.filter((e) => e.ev.t === 'ctx.pin') as Array<{ ev: { seq: number; pinned: boolean } }>
    expect(pinEvs.at(-1)?.ev.seq).toBe(pinnedSeq)
    expect(pinEvs.at(-1)?.ev.pinned).toBe(false)
    await s.flushAndClose()
  })

  test('pin 不存在的 seq → ok:false', async () => {
    const s = new DomiSession({
      config: cfg(),
      sessionId: 'm3',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([turn]),
    })
    const r = await s.pin(999_999, true)
    expect(r.ok).toBe(false)
    await s.flushAndClose()
  })
})
