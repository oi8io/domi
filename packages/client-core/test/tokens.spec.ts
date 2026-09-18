/**
 * 设计 token 的唯一来源 —— PRD-M8-001 AC-1 / AC-4 / AC-6
 *
 * 三件事各自有机器判据：
 * 1. token 取值与 HANDOFF §1 的表格逐项一致（AC-1）
 * 2. 实心按钮（accent-emphasis 底 + 白字）对比度 ≥ 4.5:1，5 个色板 × 深浅两套（AC-4）
 * 3. Web 的 globals.css 与 TUI 的配色都从 tokens.ts 来（AC-6）——这里断言 CSS 里的取值就是 TOKENS
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, DEFAULT_PALETTE, PALETTES, paletteOf, type ThemeMode, TOKENS } from '../src/index.ts'

const root = join(import.meta.dir, '..', '..', '..')
const handoff = readFileSync(join(root, 'docs/ui-redesign/HANDOFF.md'), 'utf8')
const css = readFileSync(join(root, 'apps/web/src/globals.css'), 'utf8')

/** HANDOFF §1 的表格：`| \`--bg\` | \`#0d1117\` | \`#fff\` | …` */
function handoffPalette(): Record<string, { dark: string; light: string }> {
  const out: Record<string, { dark: string; light: string }> = {}
  for (const line of handoff.split('\n')) {
    const m = line.match(/^\|\s*`--([a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/)
    if (m) out[m[1] as string] = { dark: m[2] as string, light: m[3] as string }
  }
  return out
}

/** globals.css 里某一套主题下的变量表 */
function cssVars(selector: string): Record<string, string> {
  const at = css.indexOf(selector)
  const body = css.slice(at, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim()
  return out
}

const norm = (c: string): string => (c === '#fff' ? '#ffffff' : c.toLowerCase())

describe('PRD-M8-001 AC-1 · token 与 HANDOFF §1 逐项一致', () => {
  const table = handoffPalette()
  const named: Array<[string, keyof (typeof TOKENS)['dark']]> = [
    ['bg', 'bg'],
    ['bg2', 'bg2'],
    ['panel', 'panel'],
    ['panel-h', 'panelH'],
    ['border', 'border'],
    ['border2', 'border2'],
    ['ink', 'ink'],
    ['ink2', 'ink2'],
    ['mut', 'mut'],
    ['mut2', 'mut2'],
    ['ok', 'ok'],
    ['bad', 'bad'],
    ['warn', 'warn'],
    ['info', 'info'],
    ['tool', 'tool'],
  ]

  test('表格解析出来的确实是 HANDOFF 里那张表（不是解析了个空表）', () => {
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(17)
    expect(table.bg).toEqual({ dark: '#0d1117', light: '#fff' })
  })

  test.each(named)('--%s 深浅两套与 HANDOFF 一致', (cssName, key) => {
    const row = table[cssName]
    expect(row).toBeDefined()
    expect(norm(TOKENS.dark[key])).toBe(norm((row as { dark: string }).dark))
    expect(norm(TOKENS.light[key])).toBe(norm((row as { light: string }).light))
  })

  test('默认色板的 accent 就是 HANDOFF 里的 --accent', () => {
    const p = paletteOf(DEFAULT_PALETTE)
    expect(norm(p.dark.accent)).toBe(norm((table.accent as { dark: string }).dark))
    expect(norm(p.light.accent)).toBe(norm((table.accent as { light: string }).light))
  })
})

describe('PRD-M8-001 AC-4 · 实心按钮的文字对比度 ≥ 4.5:1', () => {
  const modes: ThemeMode[] = ['dark', 'light']
  for (const p of PALETTES) {
    for (const mode of modes) {
      test(`${p.id} · ${mode}`, () => {
        expect(contrast(p[mode].emphasis, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  test('对比度函数本身可信：白底黑字 21:1、同色 1:1', () => {
    expect(Math.round(contrast('#ffffff', '#000000'))).toBe(21)
    expect(contrast('#58a6ff', '#58a6ff')).toBeCloseTo(1, 5)
  })
})

describe('PRD-M8-001 AC-6 · Web 的 CSS 变量与 TUI 的配色同源', () => {
  const pairs: Array<[string, keyof (typeof TOKENS)['dark']]> = [
    ['bg', 'bg'],
    ['bg2', 'bg2'],
    ['panel', 'panel'],
    ['panel-h', 'panelH'],
    ['border', 'border'],
    ['border2', 'border2'],
    ['ink', 'ink'],
    ['ink2', 'ink2'],
    ['mut', 'mut'],
    ['mut2', 'mut2'],
    ['ok', 'ok'],
    ['bad', 'bad'],
    ['warn', 'warn'],
    ['info', 'info'],
    ['tool', 'tool'],
    ['code-bg', 'codeBg'],
  ]
  const dark = cssVars(':root,\n:root[data-theme="dark"]')
  const light = cssVars(':root[data-theme="light"]')

  test('两套选择器都解析到了变量', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10)
    expect(Object.keys(light).length).toBeGreaterThan(10)
  })

  test.each(pairs)('globals.css 的 --%s 就是 tokens.ts 里的值', (cssName, key) => {
    expect(norm(dark[cssName] ?? '')).toBe(norm(TOKENS.dark[key]))
    expect(norm(light[cssName] ?? '')).toBe(norm(TOKENS.light[key]))
  })

  test('5 个色板，每个都有深浅两套 accent 与更深一档的实心底色', () => {
    expect(PALETTES.map((p) => p.id)).toEqual(['blue', 'green', 'orange', 'purple', 'pink'])
    for (const p of PALETTES) {
      for (const mode of ['dark', 'light'] as const) {
        expect(p[mode].accent).toMatch(/^#[0-9a-f]{6}$/i)
        expect(p[mode].emphasis).toMatch(/^#[0-9a-f]{6}$/i)
      }
      // 实心底色比 accent 更深：白字才压得住（取舍见 PRD-M8-001 AC-4）
      expect(contrast(p.dark.emphasis, '#ffffff')).toBeGreaterThan(contrast(p.dark.accent, '#ffffff'))
    }
  })

  test('认不出的色板名回落到默认蓝', () => {
    expect(paletteOf('nope').id).toBe(DEFAULT_PALETTE)
    expect(paletteOf(undefined).id).toBe(DEFAULT_PALETTE)
  })
})
