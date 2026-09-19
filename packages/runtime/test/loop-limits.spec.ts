/**
 * PRD-M10-003 AC-3 · runTurn 的 limits 从配置来（kernel 不读配置，只收 LoopLimits）
 *
 * config.loop.maxToolCalls=2 时一轮在第 2 次工具调用后强制停（stop reason = max_tool_calls），
 * 证明 runtime 把配置传进了 runTurn 的 deps.limits。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-loop-limits-'))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

const echoTool = {
  name: 'mcp.demo.echo',
  capability: 'mcp.demo.echo',
  description: '[MCP demo] echo',
  schema: z.object({ text: z.string() }),
  execute: async (args: { text: string }) => ({ content: [{ type: 'text', text: `echo:${args.text}` }] }),
}

describe('PRD-M10-003 AC-3 · runTurn limits 来自配置', () => {
  test('config.loop.maxToolCalls=2：一轮在第 2 次工具调用后停，error{recoverable, counters.toolCalls=2}', async () => {
    const s = new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: [{ name: 'demo-all', capability: 'mcp.demo.*', decision: 'allow' }] },
        loop: { maxToolCalls: 2, maxArgParseRetries: 3, maxWallClockMs: 600_000 },
      }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      clock,
      extraTools: (() => [echoTool]) as never,
      provider: new StubProvider([[{ type: 'tool-call', id: 'c1', name: 'mcp.demo.echo', args: { text: '1' } }]], {
        onExhausted: 'repeat-last',
      }),
    })
    await s.submit('跑')
    const events = await s.pumpAll()
    const calls = events.filter((e) => e.ev.t === 'tool.call')
    // 事件里可能多出一条 pending 未执行的 tool.call（kernel stop 时会给它配结果），
    // 精确证据是 kernel 计数的实际执行次数（counters.toolCalls）
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const err = events.find((e) => e.ev.t === 'error' && (e.ev as { recoverable?: boolean }).recoverable)?.ev as {
      counters?: { toolCalls: number }
    }
    expect(err?.counters?.toolCalls).toBe(2)
    await s.flushAndClose()
  }, 15_000)
})
