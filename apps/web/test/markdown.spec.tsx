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

describe('PRD-M11-003 · 主题适配（token 类，跟随深浅与 accent 换色）', () => {
  test('容器挂 md-body，正文走 token 文字色', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'正文'}</MarkdownView>)
    expect(html).toContain('md-body')
    expect(html).toContain('text-ink')
  })

  test('标题有层级字号 + 半粗', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'# 一级\n\n## 二级'}</MarkdownView>)
    expect(html).toContain('font-semibold')
    expect(html).toContain('text-ink')
  })

  test('链接用 accent（跟随换色）', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'[点](https://a.b)'}</MarkdownView>)
    expect(html).toContain('text-accent')
  })

  test('代码块用 code 背景 + 边框，行内代码用面板背景', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'`inline`\n\n```ts\nconst a = 1\n```'}</MarkdownView>)
    expect(html).toContain('bg-code')
    expect(html).toContain('bg-panel')
  })

  test('表格表头用 panel-h 背景 + border 色', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'| a | b |\n|---|---|\n| 1 | 2 |'}</MarkdownView>)
    expect(html).toContain('bg-panel-h')
    expect(html).toContain('border-border')
  })

  test('引用用 accent 淡色左边框', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'> 引用'}</MarkdownView>)
    expect(html).toContain('border-accent-b')
  })
})
