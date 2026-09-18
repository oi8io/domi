/**
 * 设计 token 的唯一来源 —— PRD-M8-001 AC-6 · SPEC-M8 取舍-13
 *
 * Web 的 `globals.css` 与 TUI 的配色都从这张表来（Web 那份 CSS 由测试断言与这里一致）。
 * 取值来自已确认的原型 `docs/ui-redesign/index.html` 与 `HANDOFF.md` §1。
 * 纯数据，不 import react（ADR-009）。
 */
import { tr } from '@domi/i18n'

export type ThemeMode = 'dark' | 'light'

export interface ThemeTokens {
  bg: string
  bg2: string
  panel: string
  panelH: string
  border: string
  border2: string
  ink: string
  ink2: string
  mut: string
  mut2: string
  ok: string
  bad: string
  warn: string
  info: string
  tool: string
  codeBg: string
}

export const TOKENS: Record<ThemeMode, ThemeTokens> = {
  dark: {
    bg: '#0d1117',
    bg2: '#161b22',
    panel: '#1c2128',
    panelH: '#22272e',
    border: '#30363d',
    border2: '#21262d',
    ink: '#e6edf3',
    ink2: '#c9d1d9',
    mut: '#8b949e',
    mut2: '#6e7681',
    ok: '#3fb950',
    bad: '#f85149',
    warn: '#d29922',
    info: '#a371f7',
    tool: '#f0883e',
    codeBg: '#0d1117',
  },
  light: {
    bg: '#ffffff',
    bg2: '#f6f8fa',
    panel: '#f6f8fa',
    panelH: '#eaeef2',
    border: '#d0d7de',
    border2: '#e5e9ee',
    ink: '#1f2328',
    ink2: '#424a53',
    mut: '#656d76',
    mut2: '#8b949e',
    ok: '#1a7f37',
    bad: '#d1242f',
    warn: '#9a6700',
    info: '#8250df',
    tool: '#bc4c00',
    codeBg: '#f6f8fa',
  },
}

/**
 * accent 色板。`accent` 用于选中态、链接、tab 下划线；`emphasis` 是实心按钮底色，
 * 配白字对比度 ≥ 4.5:1（PRD-M8-001 AC-4）——深色主题下亮色 accent 配白字只有 ~2.5:1。
 */
export interface Palette {
  id: PaletteId
  readonly label: string
  dark: { accent: string; emphasis: string }
  light: { accent: string; emphasis: string }
}

export type PaletteId = 'blue' | 'green' | 'orange' | 'purple' | 'pink'

export const PALETTES: readonly Palette[] = [
  {
    id: 'blue',
    // 取值时才翻译：这张表在模块加载时就建好了，界面语言可能在那之后才定（PRD-M9-004）
    get label() {
      return tr('core.palette.blue')
    },
    dark: { accent: '#58a6ff', emphasis: '#1f6feb' },
    light: { accent: '#0969da', emphasis: '#0969da' },
  },
  {
    id: 'green',
    // 取值时才翻译：这张表在模块加载时就建好了，界面语言可能在那之后才定（PRD-M9-004）
    get label() {
      return tr('core.palette.green')
    },
    dark: { accent: '#3fb950', emphasis: '#238636' },
    light: { accent: '#1a7f37', emphasis: '#1a7f37' },
  },
  {
    id: 'orange',
    // 取值时才翻译：这张表在模块加载时就建好了，界面语言可能在那之后才定（PRD-M9-004）
    get label() {
      return tr('core.palette.orange')
    },
    dark: { accent: '#f0883e', emphasis: '#bd561d' },
    light: { accent: '#bc4c00', emphasis: '#bc4c00' },
  },
  {
    id: 'purple',
    // 取值时才翻译：这张表在模块加载时就建好了，界面语言可能在那之后才定（PRD-M9-004）
    get label() {
      return tr('core.palette.purple')
    },
    dark: { accent: '#a371f7', emphasis: '#8957e5' },
    light: { accent: '#8250df', emphasis: '#8250df' },
  },
  {
    id: 'pink',
    // 取值时才翻译：这张表在模块加载时就建好了，界面语言可能在那之后才定（PRD-M9-004）
    get label() {
      return tr('core.palette.pink')
    },
    dark: { accent: '#db61a2', emphasis: '#bf4b8a' },
    light: { accent: '#bf3989', emphasis: '#bf3989' },
  },
]

export const DEFAULT_PALETTE: PaletteId = 'blue'

export function paletteOf(id: string | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? (PALETTES[0] as Palette)
}

/** WCAG 2.x 相对亮度 */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 两个 #rrggbb 颜色的对比度（1–21） */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
