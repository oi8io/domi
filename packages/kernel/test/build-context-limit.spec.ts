/**
 * PRD-M15-002 AC-4 · buildContext 超限抛 ContextLimitError（可恢复）
 * - 拼装阶段超硬顶（92% 有效窗口）→ 抛 ContextLimitError，不静默截断
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { effectiveWindow } from '../src/budget.ts'
import { buildContext, ContextLimitError } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function eventsOf(evs: DomiEvent[]): Promise<EventEnvelope[]> {
  const d = mkdtempSync(join(tmpdir(), 'domi-bl-'))
  dirs.push(d)
  const clock = { t: 0, now: () => clock.t }
  const log = new SqliteEventLog({ path: join(d, 'e.db'), clock })
  await log.append('s', evs)
  return log.read('s')
}

const policy = { strategy: 'full' as const, maxTokens: 1_000_000, includeReasoning: false }

test('超硬顶 → ContextLimitError', async () => {
  const evs = await eventsOf([{ t: 'user.input', text: 'x'.repeat(50_000), mode: 'chat' }])
  const window = { contextWindow: 30_000, maxOutput: 4_000 }
  const effective = effectiveWindow(window.contextWindow, window.maxOutput)
  expect(() => buildContext(evs, policy, window)).toThrow(ContextLimitError)
  // 同窗口下：硬顶 × 有效窗口 < 这条消息的估算量
  expect(evs[0]!.ev.t).toBe('user.input')
})

test('窗口内正常返回，不抛', async () => {
  const evs = await eventsOf([{ t: 'user.input', text: '你好', mode: 'chat' }])
  const window = { contextWindow: 128_000, maxOutput: 8_000 }
  const messages = buildContext(evs, policy, window)
  expect(messages.length).toBeGreaterThan(0)
})

test('不带 window → 不预检（老调用方不受影响）', async () => {
  const evs = await eventsOf([{ t: 'user.input', text: 'x'.repeat(50_000), mode: 'chat' }])
  expect(() => buildContext(evs, policy)).not.toThrow()
})
