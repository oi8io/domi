import { describe, expect, test } from 'bun:test'
import { parseSlash } from '../src/commands.ts'

describe('斜杠命令', () => {
  test('普通文字照常提交；/compact 与 /model 不变', () => {
    expect(parseSlash('你好', 3)).toEqual({ kind: 'submit', text: '你好' })
    expect(parseSlash('/compact', 3)).toEqual({ kind: 'compact' })
    expect(parseSlash('/model glm-4.6 anthropic', 3)).toEqual({
      kind: 'model',
      model: 'glm-4.6',
      provider: 'anthropic',
    })
    expect(parseSlash('/model', 3).kind).toBe('invalid')
  })

  test('/ref 会话 [起-止]：记下一个引用，下一句话带上（PRD-M3-005）', () => {
    expect(parseSlash('/ref s-abc', 3)).toEqual({
      kind: 'ref',
      ref: { sessionId: 's-abc', fromSeq: 1, toSeq: Number.MAX_SAFE_INTEGER },
    })
    expect(parseSlash('/ref s-abc 4-9', 3)).toEqual({ kind: 'ref', ref: { sessionId: 's-abc', fromSeq: 4, toSeq: 9 } })
    expect(parseSlash('/ref s-abc 7', 3)).toEqual({ kind: 'ref', ref: { sessionId: 's-abc', fromSeq: 7, toSeq: 7 } })
    expect(parseSlash('/ref', 3)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/ref s 9-4', 3)).toMatchObject({ kind: 'invalid' })
  })

  test('/branch 不带数字从最后一条分，带数字从那一条分（parity 第 7 项）', () => {
    expect(parseSlash('/branch', 12)).toEqual({ kind: 'branch', atSeq: 12 })
    expect(parseSlash('/branch 5', 12)).toEqual({ kind: 'branch', atSeq: 5 })
    expect(parseSlash('/branch', 0)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('空') })
    expect(parseSlash('/branch x', 12)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/branch 0', 12)).toMatchObject({ kind: 'invalid' })
  })
})
