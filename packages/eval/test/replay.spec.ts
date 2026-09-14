/**
 * PRD-M2-008 · L1 确定性轨迹回放评估（AC-1~6）· INV-13
 *
 * 这是「提测」真正能跑的东西：改了 prompt、换了模型、动了压缩策略之后，
 * 立刻知道原来能跑通的场景有没有被搞坏。不花钱、不联网、可进 CI。
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { type Fixture, formatResult, normalize, parse, record, replay, serialize } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent, ts = ++seq): EventEnvelope {
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts, schemaVersion: 3, ev }
}

/** 一次真实形状的会话：读文件 → 改文件 → 跑测试 */
function realSession(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '把 sum.js 的减号改成加号并跑测试' }),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 3 }),
    env({ t: 'model.reason', text: '先读文件' }),
    env({ t: 'model.delta', text: '我先看看。' }),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } }),
    env({ t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'config', matchedRule: 'allow-read' }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: { lines: 1 }, ms: 4 }),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 9 }),
    env({ t: 'model.delta', text: '改成加号。' }),
    env({ t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'sum.js', content: 'a + b' } }),
    env({ t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 5 }, ms: 2 }),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 14 }),
    env({ t: 'tool.call', id: 'c3', name: 'shell.exec', args: { cmd: 'sh test.sh' } }),
    env({ t: 'tool.result', id: 'c3', ok: true, payload: { stdout: 'PASS', exitCode: 0 }, ms: 30 }),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 20 }),
    env({ t: 'model.delta', text: '测试通过了。' }),
    env({ t: 'model.usage', raw: { input_tokens: 421, cache_read_input_tokens: 256 } }),
  ]
}

describe('AC-1 · 录制', () => {
  test('把真实会话切成「每轮模型吐了什么、工具回了什么」', () => {
    const f = record(realSession(), 's1')
    expect(f.inputs).toEqual(['把 sum.js 的减号改成加号并跑测试'])
    expect(f.turns).toHaveLength(4)
    expect(f.expectedCalls.map((c) => c.name)).toEqual(['fs.read', 'fs.write', 'shell.exec'])
    expect(f.toolResults).toHaveLength(3)
  })

  test('录制不需要另外埋点 —— 事件流本来就全记着（INV-13）', () => {
    const f = record(realSession(), 's1')
    // 思维链、usage 都在，因为它们本来就在事件流里
    expect(JSON.stringify(f.turns)).toContain('先读文件')
    expect(JSON.stringify(f.turns)).toContain('cache_read_input_tokens')
  })

  test('loop 自己产生的终止事件不算模型输出', () => {
    seq = 0
    const f = record(
      [
        env({ t: 'user.input', text: 'x' }),
        env({ t: 'model.request', provider: 'p', model: 'm', tokensIn: 1 }),
        env({ t: 'error', scope: 'loop', message: '工具调用达到上限', recoverable: true }),
      ],
      's1',
    )
    expect(f.turns[0]?.model).toEqual([])
  })

  test('序列化后能原样读回来', () => {
    const f = record(realSession(), 's1')
    expect(parse(serialize(f))).toEqual(f)
  })

  test('不认识的 fixture 版本直接报错，不猜', () => {
    expect(() => parse('{"version":99}')).toThrow(/版本/)
  })
})

describe('AC-2 · 回放走真实 kernel 代码路径', () => {
  test('回放同一个 fixture，工具调用序列与录制一致', async () => {
    const r = await replay(record(realSession(), 's1'))
    expect(r.ok).toBe(true)
    expect(r.actualCalls).toBe(3)
    expect(r.divergence).toBeNull()
    expect(formatResult(r)).toContain('与录制一致')
  })

  test('回放产生的是真事件流 —— seq 连续、结构完整（INV-01）', async () => {
    const r = await replay(record(realSession(), 's1'))
    expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i + 1))
    expect(r.events.filter((e) => e.ev.t === 'tool.call')).toHaveLength(3)
    expect(r.events.filter((e) => e.ev.t === 'tool.result')).toHaveLength(3)
  })
})

