/** 新消息浮条 —— PRD-M11-002 AC-2/AC-3（用户上翻后，新内容来了点它回底部） */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { JumpBar } from '../src/session/JumpBar.tsx'

describe('PRD-M11-002 · 上翻后的新消息提示浮条', () => {
  test('count > 0 时显示计数（纯展示组件，SSR 可测）', () => {
    const html = renderToStaticMarkup(<JumpBar count={3} onClick={() => undefined} />)
    expect(html).toContain('3')
    expect(html).toContain('新消息')
  })
  test('count = 0 时不渲染任何东西', () => {
    const html = renderToStaticMarkup(<JumpBar count={0} onClick={() => undefined} />)
    expect(html).toBe('')
  })
})
