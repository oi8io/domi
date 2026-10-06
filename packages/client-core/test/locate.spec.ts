/**
 * TASK-M14-005 · 双向联动纯函数测试（PRD-M14-002 AC-1）
 * 测试先行：先写失败测试，再实现 locate.ts。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { changeFileSeq } from '../src/changes.ts'
import { locateInTranscript } from '../src/locate.ts'
import { createSessionStore } from '../src/store.ts'

function env(seq: number, ts: number, ev: Record<string, unknown>): EventEnvelope {
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts, schemaVersion: 16, ev: ev as never }
}

describe('locateInTranscript · seq → 窗口内 / 需补拉（AC-1）', () => {
  function storeWith(evs: EventEnvelope[], oldest: number | null, hasOlder: boolean) {
    const store = createSessionStore()
    store.applyEvents(evs)
    store.setWindowMeta({ oldestSeq: oldest ?? 0, hasOlder })
    return store
  }

  test('seq 在已加载窗口内且有条目 → loaded + 正确 index', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: 'a' }),
      env(2, 2000, { t: 'model.delta', text: 'b' }),
      env(3, 3000, { t: 'tool.call', id: 'c1', name: 'fs.write', args: { path: 'a.ts' } }),
      env(4, 4000, { t: 'tool.result', id: 'c1', ok: true, payload: {} }),
    ]
    const store = storeWith(evs, 1, false)
    const items = store.$items.get()
    // 每个事件都有独立条目（tool-result 在 $items 里，渲染时才配组）
    expect(items.map((i) => i.seq)).toEqual([1, 2, 3, 4])
    expect(locateInTranscript(store, 1)).toEqual({ kind: 'loaded', itemIndex: 0 })
    expect(locateInTranscript(store, 2)).toEqual({ kind: 'loaded', itemIndex: 1 })
    expect(locateInTranscript(store, 3)).toEqual({ kind: 'loaded', itemIndex: 2 })
    expect(locateInTranscript(store, 4)).toEqual({ kind: 'loaded', itemIndex: 3 })
    // 超过已加载头部 → missing（事件流连续，窗口内不会有空洞）
    expect(locateInTranscript(store, 5)).toEqual({ kind: 'missing' })
  })

  test('seq 在窗口外（更早）→ needOlder（补拉条件）', () => {
    const evs = [env(5, 1000, { t: 'user.input', text: 'a' }), env(6, 2000, { t: 'model.delta', text: 'b' })]
    const store = storeWith(evs, 5, true)
    expect(locateInTranscript(store, 3)).toEqual({ kind: 'needOlder' })
  })

  test('空窗口：还有更早 → needOlder；没有 → missing', () => {
    const s1 = storeWith([], null, true)
    expect(locateInTranscript(s1, 2)).toEqual({ kind: 'needOlder' })
    const s2 = storeWith([], null, false)
    expect(locateInTranscript(s2, 2)).toEqual({ kind: 'missing' })
  })

  test('seq 超过已加载头部 → missing（不在窗口里）', () => {
    const evs = [env(1, 1000, { t: 'user.input', text: 'a' }), env(2, 2000, { t: 'model.delta', text: 'b' })]
    const store = storeWith(evs, 1, false)
    expect(locateInTranscript(store, 99)).toEqual({ kind: 'missing' })
  })
})

describe('changeFileSeq · 改动文件 → 首个 fs.snapshot seq（AC-1 映射）', () => {
  const evs = [
    env(1, 1000, { t: 'user.input', text: 'hi' }),
    env(2, 2000, { t: 'fs.snapshot', path: 'a.ts', phase: 'before', sha256: null, bytes: 1 }),
    env(3, 3000, { t: 'fs.snapshot', path: 'b.ts', phase: 'before', sha256: null, bytes: 2 }),
    env(4, 4000, { t: 'fs.snapshot', path: 'a.ts', phase: 'after', sha256: 'h', bytes: 2 }),
  ]

  test('范围内该文件第一次出现的 seq；区间外 / 没出现 → null', () => {
    expect(changeFileSeq(evs, 'a.ts', 2, 4)).toBe(2)
    expect(changeFileSeq(evs, 'b.ts', 2, 4)).toBe(3)
    expect(changeFileSeq(evs, 'a.ts', 3, 4)).toBe(4) // 区间内第一次
    expect(changeFileSeq(evs, 'a.ts', 1, 1)).toBeNull() // 区间外
    expect(changeFileSeq(evs, 'c.ts', 1, 4)).toBeNull() // 没出现
  })
})
