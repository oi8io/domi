/** PRD-M13-001 · 补充能被搜到（SPEC-M13-001 取舍-3 影响清单） */
import { describe, expect, test } from 'bun:test'
import { searchableText } from '../src/index.ts'

describe('PRD-M13-001 AC-4 · 检索覆盖补充', () => {
  test('user.note 的文字可检索', () => {
    expect(searchableText({ t: 'user.note', id: 'n-1', text: '文件在 src/ 下' })).toBe('文件在 src/ 下')
  })
})
