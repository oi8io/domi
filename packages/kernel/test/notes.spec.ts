/**
 * PRD-M13-001 · 运行中补充：loop 的两个安全点（SPEC-M13-001 取舍-2 / 取舍-3）
 *
 * 补充只能在「上一步的 tool.result 都落盘之后、下一次 model.request 之前」进事件流——
 * 插进 tool_use / tool_result 之间，下一次请求会被 provider 拒掉。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StubProvider } from '@domi/model'
import type { DomiEvent, EventEnvelope, ToolSchema } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import {
  buildContext,
  type ContextPolicy,
  type LoopDeps,
  type NoteSource,
  paginateByTurns,
  runTurn,
  splitIntoTurns,
  type ToolRunner,
} from '../src/index.ts'

const POLICY: ContextPolicy = { maxTokens: 1_000_000, includeReasoning: false }
const SCHEMAS: ToolSchema[] = [{ name: 'fs.read', description: '读文件', inputSchema: { type: 'object' } }]
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function log(): SqliteEventLog {
  const d = mkdtempSync(join(tmpdir(), 'domi-notes-'))
  dirs.push(d)
  return new SqliteEventLog({ path: join(d, 'e.db') })
}

/** 手动往里塞的补充队列 */
function queue(): NoteSource & { push(text: string): void; takes: number } {
  let items: Array<{ id: string; text: string; from?: string }> = []
  let n = 0
  const q = {
    takes: 0,
    push(text: string) {
      items.push({ id: `n-${++n}`, text, from: 'domi-test' })
    },
    take() {
      q.takes++
      const out = items
      items = []
      return out
    },
  }
  return q
}

function deps(over: Partial<LoopDeps> & Pick<LoopDeps, 'provider' | 'tools'>): LoopDeps {
  let t = 1_756_000_000_000
  return { sink: log(), clock: { now: () => t++ }, policy: POLICY, model: 'stub-1', ...over }
}

const types = (evs: readonly EventEnvelope[]): string[] => evs.map((e) => e.ev.t)

describe('PRD-M13-001 AC-2 · 补充只在安全点落盘', () => {
  test('一步三个工具调用，第 1 个执行中入队 → 补充落在第 3 个 tool.result 之后、下一次 model.request 之前', async () => {
    const q = queue()
    const provider = new StubProvider([
      [
        { type: 'tool-call', id: 'c1', name: 'fs.read', args: { path: 'a' } },
        { type: 'tool-call', id: 'c2', name: 'fs.read', args: { path: 'b' } },
        { type: 'tool-call', id: 'c3', name: 'fs.read', args: { path: 'c' } },
      ],
      [{ type: 'delta', text: '好，照你说的改' }],
    ])
    const tools: ToolRunner = {
      schemas: () => SCHEMAS,
      run: async (call) => {
        if (call.id === 'c1') q.push('文件在 src/ 下')
        return { ok: true, payload: call.id }
      },
    }
    const d = deps({ provider, tools, notes: q })
    const r = await runTurn(d, 's1', '读三个文件')
    expect(r.stopReason).toBe('completed')
    const evs = await d.sink.read('s1')
    expect(types(evs)).toEqual([
      'user.input',
      'model.request',
      'tool.call',
      'tool.call',
      'tool.call',
      'tool.result',
      'tool.result',
      'tool.result',
      'user.note',
      'model.request',
      'model.delta',
    ])
    expect(evs[8]!.ev).toEqual({ t: 'user.note', id: 'n-1', text: '文件在 src/ 下', from: 'domi-test' })
    // 第二次请求的上下文：三条 tool 消息紧跟 assistant 的 tool_use，补充在它们后面
    const roles = provider.calls[1]!.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'tool', 'tool', 'user'])
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain('[运行中补充]')
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain('文件在 src/ 下')
  })

  test('同一批两条补充按顺序各落一条、seq 连续；进上下文合并成一条 user 消息', async () => {
    const q = queue()
    const provider = new StubProvider([
      [{ type: 'tool-call', id: 'c1', name: 'fs.read', args: {} }],
      [{ type: 'delta', text: 'ok' }],
    ])
    const tools: ToolRunner = {
      schemas: () => SCHEMAS,
      run: async () => {
        q.push('第一句')
        q.push('第二句')
        return { ok: true, payload: 1 }
      },
    }
    const d = deps({ provider, tools, notes: q })
    await runTurn(d, 's1', 'go')
    const evs = await d.sink.read('s1')
    const notes = evs.filter((e) => e.ev.t === 'user.note')
    expect(notes.map((e) => (e.ev as { text: string }).text)).toEqual(['第一句', '第二句'])
    expect(notes[1]!.seq).toBe(notes[0]!.seq + 1)
    const last = provider.calls[1]!.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('第一句')
    expect(last.content).toContain('第二句')
    expect(provider.calls[1]!.messages.filter((m) => m.role === 'user')).toHaveLength(2)
  })

  test('不给 NoteSource：行为与现状一致', async () => {
    const provider = new StubProvider([[{ type: 'delta', text: 'hi' }]])
    const d = deps({ provider, tools: { schemas: () => SCHEMAS, run: async () => ({ ok: true, payload: 1 }) } })
    const r = await runTurn(d, 's1', 'x')
    expect(r.stopReason).toBe('completed')
    expect(types(await d.sink.read('s1'))).toEqual(['user.input', 'model.request', 'model.delta'])
  })
})

