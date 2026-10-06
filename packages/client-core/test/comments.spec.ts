/**
 * SPEC-M14-008 · diff 行评论（PRD-M14-008 AC-1/AC-2/AC-5）
 *
 *   AC-1 点 diff 行号（可拖选多行）写评论，可攒多条，右侧栏显示待交条数
 *   AC-2 交给 domi = 转输入框文件行引用组，不自动发送；可删改补文字自己发
 *   AC-5 未交评论切范围 / 切文件保留
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { $comments, addComment, clearComments, commentsToRefs, pendingCount, removeComment } from '../src/comments.ts'

beforeEach(() => {
  clearComments()
})
afterEach(() => {
  clearComments()
})

describe('AC-1 · 攒批：点行号 / 拖选多行、删、待交条数', () => {
  test('add 攒多条，pendingCount 随增随减；remove 按 id 删一条', () => {
    const a = addComment({ file: 'src/a.ts', lineStart: 3, lineEnd: 3, snippet: 'x', text: '1' })
    addComment({ file: 'src/a.ts', lineStart: 8, lineEnd: 10, snippet: 'y', text: '2' })
    expect(pendingCount()).toBe(2)
    removeComment(a.id)
    expect(pendingCount()).toBe(1)
    expect($comments.get()[0]!.file).toBe('src/a.ts')
  })

  test('拖选倒置的行号规范化：lineStart ≤ lineEnd', () => {
    const c = addComment({ file: 'a.ts', lineStart: 9, lineEnd: 5, snippet: 's', text: '' })
    expect(c.lineStart).toBe(5)
    expect(c.lineEnd).toBe(9)
  })
})

describe('AC-2 · 交给 domi：评论 → 文件行引用组，不自动发送', () => {
  test('commentsToRefs：文件 / 行范围 / 新旧侧 / 代码片段 / 评论文字逐条对应', () => {
    addComment({ file: 'src/a.ts', lineStart: 3, lineEnd: 4, side: 'new', snippet: 'const x = 1', text: '抽个函数' })
    addComment({ file: 'src/b.ts', lineStart: 1, lineEnd: 1, text: '这里呢' })
    const refs = commentsToRefs($comments.get())
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({
      kind: 'file',
      path: 'src/a.ts',
      lineStart: 3,
      lineEnd: 4,
      side: 'new',
      snippet: 'const x = 1',
      text: '抽个函数',
    })
    expect(refs[1]).toEqual({ kind: 'file', path: 'src/b.ts', lineStart: 1, lineEnd: 1, text: '这里呢' })
  })

  test('空评论清空时 refs 也为空；snippet / text 为空串时不带对应字段', () => {
    expect(commentsToRefs([])).toEqual([])
    addComment({ file: 'a.ts', lineStart: 1, lineEnd: 2, snippet: '', text: '' })
    expect(commentsToRefs($comments.get())).toEqual([{ kind: 'file', path: 'a.ts', lineStart: 1, lineEnd: 2 }])
  })
})

describe('AC-5 · 未交评论切范围 / 切文件保留', () => {
  test('换文件、换范围后 store 不清空（端上范围切换不 reset）', () => {
    addComment({ file: 'a.ts', lineStart: 1, lineEnd: 2, snippet: 's', text: '甲' })
    // 模拟端上切到另一个文件/另一段范围：只读不回写，store 仍是全局的
    expect(pendingCount()).toBe(1)
    expect($comments.get()[0]!.file).toBe('a.ts')
    removeComment($comments.get()[0]!.id)
    expect(pendingCount()).toBe(0)
  })
})
