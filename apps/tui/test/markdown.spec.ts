/**
 * TUI Markdown 渲染层 —— PRD-M11-003 AC-6/AC-7/AC-8 · SPEC-M11-008
 *
 * 只测 mdast → Block 的纯函数（parseMarkdownBlocks + hasMarkdownStructure），
 * 不碰 Ink 渲染——颜色映射在 Transcript 层，ANSI 视觉走真终端手测。
 */
import { describe, expect, test } from 'bun:test'
import { hasMarkdownStructure, parseMarkdownBlocks } from '../src/render/markdown.ts'

describe('PRD-M11-003 AC-6 · 各语法样例 → 块结构', () => {
  test('标题层级', () => {
    const b = parseMarkdownBlocks('# 一级\n\n### 三级')
    expect(b).toEqual([
      { kind: 'heading', level: 1, children: [{ text: '一级', style: 'plain' }] },
      { kind: 'heading', level: 3, children: [{ text: '三级', style: 'plain' }] },
    ])
  })

  test('无序列表', () => {
    const b = parseMarkdownBlocks('- 甲\n- 乙')
    expect(b).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: '甲', style: 'plain' }], [{ text: '乙', style: 'plain' }]] },
    ])
  })

  test('有序列表', () => {
    const b = parseMarkdownBlocks('1. 甲\n2. 乙')
    expect(b).toEqual([
      { kind: 'list', ordered: true, items: [[{ text: '甲', style: 'plain' }], [{ text: '乙', style: 'plain' }]] },
    ])
  })

  test('代码块含语言标注', () => {
    const b = parseMarkdownBlocks('```ts\nconst a = 1\n```')
    expect(b).toEqual([{ kind: 'code', lang: 'ts', code: 'const a = 1' }])
  })

  test('行内代码 / 粗体 / 删除线', () => {
    const b = parseMarkdownBlocks('这是 `code` 和 **bold** 和 ~~del~~')
    expect(b[0]).toEqual({
      kind: 'para',
      children: [
        { text: '这是 ', style: 'plain' },
        { text: 'code', style: 'code' },
        { text: ' 和 ', style: 'plain' },
        { text: 'bold', style: 'bold' },
        { text: ' 和 ', style: 'plain' },
        { text: 'del', style: 'del' },
      ],
    })
  })

  test('链接带 url', () => {
    const b = parseMarkdownBlocks('[点这里](https://a.b/c)')
    expect(b[0]).toEqual({
      kind: 'para',
      children: [{ text: '点这里', style: 'link', url: 'https://a.b/c' }],
    })
  })

  test('引用', () => {
    const b = parseMarkdownBlocks('> 一段引用')
    expect(b).toEqual([{ kind: 'quote', children: [{ text: '一段引用', style: 'plain' }] }])
  })

  test('GFM 表格', () => {
    const b = parseMarkdownBlocks('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(b).toEqual([
      {
        kind: 'table',
        align: ['left', 'left'],
        headers: [[{ text: 'a', style: 'plain' }], [{ text: 'b', style: 'plain' }]],
        rows: [[[{ text: '1', style: 'plain' }], [{ text: '2', style: 'plain' }]]],
      },
    ])
  })

  test('hasMarkdownStructure：有结构为 true', () => {
    expect(hasMarkdownStructure(parseMarkdownBlocks('# 标题'))).toBe(true)
    expect(hasMarkdownStructure(parseMarkdownBlocks('- 甲'))).toBe(true)
    expect(hasMarkdownStructure(parseMarkdownBlocks('有 **粗体**'))).toBe(true)
    expect(hasMarkdownStructure(parseMarkdownBlocks('```\nx\n```'))).toBe(true)
  })
})

describe('PRD-M11-003 AC-7 · 纯文本零变化', () => {
  test('不含语法的普通回复 = 单个纯 para，且无结构标记', () => {
    const md = '我先读一下 sum.js。'
    const b = parseMarkdownBlocks(md)
    expect(b).toEqual([{ kind: 'para', children: [{ text: md, style: 'plain' }] }])
    expect(hasMarkdownStructure(b)).toBe(false)
  })

  test('带换行的纯文本仍无结构标记（soft break 不走 markdown 路径）', () => {
    const b = parseMarkdownBlocks('第一行\n第二行')
    expect(hasMarkdownStructure(b)).toBe(false)
  })
})

describe('PRD-M11-003 AC-8 · HTML 不解释 + 降级', () => {
  test('原文里的 <script> 不产出文本（html 节点跳过）', () => {
    const b = parseMarkdownBlocks('<script>alert(1)</script>')
    const text = JSON.stringify(b)
    expect(text).not.toContain('alert(1)')
    expect(text).not.toContain('<script')
  })

  test('解析异常降级：非法输入不抛，退回原文', () => {
    // remark 对任意字符串都容错，这里锁的是「不抛异常」这一契约
    expect(() => parseMarkdownBlocks('```\n未闭合')).not.toThrow()
  })
})