describe('PRD-M13-001 AC-3 · 收场前再查一次队列', () => {
  test('模型本步只输出文字、队列非空 → 不收场，落补充后再请求一次', async () => {
    const q = queue()
    const provider = new StubProvider([
      (_req, _i) => {
        q.push('还有，顺便跑下测试')
        return [{ type: 'delta', text: '改完了' }]
      },
      [{ type: 'delta', text: '测试也跑了' }],
    ])
    const d = deps({
      provider,
      tools: { schemas: () => SCHEMAS, run: async () => ({ ok: true, payload: 1 }) },
      notes: q,
    })
    const r = await runTurn(d, 's1', '改一下')
    expect(r.stopReason).toBe('completed')
    expect(types(await d.sink.read('s1'))).toEqual([
      'user.input',
      'model.request',
      'model.delta',
      'user.note',
      'model.request',
      'model.delta',
    ])
    expect(provider.calls).toHaveLength(2)
  })

  test('收场前再跑的一步照常受墙钟护栏约束', async () => {
    const q = queue()
    let t = 0
    const provider = new StubProvider([
      () => {
        q.push('再补一句')
        return [{ type: 'delta', text: '完了' }]
      },
      [{ type: 'delta', text: '不该到这' }],
    ])
    const d = deps({
      provider,
      tools: { schemas: () => SCHEMAS, run: async () => ({ ok: true, payload: 1 }) },
      notes: q,
      // 每次读时钟前进 1 秒；墙钟上限 1.5 秒——第一次请求之后再回到循环开头就超了
      clock: { now: () => (t += 1000) },
      limits: { maxWallClockMs: 1500 },
    })
    const r = await runTurn(d, 's1', 'x')
    expect(r.stopReason).toBe('wall_clock')
    expect(provider.calls).toHaveLength(1)
  })

  test('队列空 → 照常 completed，只取过有限次', async () => {
    const q = queue()
    const provider = new StubProvider([[{ type: 'delta', text: 'hi' }]])
    const d = deps({
      provider,
      tools: { schemas: () => SCHEMAS, run: async () => ({ ok: true, payload: 1 }) },
      notes: q,
    })
    expect((await runTurn(d, 's1', 'x')).stopReason).toBe('completed')
    expect(q.takes).toBeGreaterThanOrEqual(2)
  })
})

describe('PRD-M13-001 AC-4 · user.note 不是轮边界', () => {
  const env = (seq: number, ev: DomiEvent): EventEnvelope => ({
    seq,
    sessionId: 's',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: seq,
    schemaVersion: 15,
    ev,
  })
  const evs = [
    env(1, { t: 'user.input', text: '第一轮' }),
    env(2, { t: 'model.delta', text: 'a' }),
    env(3, { t: 'user.note', id: 'n-1', text: '补一句'.repeat(40) }),
    env(4, { t: 'model.delta', text: 'b' }),
    env(5, { t: 'user.input', text: '第二轮' }),
  ]

  test('splitIntoTurns 只按 user.input 切', () => {
    expect(splitIntoTurns(evs).map((t) => t.map((e) => e.seq))).toEqual([[1, 2, 3, 4], [5]])
  })

  test('分页按行计权时算上补充的文字', () => {
    const page = paginateByTurns(evs, { budget: { maxLines: 1000 } })
    // 补充 120 字 → 2 行；两条 user.input 各 1 行；两条 delta 各 1 行
    expect(page.estimatedLines).toBe(6)
  })

  test('buildContext：补充是一条带标记的 user 消息，不打断之前的 assistant 文字', () => {
    const msgs = buildContext(evs.slice(0, 4), POLICY)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(msgs[2]!.content).toStartWith('[运行中补充]')
  })
})