describe('AC-4 · 差异报告指出第一个分叉点', () => {
  test('工具名变了 → 指出第几次、期望什么、实际什么、跳到哪个 seq', async () => {
    const f = record(realSession(), 's1')
    // 模拟「改了 prompt 之后模型第二步不写文件了，改成又读了一次」
    const broken: Fixture = structuredClone(f)
    const turn = broken.turns[1]
    if (!turn) throw new Error('fixture 形状变了')
    turn.model = turn.model.map((m) =>
      m.type === 'tool-call' ? { ...m, name: 'fs.read', args: { path: 'sum.js' } } : m,
    )

    const r = await replay(broken)
    expect(r.ok).toBe(false)
    const d = r.divergence
    if (!d) throw new Error('应该分叉')
    expect(d.index).toBe(1)
    expect(d.expected?.name).toBe('fs.write')
    expect(d.actual?.name).toBe('fs.read')
    expect(d.seq).toBeGreaterThan(0)

    const out = formatResult(r)
    expect(out).toContain('第 2 次工具调用开始分叉')
    expect(out).toContain('轨迹面板 seq')
  })

  test('少调了一次工具也算分叉，并说清是「没有更多调用」', async () => {
    const f = record(realSession(), 's1')
    const broken: Fixture = structuredClone(f)
    broken.turns = broken.turns.slice(0, 2)
    const r = await replay(broken)
    expect(r.ok).toBe(false)
    expect(formatResult(r)).toContain('没有更多调用')
  })

  test('参数变了也抓得到 —— 名字对不代表做的是同一件事', async () => {
    const f = record(realSession(), 's1')
    const broken: Fixture = structuredClone(f)
    const turn = broken.turns[1]
    if (!turn) throw new Error('fixture 形状变了')
    turn.model = turn.model.map((m) =>
      m.type === 'tool-call' ? { ...m, args: { path: 'other.js', content: 'a + b' } } : m,
    )
    const r = await replay(broken)
    expect(r.ok).toBe(false)
    expect(r.divergence?.index).toBe(1)
  })
})

describe('AC-6 · 确定性', () => {
  test('同一 fixture 连跑 10 次结果完全一致', async () => {
    const f = record(realSession(), 's1')
    const results: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = await replay(f)
      results.push(JSON.stringify({ ok: r.ok, calls: r.actualCalls, div: r.divergence }))
    }
    expect(new Set(results).size).toBe(1)
  })

  test('归一化抹平时间戳、路径、SHA、UUID，但保留结构', () => {
    const n = normalize({
      path: '/tmp/domi-abc123/sum.js',
      sha256: 'a'.repeat(64),
      at: '2026-09-14T12:00:00Z',
      id: '550e8400-e29b-41d4-a716-446655440000',
      ms: 42,
      lines: 3,
    }) as Record<string, unknown>
    expect(n.path).toBe('<TMP>/sum.js')
    expect(n.sha256).toBe('<SHA>')
    expect(n.at).toBe('<TS>')
    expect(n.id).toBe('<UUID>')
    expect(n.ms).toBe('<DURATION>')
    // 小整数是语义的一部分，不许抹
    expect(n.lines).toBe(3)
  })

  test('抹平的是值不是键 —— 「本来有个路径，现在没了」要能看出来', () => {
    const n = normalize({ path: '/tmp/x' }) as Record<string, unknown>
    expect(Object.keys(n)).toEqual(['path'])
  })
})

describe('AC-3 · 不联网', () => {
  test('回放全程没有出站调用 —— 把 fetch 换成会炸的也照样通过', async () => {
    const original = globalThis.fetch
    let called = 0
    globalThis.fetch = (() => {
      called++
      throw new Error('L1 回放不许联网（INV-08 / AC-3）')
    }) as unknown as typeof globalThis.fetch
    try {
      const r = await replay(record(realSession(), 's1'))
      expect(r.ok).toBe(true)
      expect(called).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('fixture 里没录到的工具调用', () => {
  test('不静默返回成功，而是明说「录制时这一步没发生过」', async () => {
    const f = record(realSession(), 's1')
    const broken: Fixture = structuredClone(f)
    broken.toolResults = []
    const r = await replay(broken)
    const results = r.events.filter((e) => e.ev.t === 'tool.result')
    const first = results[0]
    expect(first).toBeDefined()
    expect((first?.ev as { reason?: string } | undefined)?.reason).toBe('not_recorded')
  })
})
