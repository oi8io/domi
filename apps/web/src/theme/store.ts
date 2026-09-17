/**
 * 主题 —— PRD-M8-001 AC-2 / AC-5 · ADR-027
 *
 * 深浅模式是「这台设备的偏好」，存 localStorage；色板按拍板要存 daemon（`ui.accent`，TUI 共用），
 * 配置接口（TASK-M8-007）落地之前先缓存在 localStorage，接口有了就以 daemon 为准。
 * 读写都包 try/catch：隐私窗口里 localStorage 可能直接抛。
 */
import { DEFAULT_PALETTE, type PaletteId, paletteOf, type ThemeMode } from '@domi/client-core'
import { atom } from 'nanostores'

export type ThemeChoice = 'system' | ThemeMode

export const THEME_KEY = 'domi.theme'
export const ACCENT_KEY = 'domi.accent'

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 存不下就只在本次生效
  }
}

function initialChoice(): ThemeChoice {
  const v = read(THEME_KEY)
  return v === 'dark' || v === 'light' ? v : 'system'
}

export const $themeChoice = atom<ThemeChoice>(initialChoice())
export const $accent = atom<PaletteId>(paletteOf(read(ACCENT_KEY) ?? DEFAULT_PALETTE).id)
/** 系统当前是不是深色；SSR / 测试里没有 matchMedia，按深色 */
export const $systemDark = atom<boolean>(true)

export function resolveMode(choice: ThemeChoice, systemDark: boolean): ThemeMode {
  if (choice === 'system') return systemDark ? 'dark' : 'light'
  return choice
}

/** 写到 <html>：data-theme + 两个 accent 变量。派生色由 globals.css 的 color-mix 自己算 */
export function applyTheme(root: HTMLElement, mode: ThemeMode, accent: PaletteId): void {
  const p = paletteOf(accent)[mode]
  root.dataset.theme = mode
  root.style.setProperty('--accent', p.accent)
  root.style.setProperty('--accent-emphasis', p.emphasis)
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice)
  $themeChoice.set(choice)
}

export function setAccent(id: PaletteId): void {
  write(ACCENT_KEY, id)
  $accent.set(id)
}

/** 状态栏上的快捷切换：在深浅之间来回，切过之后不再跟随系统 */
export function toggleTheme(): void {
  setThemeChoice(resolveMode($themeChoice.get(), $systemDark.get()) === 'dark' ? 'light' : 'dark')
}

/** 浏览器里调一次：监听系统深浅变化，任一输入变了就重新应用 */
export function startTheme(root: HTMLElement = document.documentElement): () => void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  if (mq) $systemDark.set(mq.matches)
  const onChange = (e: MediaQueryListEvent): void => $systemDark.set(e.matches)
  mq?.addEventListener('change', onChange)
  const apply = (): void => applyTheme(root, resolveMode($themeChoice.get(), $systemDark.get()), $accent.get())
  const offs = [$themeChoice.listen(apply), $accent.listen(apply), $systemDark.listen(apply)]
  apply()
  return () => {
    mq?.removeEventListener('change', onChange)
    for (const off of offs) off()
  }
}
