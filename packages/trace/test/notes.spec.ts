/** PRD-M13-001 · 轨迹里补充是独立节点（SPEC-M13-001 取舍-3 影响清单） */
import { describe, expect, test } from 'bun:test'
import { tr } from '@domi/i18n'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { buildTrace, findBySeq } from '../src/index.ts'

const env = (seq: number, ev: DomiEvent): EventEnvelope => ({
  seq,
  sessionId: 's',
  parentSeq: seq > 1 ? seq - 1 : null,
  ts: seq,
  schemaVersion: 15,
  ev,
})

describe('PRD-M13-001 AC-5 · 轨迹', () => {
  test('补充是一个输入节点，标题和「你说」区分开', () => {
    const t = buildTrace([
      env(1, { t: 'user.input', text: '改一下' }),
      env(2, { t: 'user.note', id: 'n-1', text: '补一句' }),
    ])
    const n = findBySeq(t, 2)
    expect(n?.kind).toBe('input')
    expect(n?.detail).toBe('补一句')
    expect(n?.title).toBe(tr('trace.youAdded'))
    expect(n?.title).not.toBe(tr('trace.youSaid'))
  })
})
