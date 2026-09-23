/**
 * 代码块语法高亮 —— PRD-M11-003 AC-9（v1.16 回写）· ADR-028
 *
 * 一份分词给两端用：Web 画成带颜色的 span，TUI 画成带颜色的 Text。配色是 Primer 的语法色（与主题同源）。
 */
import { describe, expect, test } from 'bun:test'
import { highlightLines, SUPPORTED_LANGS, type SyntaxSpan } from '../src/highlight.ts'
import { SYNTAX, SYNTAX_KINDS } from '../src/tokens.ts'

const kindsOf = (code: string, lang: string): Array<[string, SyntaxSpan['kind']]> =>
  highlightLines(code, lang)
    .flat()
    .filter((s) => s.kind !== 'plain' && s.text.trim() !== '')
    .map((s) => [s.text, s.kind])

describe('PRD-M11-003 AC-9 · 分词', () => {
  test('关键字 / 字符串 / 注释 / 数字各归各类', () => {
    const k = kindsOf('const a = "x" + 1 // hi', 'ts')
    expect(k).toContainEqual(['const', 'keyword'])
    expect(k).toContainEqual(['"x"', 'string'])
    expect(k).toContainEqual(['1', 'constant'])
    expect(k).toContainEqual(['// hi', 'comment'])
  })

  test('按行切：跨行的注释 / 字符串也落到各自的行上，每行拼回去与原文一字不差', () => {
    const code = 'function f() {\n  /* a\n  b */\n  return `x\ny`\n}'
    const lines = highlightLines(code, 'javascript')
    expect(lines.map((l) => l.map((s) => s.text).join(''))).toEqual(code.split('\n'))
    expect(lines[2]?.some((s) => s.kind === 'comment')).toBe(true)
  })

  test('常用别名都认（ts / tsx / js / sh / zsh / py / yml / rs / md / html）', () => {
    for (const lang of ['ts', 'tsx', 'js', 'sh', 'zsh', 'py', 'yml', 'rs', 'md', 'html', 'json', 'diff', 'sql', 'go']) {
      expect(SUPPORTED_LANGS.has(lang)).toBe(true)
    }
  })

  test('不认识的语言、没写语言：不猜，整行按纯文本（不误染色）', () => {
    for (const lang of ['', 'brainfuck', 'text']) {
      const lines = highlightLines('if x then y\nz', lang)
      expect(lines).toEqual([[{ text: 'if x then y', kind: 'plain' }], [{ text: 'z', kind: 'plain' }]])
    }
  })

  test('配色：每一类在深浅两套主题里都有颜色', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const k of SYNTAX_KINDS) expect(SYNTAX[mode][k]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
