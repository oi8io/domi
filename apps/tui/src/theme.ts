/**
 * TUI 配色 —— PRD-M8-014 AC-6 · SPEC-M8-014
 *
 * 颜色和 Web 同一份 token（client-core/tokens.ts）。终端能力不同，分三档：
 * - truecolor（COLORTERM=truecolor / 24bit）：直接用 hex，和 Web 一模一样
 * - 其余：映射到 16 色的名字——交给终端自己的配色方案，比 chalk 就近取色更顺眼
 * - NO_COLOR：一律不给颜色（chalk 本身也认 NO_COLOR，这里再兜一层，免得 hex 漏出去）
 * 深浅：config 的 tui.theme；auto 读 COLORFGBG 的背景位（7 / 15 = 浅色），读不到当深色。
 */
import { type PaletteId, paletteOf, type ThemeMode, TOKENS } from '@domi/client-core'
import { createContext, useContext } from 'react'

export type Tone = 'ink' | 'ink2' | 'mut' | 'mut2' | 'accent' | 'ok' | 'bad' | 'warn' | 'info' | 'tool'

const ANSI16: Record<Tone, string | undefined> = {
  ink: undefined,
  ink2: undefined,
  mut: 'gray',
  mut2: 'gray',
  accent: 'blue',
  ok: 'green',
  bad: 'red',
  warn: 'yellow',
  info: 'magenta',
  tool: 'yellowBright',
}

type Env = Record<string, string | undefined>

export function detectMode(pref: 'auto' | 'dark' | 'light' | undefined, env: Env): ThemeMode {
  if (pref === 'dark' || pref === 'light') return pref
  const bg = env.COLORFGBG?.split(';').at(-1)
  return bg === '7' || bg === '15' ? 'light' : 'dark'
}

export function supportsTruecolor(env: Env): boolean {
  const c = env.COLORTERM?.toLowerCase()
  return c === 'truecolor' || c === '24bit'
}

export interface TuiTheme {
  mode: ThemeMode
  truecolor: boolean
  /** 给 Ink 的 color 属性；undefined = 用终端默认色 */
  color(tone: Tone): string | undefined
  /** 展开到 <Text> 上：`<Text {...t.fg('ok')}>`。没有颜色时是空对象（exactOptionalPropertyTypes 不许传 undefined） */
  fg(tone: Tone): { color?: string }
  /** 边框色：没有颜色时退回 'gray'（Ink 的边框必须有个色名） */
  border(tone: Tone): string
}

export function makeTheme(opts: { mode?: ThemeMode; accent?: PaletteId | string; env?: Env } = {}): TuiTheme {
  const env = opts.env ?? {}
  const mode = opts.mode ?? 'dark'
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== ''
  const truecolor = !noColor && supportsTruecolor(env)
  const t = TOKENS[mode]
  const accent = paletteOf(opts.accent)[mode].accent
  const hex: Record<Tone, string> = {
    ink: t.ink,
    ink2: t.ink2,
    mut: t.mut,
    mut2: t.mut2,
    accent,
    ok: t.ok,
    bad: t.bad,
    warn: t.warn,
    info: t.info,
    tool: t.tool,
  }
  const color = (tone: Tone): string | undefined => (noColor ? undefined : truecolor ? hex[tone] : ANSI16[tone])
  return {
    mode,
    truecolor,
    color,
    fg: (tone) => {
      const c = color(tone)
      return c === undefined ? {} : { color: c }
    },
    border: (tone) => color(tone) ?? 'gray',
  }
}

/** 测试与默认：深色、蓝、16 色 */
export const ThemeContext = createContext<TuiTheme>(makeTheme())

export function useTheme(): TuiTheme {
  return useContext(ThemeContext)
}
