/**
 * L1 确定性回放 —— PRD-M2-008 AC-2/3/4/6 · INV-13
 *
 * 回放的是**模型与工具**，跑的是**真的 kernel**：
 * 真的 buildContext、真的 loop、真的终止条件、真的事件流。
 * 所以它能抓到「改了 prompt 之后工具调用顺序变了」这类回归——
 * 那正是端到端测试最贵、也最容易漏掉的部分。
 *
 * **不花钱、不联网、可进 CI**（INV-08）。AC-3 要求无网络环境下通过，
 * 判据见 `assertNoNetwork`：回放期间任何出站调用都让测试失败。
 */
import {
  type Clock,
  type ContextPolicy,
  type EventSink,
  runTurn,
  type ToolOutcome,
  type ToolRunner,
} from '@domi/kernel'
import type { ModelEvent, ModelRequest } from '@domi/model'
import type { DomiEvent, EventEnvelope, ToolSchema } from '@domi/protocol'
import type { Fixture } from './fixture.ts'
import { normalize, stableStringify } from './normalize.ts'

export interface Divergence {
  /** 第几次工具调用开始对不上 */
  index: number
  expected: { name: string; args: unknown } | null
  actual: { name: string; args: unknown } | null
  /** 事件流里的 seq，能直接跳到轨迹面板的对应节点（AC-4） */
  seq: number | null
}

export interface ReplayResult {
  ok: boolean
  fixture: string
  expectedCalls: number
  actualCalls: number
  divergence: Divergence | null
  events: EventEnvelope[]
}

/** 内存事件槽：回放不该碰磁盘 */
export class MemorySink implements EventSink {
  private readonly rows: EventEnvelope[] = []

  async append(sessionId: string, evs: DomiEvent[]): Promise<{ from: number; to: number }> {
    const from = this.rows.length + 1
    for (const ev of evs) {
      const seq = this.rows.length + 1
      this.rows.push({ seq, sessionId, parentSeq: seq > 1 ? seq - 1 : null, ts: seq, schemaVersion: 3, ev })
    }
    return { from, to: this.rows.length }
  }

  async read(sessionId: string, opts: { fromSeq?: number; toSeq?: number } = {}): Promise<EventEnvelope[]> {
    const from = opts.fromSeq ?? 1
    const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER
    return this.rows.filter((r) => r.sessionId === sessionId && r.seq >= from && r.seq <= to)
  }

  async head(sessionId: string): Promise<number> {
    return this.rows.filter((r) => r.sessionId === sessionId).length
  }

  all(): EventEnvelope[] {
    return [...this.rows]
  }
}

/** 按 fixture 逐轮吐出录制的模型输出 */
class ReplayProvider {
  readonly id = 'replay'
  private turn = 0
  constructor(private readonly fixture: Fixture) {}

  async *generate(_req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const t = this.fixture.turns[this.turn++]
    if (!t) return
    for (const ev of t.model) {
      if (signal.aborted) return
      yield ev as ModelEvent
    }
  }
}

/** 按 fixture 回放工具结果。**不执行真工具**——那是工具自己测试的事 */
class ReplayTools implements ToolRunner {
  private readonly byId: Map<string, ToolOutcome>
  readonly calls: Array<{ name: string; args: unknown }> = []

  constructor(fixture: Fixture) {
    this.byId = new Map(
      fixture.toolResults.map((r) => [
        r.id,
        r.reason === undefined ? { ok: r.ok, payload: r.payload } : { ok: r.ok, payload: r.payload, reason: r.reason },
      ]),
    )
  }

  schemas(): ToolSchema[] {
    return []
  }

  async run(call: { id: string; name: string; args: unknown }): Promise<ToolOutcome> {
    this.calls.push({ name: call.name, args: call.args })
    return (
      this.byId.get(call.id) ?? {
        ok: false,
        reason: 'not_recorded',
        payload: { message: `fixture 里没有 ${call.id} 的结果——录制时这一步没发生过` },
      }
    )
  }
}

export interface ReplayOptions {
  policy?: ContextPolicy
  clock?: Clock
}

export async function replay(fixture: Fixture, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const sink = new MemorySink()
  const tools = new ReplayTools(fixture)
  const provider = new ReplayProvider(fixture)

  let tick = 0
  const clock: Clock = opts.clock ?? { now: () => ++tick }
  const policy: ContextPolicy = opts.policy ?? { maxTokens: 10_000_000, includeReasoning: false }

  for (const input of fixture.inputs) {
    await runTurn({ sink, provider, tools, clock, policy, model: 'replay' }, fixture.sessionId, input)
  }

  const events = sink.all()
  const divergence = compare(fixture.expectedCalls, tools.calls, events)
  return {
    ok: divergence === null,
    fixture: fixture.sessionId,
    expectedCalls: fixture.expectedCalls.length,
    actualCalls: tools.calls.length,
    divergence,
    events,
  }
}

function compare(
  expected: readonly { name: string; args: unknown }[],
  actual: readonly { name: string; args: unknown }[],
  events: readonly EventEnvelope[],
): Divergence | null {
  const n = Math.max(expected.length, actual.length)
  for (let i = 0; i < n; i++) {
    const e = expected[i]
    const a = actual[i]
    const same =
      e !== undefined && a !== undefined && e.name === a.name && stableStringify(e.args) === stableStringify(a.args)
    if (same) continue

    // AC-4：指出第一个分叉点的 seq，能直接跳到轨迹面板
    const callSeqs = events.filter((ev) => ev.ev.t === 'tool.call').map((ev) => ev.seq)
    return {
      index: i,
      expected: e === undefined ? null : { name: e.name, args: normalize(e.args) },
      actual: a === undefined ? null : { name: a.name, args: normalize(a.args) },
      seq: callSeqs[i] ?? null,
    }
  }
  return null
}

export function formatResult(r: ReplayResult): string {
  if (r.ok) return `✓ ${r.fixture} —— ${r.actualCalls} 次工具调用，与录制一致`
  const d = r.divergence
  if (!d) return `✗ ${r.fixture} —— 未知差异`
  return [
    `✗ ${r.fixture} —— 第 ${d.index + 1} 次工具调用开始分叉（事件 seq ${d.seq ?? '未产生'}）`,
    `  期望：${d.expected ? `${d.expected.name} ${JSON.stringify(d.expected.args)}` : '（没有更多调用）'}`,
    `  实际：${d.actual ? `${d.actual.name} ${JSON.stringify(d.actual.args)}` : '（没有更多调用）'}`,
    `  跳转：轨迹面板 seq ${d.seq ?? '—'}`,
  ].join('\n')
}
