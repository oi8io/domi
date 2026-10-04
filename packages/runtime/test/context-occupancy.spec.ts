/**
 * BUG-M13-002 · 自动压缩看的是「当前上下文占用」，不是全会话累计（PRD-M8-012 AC-1 · PRD-M1-007 AC-2）
 *
 * 原来 maybeAutoCompact 拿全会话 input + output 累计去比阈值：累计过了 70% 之后**每一轮都压**，
 * 压完累计也不会降——事件流只增不减。
 */
import { afterEach, expect, test } from 'bun:test'
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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-ctx-')))
  dirs.push(d)
  return d
}

/** 每次请求的提示词 300、窗口 1000：单次占用 30%，四轮累计 1200 */
const answer: StubTurn = [
  { type: 'delta', text: '好' },
  { type: 'usage', raw: { usage: { inputTokens: 300, inputTokenDetails: { cacheReadTokens: 0 }, outputTokens: 20 } } },
]

test('每次只占 30%：累计早过了 70%，也不触发自动压缩；状态栏的占用是 30%', async () => {
  const s = new DomiSession({
    config: ConfigSchema.parse({
      model: { provider: 'anthropic', name: 'm', apiKey: 'k' },
      context: { maxTokens: 1_000, strategy: 'compact', compactAt: 70 },
    }),
    sessionId: 's1',
    cwd: tmp(),
    dbPath: join(tmp(), 'e.db'),
    provider: new StubProvider([answer], { onExhausted: 'repeat-last' }),
  })
  const metrics: { contextPercent: number; contextTokens?: number | undefined }[] = []
  s.on('onMetrics', (m) => metrics.push(m))
  for (const q of ['一', '二', '三', '四']) await s.submit(q)
  const evs = (await s.pumpAll()).map((e) => e.ev)
  expect(evs.filter((e) => e.t === 'ctx.compact')).toEqual([])
  expect(evs.filter((e) => e.t === 'error' && (e as { scope?: string }).scope === 'compact')).toEqual([])
  const last = metrics.at(-1)!
  expect(last.contextPercent).toBe(30)
  expect(last.contextTokens).toBe(300)
  await s.flushAndClose()
})
