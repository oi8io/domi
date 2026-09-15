/**
 * PRD-M0-002 · 与单一模型完成多轮工具调用对话（AC-2/3/4）
 * SPEC-M0-007 · 三个终止条件
 *
 * 这里用**真的** SqliteEventLog 而不是内存假货，顺带证明一件事：
 * `SqliteEventLog` 在结构上满足 kernel 自己声明的 `EventSink` 端口（见 ports.ts）——
 * 端口对不上的话这个文件根本编译不过。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StubProvider } from '@domi/model'
import type { ToolSchema } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import {
  type Clock,
  type ContextPolicy,
  type LoopDeps,
  runTurn,
  type ToolOutcome,
  type ToolRunner,
  unmarkToolResult,
} from '../src/index.ts'

const POLICY: ContextPolicy = { maxTokens: 1_000_000, includeReasoning: false }
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function log(): SqliteEventLog {
  const d = mkdtempSync(join(tmpdir(), 'domi-loop-'))
  dirs.push(d)
  return new SqliteEventLog({ path: join(d, 'e.db') })
}

/** 可控时钟：kernel 不读时钟，时间从这里注入（PRD-M0-006 AC-1） */
function fakeClock(stepMs = 1): Clock & { t: number } {
  const c = {
    t: 1_756_000_000_000,
    now() {
      const v = c.t
      c.t += stepMs
      return v
    },
  }
  return c
}

const SCHEMAS: ToolSchema[] = [{ name: 'fs.read', description: '读文件', inputSchema: { type: 'object' } }]

function runner(fn: (call: { name: string; args: unknown }) => ToolOutcome): ToolRunner {
  return { schemas: () => SCHEMAS, run: async (call) => fn(call) }
}

function deps(over: Partial<LoopDeps> & Pick<LoopDeps, 'provider' | 'tools'>): LoopDeps {
  return {
    sink: log(),
    clock: fakeClock(),
    policy: POLICY,
    model: 'stub-1',
    ...over,
  }
}

describe('PRD-M0-002 · 基本闭环', () => {
  test('模型请求工具调用 → 执行 → 结果回灌 → 继续', async () => {
    const provider = new StubProvider([
      [
        { type: 'delta', text: '我读一下文件' },
        { type: 'tool-call', id: 'c1', name: 'fs.read', args: { path: 'README.md' } },
      ],
      [{ type: 'delta', text: '读完了，共 3 行。' }],
    ])
    const d = deps({ provider, tools: runner(() => ({ ok: true, payload: { lines: 3 } })) })
    const r = await runTurn(d, 's1', '看看 README')

    expect(r.stopReason).toBe('completed')
    expect(r.counters.toolCalls).toBe(1)

    const types = (await d.sink.read('s1')).map((e) => e.ev.t)
    expect(types).toEqual([
      'user.input',
      'model.request',
      'model.delta',
      'tool.call',
      'tool.result',
      'model.request',
      'model.delta',
    ])
    // 第二轮的上下文里必须能看到工具结果，否则「回灌」没发生。
    // 注意别用 JSON.stringify 整体 toContain —— tool 消息的 content 本身是 JSON 字符串，
    // 外层再序列化一次会把引号转义掉，断言会假红。
    const toolMsg = provider.calls[1]?.messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    // 工具结果带边界标记（PRD-M2-006 AC-2），剥掉标记才是原始 JSON
    expect(JSON.parse(unmarkToolResult((toolMsg as { content: string }).content))).toEqual({ lines: 3 })
  })
})

describe('PRD-M0-002 AC-2 · 20 次工具循环后强制停止', () => {
  test('第 20 次后停，产出 error{recoverable:true} 且带三个计数器', async () => {
    const provider = new StubProvider([[{ type: 'tool-call', id: 'c', name: 'fs.read', args: {} }]], {
      onExhausted: 'repeat-last',
    })
    const d = deps({ provider, tools: runner(() => ({ ok: true, payload: 1 })) })
    const r = await runTurn(d, 's1', 'loop')

    expect(r.stopReason).toBe('max_tool_calls')
    expect(r.counters.toolCalls).toBe(20)

    const last = (await d.sink.read('s1')).at(-1)!.ev as Record<string, unknown>
    expect(last.t).toBe('error')
    expect(last.recoverable).toBe(true)
    expect(last.counters).toEqual({
      toolCalls: 20,
      argParseRetries: 0,
      elapsedMs: expect.any(Number),
    })
  })
})

