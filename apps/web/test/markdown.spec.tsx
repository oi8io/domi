/** Markdown 渲染 —— PRD-M11-003（只 Web） */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '../src/session/MarkdownView.tsx'

describe('PRD-M11-003 · assistant 文本 Markdown 渲染', () => {
  test('代码块渲染成 <pre><code>（可选中复制）', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'```ts\nconst a = 1\n```'}</MarkdownView>)
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
    expect(html).toContain('const a = 1')
  })

  test('粗体 / 行内代码 / 标题渲染', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'# 标题\n\n**粗体** 和 `inline`'}</MarkdownView>)
    expect(html).toContain('<h1')
    expect(html).toContain('<strong')
    expect(html).toContain('<code')
  })

  test('GFM 表格渲染', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |'
    const html = renderToStaticMarkup(<MarkdownView>{md}</MarkdownView>)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
  })
})

describe('PRD-M11-003 AC-4 · XSS 安全', () => {
  test('原文里的 <script> 不渲染成真实标签（react-markdown 默认不开 raw HTML）', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'<script>alert(1)</script>'}</MarkdownView>)
    expect(html).not.toContain('<script')
  })

  test('javascript: 链接被净化', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'[x](javascript:alert(1))'}</MarkdownView>)
    expect(html).not.toContain('javascript:alert(1)')
  })
})
