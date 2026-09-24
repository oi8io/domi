/** PRD-M13-001 · 跨会话引用里的补充（SPEC-M13-001 取舍-3 影响清单） */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { renderRef } from '../src/index.ts'

const env = (seq: number, ev: DomiEvent): EventEnvelope => ({
  seq,
  sessionId: 'a',
  parentSeq: seq > 1 ? seq - 1 : null,
  ts: seq,
  schemaVersion: 15,
  ev,
})

describe('PRD-M13-001 AC-4 · 引用片段里有补充', () => {
  test('按用户文字渲染，带「补充」标注', () => {
    const out = renderRef({ sessionId: 'a', fromSeq: 1, toSeq: 2 }, [
      env(1, { t: 'user.input', text: '改一下' }),
      env(2, { t: 'user.note', id: 'n-1', text: '文件在 src/ 下' }),
    ])
    expect(out).toContain('用户：改一下')
    expect(out).toContain('用户（补充）：文件在 src/ 下')
  })
})
