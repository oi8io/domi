/**
 * TUI 的 Markdown 排版 —— PRD-M11-003 AC-6 / AC-9（v1.16 回写：与 Web 同一套排版原则 + 语法高亮）
 *
 * 标题不带 #、只靠粗细和颜色分层；代码块带语言头与左边线；表格只留横线、中文按显示宽度对齐；块与块之间空一行。
 */
import { describe, expect, test } from 'bun:test'
import stringWidth from 'string-width'
import { MarkdownBlocks } from '../src/components/Transcript.tsx'
import { parseMarkdownBlocks } from '../src/render/markdown.ts'
import { makeTheme } from '../src/theme.ts'
import { renderAt } from './render.tsx'

const MD = `## 修复方案

1. 广播给所有 watcher
2. \`unwatch()\` 只清自己

\`\`\`ts
const a = "x" // hi
\`\`\`

| 文件 | 风险 |
|---|---|
| core.ts | 低 |

> 注意：refs 不受影响`

async function frame(md: string, width = 80): Promise<string> {
  const h = renderAt(width, <MarkdownBlocks blocks={parseMarkdownBlocks(md)} />)
  await h.flush()
  const f = h.lastFrame()
  h.unmount()
  return f
}

describe('PRD-M11-003 AC-6 · 终端排版', () => {
  test('标题不带 #；块与块之间空一行', async () => {
    const lines = (await frame(MD)).split('\n')
    expect(lines.some((l) => l.includes('## '))).toBe(false)
    const i = lines.findIndex((l) => l.includes('修复方案'))
    expect(lines[i + 1]?.trim()).toBe('')
  })

  test('代码块：语言头 + 左边线；表格不用竖线，用一条横线分表头', async () => {
    const f = await frame(MD)
    expect(f).toContain('╭─ ts')
    expect(f).toContain('│ const a = "x" // hi')
    expect(f).toContain('╰─')
    expect(f).not.toMatch(/\| 文件/)
    expect(f).toMatch(/─{4,}/)
  })

  test('表格里的中文按显示宽度对齐（一个汉字占两格）', async () => {
    const f = await frame('| 名字 | 说明 |\n|---|---|\n| 很长的中文名字 | x |\n| a | y |')
    const rows = f.split('\n').filter((l) => /说明|x\s*$|y\s*$/.test(l))
    const col = rows.map((r) => stringWidth(r.slice(0, r.search(/说明|x\s*$|y\s*$/))))
    expect(new Set(col).size).toBe(1)
  })
})

describe('PRD-M11-003 AC-9 · 终端语法高亮', () => {
  test('真彩色终端：语法色就是 Web 那份 SYNTAX；16 色终端退到终端自己的色名；NO_COLOR 不上色', () => {
    const tc = makeTheme({ mode: 'dark', env: { COLORTERM: 'truecolor' } })
    expect(tc.syntax('keyword')).toEqual({ color: '#ff7b72' })
    expect(tc.syntax('string')).toEqual({ color: '#a5d6ff' })
    expect(makeTheme({ mode: 'light', env: { COLORTERM: 'truecolor' } }).syntax('keyword')).toEqual({
      color: '#cf222e',
    })
    expect(makeTheme({ mode: 'dark', env: {} }).syntax('keyword')).toEqual({ color: 'red' })
    expect(makeTheme({ mode: 'dark', env: { NO_COLOR: '1' } }).syntax('keyword')).toEqual({})
    expect(tc.syntax('plain')).toEqual(tc.fg('ink2'))
  })

  test('着色不改字：代码块每一行拼回去与原文一致', async () => {
    const code = 'function f(a: number) {\n  return a + 1 // ok\n}'
    const f = await frame(`\`\`\`ts\n${code}\n\`\`\``)
    for (const line of code.split('\n')) expect(f).toContain(`│ ${line}`)
  })
})
