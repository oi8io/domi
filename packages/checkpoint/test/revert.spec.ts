/**
 * PRD-M1-011 AC-3 · 三种回滚粒度与 append-only 语义（INV-01 / INV-12）
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { REVERT_SIDE_EFFECT_NOTICE, deadRanges, isDead, liveEvents, projectAfterReverts } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: seq > 1 ? seq - 1 : null, ts: 0, schemaVersion: 3, ev }
}

function scenario(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '第一轮' }), // 1
    env({ t: 'model.delta', text: '回答一' }), // 2
    env({ t: 'user.input', text: '第二轮' }), // 3
    env({ t: 'model.delta', text: '回答二' }), // 4
    env({ t: 'tool.call', id: 'c1', name: 'fs.write', args: {} }), // 5
    env({ t: 'tool.result', id: 'c1', ok: true, payload: {}, ms: 1 }), // 6
  ]
}

describe('AC-3 · revert 不删除任何事件', () => {
  test('回滚到 seq 2：3–6 标记为 dead，但一条不少', () => {
    const events = [
      ...scenario(),
      env({ t: 'revert', toSeq: 2, scope: 'both', snapshotId: 'abc', undoSnapshotId: 'def' }), // 7
    ]
    const projected = projectAfterReverts(events)

    expect(projected).toHaveLength(7)
    expect(projected.filter((e) => e.dead).map((e) => e.seq)).toEqual([3, 4, 5, 6])
    expect(projected.filter((e) => !e.dead).map((e) => e.seq)).toEqual([1, 2, 7])
    // 被标 dead 的事件**内容还在**，轨迹能展开看
    expect(projected.find((e) => e.seq === 4)?.ev).toEqual({ t: 'model.delta', text: '回答二' })
  })

  test('喂给模型的上下文不含作废段，也不含 revert 本身', () => {
    const events = [
      ...scenario(),
      env({ t: 'revert', toSeq: 2, scope: 'both', snapshotId: 'abc', undoSnapshotId: 'def' }),
    ]
    expect(liveEvents(events).map((e) => e.seq)).toEqual([1, 2])
  })

  test('scope 为 files 时只回滚文件，对话**不**作废', () => {
    const events = [
      ...scenario(),
      env({ t: 'revert', toSeq: 2, scope: 'files', snapshotId: 'abc', undoSnapshotId: 'def' }),
    ]
    expect(deadRanges(events)).toEqual([])
    expect(projectAfterReverts(events).every((e) => !e.dead)).toBe(true)
  })

  test('scope 为 conversation 时对话作废（文件由调用方决定不动）', () => {
    const events = [
      ...scenario(),
      env({ t: 'revert', toSeq: 4, scope: 'conversation', snapshotId: null, undoSnapshotId: null }),
    ]
    expect(deadRanges(events)).toEqual([{ fromSeq: 5, toSeq: 6 }])
  })
})

describe('AC-4 · 连续两次回滚', () => {
  test('第二次回滚把第一次也作废掉，回到最初', () => {
    const base = scenario()
    const events = [
      ...base,
      env({ t: 'revert', toSeq: 4, scope: 'both', snapshotId: 'a', undoSnapshotId: 'u1' }), // 7 → 5,6 dead
      env({ t: 'revert', toSeq: 2, scope: 'both', snapshotId: 'b', undoSnapshotId: 'u2' }), // 8 → 3..7 dead
    ]
    expect(liveEvents(events).map((e) => e.seq)).toEqual([1, 2])
    // 第一次回滚事件自身也被第二次盖掉了 —— 这正是「回滚可回滚」在事件流上的样子
    expect(isDead(7, deadRanges(events))).toBe(true)
  })
})

describe('AC-6 · 副作用范围提示', () => {
  test('文案明说 shell 命令、网络请求、已 push 的 commit 不会被撤销', () => {
    expect(REVERT_SIDE_EFFECT_NOTICE).toContain('shell 命令')
    expect(REVERT_SIDE_EFFECT_NOTICE).toContain('网络请求')
    expect(REVERT_SIDE_EFFECT_NOTICE).toContain('push')
  })
})
