/**
 * PRD-M14-010 AC-4 · SPEC-M14-010 取舍-3
 *
 * store.$dead：被 revert 作废的 seq 集合（INV-01 / INV-12——事件还在，投影标 dead）。
 * 端上据此在对话与右侧栏标「已回滚」但可读；files 范围不动对话，conversation/both 才作废。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { createSessionStore } from '../src/index.ts'

const env = (seq: number, ev: EventEnvelope['ev']): EventEnvelope => ({
  seq,
  sessionId: 't1',
  parentSeq: null,
  ts: seq,
  schemaVersion: 15,
  ev,
})

describe('PRD-M14-010 AC-4 · store.$dead 投影', () => {
  test('conversation / both 范围的 revert：区间内已有事件标 dead，revert 事件本身不在', () => {
    const store = createSessionStore()
    // 1 user.input … 20 tool.call；21 revert（conversation，toSeq=1）→ 2..20 dead（事件流里只有 seq 20）
    store.applyEvents([
      env(1, { t: 'user.input', text: '改', refs: [] }),
      env(20, { t: 'tool.call', id: 'w1', name: 'fs.write', args: {} }),
      env(21, { t: 'revert', toSeq: 1, scope: 'conversation', snapshotId: null, undoSnapshotId: null }),
    ])
    const dead = store.$dead.get()
    expect(dead.has(20)).toBe(true)
    expect(dead.has(1)).toBe(false)
    expect(dead.has(2)).toBe(false) // 没有 seq 2 事件
    expect(dead.has(21)).toBe(false)
  })

  test('files 范围不动对话：$dead 为空', () => {
    const store = createSessionStore()
    store.applyEvents([
      env(1, { t: 'user.input', text: '改', refs: [] }),
      env(20, { t: 'tool.call', id: 'w1', name: 'fs.write', args: {} }),
      env(21, { t: 'revert', toSeq: 1, scope: 'files', snapshotId: 's', undoSnapshotId: 'u' }),
    ])
    expect(store.$dead.get().size).toBe(0)
  })

  test('连续两次回滚：$dead 覆盖到最早（AC-4 回到初始）', () => {
    const store = createSessionStore()
    store.applyEvents([
      env(1, { t: 'user.input', text: '改', refs: [] }),
      env(20, { t: 'tool.call', id: 'w1', name: 'fs.write', args: {} }),
      env(21, { t: 'user.input', text: '再改', refs: [] }),
      env(40, { t: 'tool.call', id: 'w2', name: 'fs.write', args: {} }),
      env(41, { t: 'revert', toSeq: 21, scope: 'both', snapshotId: 's', undoSnapshotId: 'u' }),
      env(42, { t: 'revert', toSeq: 1, scope: 'both', snapshotId: 's', undoSnapshotId: 'u' }),
    ])
    const dead = store.$dead.get()
    // 第二次覆盖到最早：20 / 40 / 41 都被作废（回到初始），revert 事件本身不在
    expect(dead.has(20)).toBe(true)
    expect(dead.has(21)).toBe(true) // 第二轮 user.input 也被第二次 revert 作废
    expect(dead.has(40)).toBe(true)
    expect(dead.has(41)).toBe(true)
    expect(dead.has(1)).toBe(false)
    expect(dead.has(42)).toBe(false)
    expect(dead.size).toBe(4)
  })

  test('prependEvents 补历史后 dead 仍按事件流重算', () => {
    const store = createSessionStore()
    store.applyEvents([
      env(5, { t: 'user.input', text: '改', refs: [] }),
      env(20, { t: 'tool.call', id: 'w1', name: 'fs.write', args: {} }),
      env(21, { t: 'revert', toSeq: 5, scope: 'conversation', snapshotId: null, undoSnapshotId: null }),
    ])
    // 翻页补 1..4
    store.prependEvents([
      env(1, { t: 'user.input', text: '早', refs: [] }),
      env(2, { t: 'user.input', text: '更早', refs: [] }),
      env(3, { t: 'user.input', text: '最早', refs: [] }),
      env(4, { t: 'user.input', text: '起', refs: [] }),
    ])
    const dead = store.$dead.get()
    // 6..20 作废：事件流里只有 20 被标；补的 1..4 与 revert 21 不在
    expect(dead.has(20)).toBe(true)
    expect(dead.has(4)).toBe(false)
    expect(dead.has(5)).toBe(false)
    expect(dead.has(21)).toBe(false)
    expect(dead.size).toBe(1)
  })
})
