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

describe('PRD-M7-006 AC-2 / AC-3 · TUI 的改动审阅命令', () => {
  test('/changes 列清单，给文件名看 diff', () => {
    expect(parseSlash('/changes', 3)).toEqual({ kind: 'changes' })
    expect(parseSlash('/changes src/a.ts', 3)).toEqual({ kind: 'changes', path: 'src/a.ts' })
  })

  test('/discard 逐文件丢弃，/undo 按回收站编号撤销', () => {
    expect(parseSlash('/discard src/a.ts', 3)).toEqual({ kind: 'discard', path: 'src/a.ts' })
    expect(parseSlash('/discard', 3)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/undo 12', 3)).toEqual({ kind: 'undo', trash: '12' })
    expect(parseSlash('/undo abc', 3)).toMatchObject({ kind: 'invalid' })
  })

  test('/apply 默认 squash，三种方式之外的拒绝（带回本身还要在确认框里批准）', () => {
    expect(parseSlash('/apply', 3)).toEqual({ kind: 'apply', mode: 'squash' })
    expect(parseSlash('/apply merge', 3)).toEqual({ kind: 'apply', mode: 'merge' })
    expect(parseSlash('/apply branch', 3)).toEqual({ kind: 'apply', mode: 'branch' })
    expect(parseSlash('/apply force', 3)).toMatchObject({ kind: 'invalid' })
  })
})
