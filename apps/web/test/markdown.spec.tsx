/** Markdown 渲染 —— PRD-M11-003（Web 侧；排版对齐原型，v1.16 回写 AC-9 语法高亮） */
import { describe, expect, test } from 'bun:test'
import { highlightLines } from '@domi/client-core/highlight'
import { renderToStaticMarkup } from 'react-dom/server'
import { HighlightedCode, MarkdownView } from '../src/session/MarkdownView.tsx'

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

  test('表格是卡片：外框 + panel 表头 + 只有横线，宽度跟着内容（不撑满）', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'| a | b |\n|---|---|\n| 1 | 2 |'}</MarkdownView>)
    const wrap = html.match(/<div[^>]*data-part="md-table"[^>]*>/)?.[0] ?? ''
    expect(wrap).toContain('w-fit')
    expect(wrap).toContain('border-border2')
    expect(html).toMatch(/<thead class="bg-panel"/)
    // 没有竖线：单元格不带左右边框
    expect(html).not.toMatch(/<t[dh][^>]*class="[^"]*\bborder\b[^-]/)
  })

  test('引用与「思考」同一个样子：灰色左边线 + 次要色', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'> 引用'}</MarkdownView>)
    expect(html).toContain('border-l-2 border-border')
    expect(html).toContain('text-mut')
    expect(html).not.toContain('border-accent-b')
  })
})

describe('PRD-M11-003 · 排版对齐原型（2026-09-23）', () => {
  test('标题是小阶梯：h1 16px、h2 15px、h3 14px，h1 / h2 带细分隔线', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'# 一\n\n## 二\n\n### 三'}</MarkdownView>)
    expect(html).toMatch(/<h1[^>]*text-\[16px\]/)
    expect(html).toMatch(/<h2[^>]*text-\[15px\]/)
    expect(html).toMatch(/<h3[^>]*text-\[14px\]/)
    expect(html).toMatch(/<h1[^>]*border-b border-border2/)
  })

  test('代码块是和工具调用同一套的卡片：语言头 + 复制按钮 + 12px 等宽正文（字号不再缩两次）', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'```ts\nconst a = 1\n```'}</MarkdownView>)
    expect(html).toContain('data-part="code-block"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('data-action="copy-code"')
    expect(html).toMatch(/<pre[^>]*text-\[12px\]/)
    // 代码块里的 <code> 不带行内代码的底色 / 边框
    expect(html).toMatch(/<pre[^>]*><code>const a = 1<\/code><\/pre>/)
  })

  test('没写语言的代码块：头上写「代码」', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'```\nplain\n```'}</MarkdownView>)
    expect(html).toContain('data-lang=""')
    expect(html).toContain('>代码<')
  })

  test('行内代码有细边框（浅色主题下也看得见），列表序号用次要色', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'1. 用 `x`'}</MarkdownView>)
    expect(html).toMatch(/<code class="[^"]*border border-border2 bg-panel/)
    expect(html).toContain('marker:text-mut')
  })
})

describe('PRD-M11-003 AC-9 · 语法高亮（按需加载，先纯文本再着色）', () => {
  test('首屏（SSR）是纯文本：高亮器没加载前不阻塞渲染', () => {
    const html = renderToStaticMarkup(<MarkdownView>{'```ts\nconst a = 1\n```'}</MarkdownView>)
    expect(html).not.toContain('data-syn')
  })

  test('着色后：每一类用 --syn-* 变量上色（跟深浅主题走），文字一字不差', () => {
    const lines = highlightLines('const a = "x" // hi\nreturn a', 'ts')
    const html = renderToStaticMarkup(<HighlightedCode lines={lines} />)
    expect(html).toContain('text-[var(--syn-keyword)]')
    expect(html).toContain('text-[var(--syn-string)]')
    expect(html).toContain('text-[var(--syn-comment)]')
    expect(html.replace(/<[^>]+>/g, '')).toBe('const a = &quot;x&quot; // hi\nreturn a')
  })
})
