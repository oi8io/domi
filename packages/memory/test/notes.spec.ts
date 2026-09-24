/** PRD-M13-001 AC-4 · 补充参与压缩 / 清理 / 记忆抽取，但不是轮（SPEC-M13-001 取舍-3 影响清单 · INV-12） */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { applyCleanup, projectText, transcriptOf } from '../src/index.ts'

const env = (seq: number, ev: DomiEvent): EventEnvelope => ({
  seq,
  sessionId: 's',
  parentSeq: seq > 1 ? seq - 1 : null,
  ts: seq,
  schemaVersion: 15,
  ev,
})

describe('PRD-M13-001 AC-4 · 记忆层认得补充', () => {
  test('清理投影：补充的文字就是它占的上下文', () => {
    expect(projectText({ t: 'user.note', id: 'n-1', text: '顺便跑测试' })).toBe('顺便跑测试')
  })

  test('清理后补充原样保留（用户内容不被改写）', () => {
    const evs = [env(1, { t: 'user.input', text: 'a' }), env(2, { t: 'user.note', id: 'n-1', text: '补一句' })]
    expect(applyCleanup(evs)[1]!.ev).toEqual({ t: 'user.note', id: 'n-1', text: '补一句' })
  })

  test('记忆抽取的对话稿里有补充，标明是补充', () => {
    const text = transcriptOf([
      env(1, { t: 'user.input', text: '改一下' }),
      env(2, { t: 'user.note', id: 'n-1', text: '文件在 src/ 下' }),
    ])
    expect(text).toContain('[1] 用户：改一下')
    expect(text).toContain('[2] 用户（补充）：文件在 src/ 下')
  })
})
