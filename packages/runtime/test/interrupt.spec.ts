/**
 * PRD-M13-002 · 运行时里的中断：信号传到 runTurn，子 agent 一起停（SPEC-M13-002 取舍-1 / 取舍-4）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import type { ModelEvent, ModelProvider, ModelRequest } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-int-rt-'))
  dirs.push(d)
  return d
}

/** 父会话第一次请求派子 agent；子 agent 的请求一直挂着，直到被中止 */
function provider(): ModelProvider & { childStarted: Promise<void> } {
  let started: () => void = () => undefined
  const childStarted = new Promise<void>((r) => {
    started = r
  })
  let parentTurns = 0
  return {
    id: 'stub',
    capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true } as never,
    childStarted,
    async *generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
      const text = JSON.stringify(req.messages)
      if (text.includes('目标：')) {
        started()
        await new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true }))
        return
      }
      parentTurns += 1
      if (parentTurns === 1) {
        yield { type: 'tool-call', id: 'c1', name: 'task.spawn', args: { goal: '读一堆文件' } } as ModelEvent
        return
      }
      yield { type: 'delta', text: '不该到这' } as ModelEvent
    },
  } as ModelProvider & { childStarted: Promise<void> }
}

describe('PRD-M13-002 AC-3 · 子 agent 跑着时中断', () => {
  test('父轮与子 agent 一起以 interrupted 收场，父轮不等子 agent 跑完', async () => {
    const p = provider()
    const s = new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: [{ name: 'spawn', capability: 'task.spawn', decision: 'allow' }] },
      }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: p,
    })
    s.on('onAsk', (a) => a?.answer(true))
    const ac = new AbortController()
    const run = s.submit('派个子 agent', { signal: ac.signal })
    await p.childStarted
    ac.abort({ by: 'domi-web' })
    const r = await Promise.race([run, new Promise<null>((res) => setTimeout(() => res(null), 3000))])
    expect(r?.stopReason).toBe('interrupted')
    const evs = await s.pumpAll()
    const result = evs.find((e) => e.ev.t === 'tool.result')?.ev as { reason?: string; payload?: unknown }
    expect(result.reason).toBe('interrupted')
    expect(JSON.stringify(result.payload)).toContain('中断')
    expect(evs.at(-1)?.ev).toMatchObject({ t: 'error', stopReason: 'interrupted', by: 'domi-web' })
    await s.flushAndClose()
  }, 10_000)
})