describe('PRD-M0-002 AC-3 · 参数畸形最多重试 3 次，第 4 次终止', () => {
  test('连续 invalid_args 到第 4 次终止', async () => {
    const provider = new StubProvider([[{ type: 'tool-call', id: 'c', name: 'fs.read', args: '这不是对象' }]], {
      onExhausted: 'repeat-last',
    })
    const d = deps({
      provider,
      tools: runner(() => ({ ok: false, payload: { error: 'args 不是对象' }, reason: 'invalid_args' })),
    })
    const r = await runTurn(d, 's1', 'bad args')

    expect(r.stopReason).toBe('max_arg_parse_retries')
    expect(r.counters.argParseRetries).toBe(4)

    // 解析错误必须作为 tool.result 回灌给模型，而不是抛异常打断会话
    const results = (await d.sink.read('s1')).filter((e) => e.ev.t === 'tool.result')
    expect(results).toHaveLength(4)
    expect((results[0]!.ev as Record<string, unknown>).reason).toBe('invalid_args')
  })

  test('中间成功一次就清零 —— 连续失败才是信号，累计失败不是', async () => {
    let n = 0
    const provider = new StubProvider([[{ type: 'tool-call', id: 'c', name: 'fs.read', args: {} }]], {
      onExhausted: 'repeat-last',
    })
    const d = deps({
      provider,
      tools: runner(() => {
        n++
        return n % 3 === 0 ? { ok: true, payload: 'ok' } : { ok: false, payload: {}, reason: 'invalid_args' }
      }),
    })
    const r = await runTurn(d, 's1', 'mixed')
    // 永远攒不够连续 4 次，所以只会被工具调用次数上限拦下
    expect(r.stopReason).toBe('max_tool_calls')
  })
})

describe('PRD-M0-002 AC-4 · 流中途截断', () => {
  test('产出 error{recoverable:true}，事件流仍连续，用户可继续输入', async () => {
    const provider = new StubProvider([
      [
        { type: 'delta', text: '刚说到一半' },
        { type: 'error', message: 'stream truncated', recoverable: true },
      ],
      [{ type: 'delta', text: '第二次好了' }],
    ])
    const d = deps({ provider, tools: runner(() => ({ ok: true, payload: 1 })) })
    const r1 = await runTurn(d, 's1', '第一次')
    expect(r1.stopReason).toBe('stream_error')

    const after1 = await d.sink.read('s1')
    expect(after1.map((e) => e.seq)).toEqual(after1.map((_, i) => i + 1))
    expect((after1.at(-1)!.ev as Record<string, unknown>).recoverable).toBe(true)

    // 同一会话还能继续跑下一轮
    const r2 = await runTurn(d, 's1', '第二次')
    expect(r2.stopReason).toBe('completed')
    const all = await d.sink.read('s1')
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1))
  })
})

describe('SPEC-M0-007 · 墙钟护栏', () => {
  test('超过 maxWallClockMs 立即终止', async () => {
    const provider = new StubProvider([[{ type: 'delta', text: 'x' }]], { onExhausted: 'repeat-last' })
    const d = deps({
      provider,
      tools: runner(() => ({ ok: true, payload: 1 })),
      clock: fakeClock(60_000),
      limits: { maxWallClockMs: 1_000 },
    })
    const r = await runTurn(d, 's1', 'slow')
    expect(r.stopReason).toBe('wall_clock')
    expect((await d.sink.read('s1')).at(-1)!.ev.t).toBe('error')
  })
})

describe('PRD-M0-003 AC-2 · 用户拒绝不是错误', () => {
  test('user_denied 回灌为语义化结果，且不计入参数解析重试', async () => {
    const provider = new StubProvider([
      [{ type: 'tool-call', id: 'c1', name: 'fs.read', args: {} }],
      [{ type: 'delta', text: '好的，我不动它。' }],
    ])
    const d = deps({
      provider,
      tools: runner(() => ({ ok: false, payload: { message: '用户拒绝了这次写入' }, reason: 'user_denied' })),
    })
    const r = await runTurn(d, 's1', '改个文件')
    expect(r.stopReason).toBe('completed')
    expect(r.counters.argParseRetries).toBe(0)
    const res = (await d.sink.read('s1')).find((e) => e.ev.t === 'tool.result')!.ev as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('user_denied')
  })
})

describe('provider 在出流之前就抛错（2026-09-15 现场）', () => {
  // AiSdkProvider 在发请求前做能力检查（PRD-M1-001 AC-3），不满足就直接抛。
  // 原来这个异常穿出 runTurn：事件流里只有一条 user.input，daemon 把异常吞了，
  // 用户那边什么都看不到——既没有回答，也没有错误
  test('变成一条 error 事件落盘，本轮以 stream_error 结束，会话可以继续', async () => {
    const throwing = {
      id: 'broken',
      capabilities: { toolCall: false, vision: false, reasoning: false, promptCache: false, structuredOutput: false },
      // biome-ignore lint/correctness/useYield: 模拟「第一次取值就抛」的 provider
      async *generate(): AsyncIterable<never> {
        throw new Error('error.unsupported_capability: provider "broken" 未声明支持 toolCall')
      },
    }
    const d = deps({ provider: throwing, tools: runner(() => ({ ok: true, payload: 1 })) })
    const r = await runTurn(d, 's1', '你好')
    expect(r.stopReason).toBe('stream_error')
    const events = await d.sink.read('s1')
    expect(events.map((e) => e.ev.t)).toEqual(['user.input', 'model.request', 'error'])
    expect(JSON.stringify(events.at(-1)?.ev)).toContain('unsupported_capability')
  })
})
