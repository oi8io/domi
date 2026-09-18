/**
 * Web 端的界面语言 —— PRD-M9-004 AC-1
 *
 * 语言设置存在 daemon（`ui.locale`，与 TUI 共用），这里在浏览器里缓存一份：
 * 页面的模块在加载时就会求值一部分文案（常量表），所以语言要在**任何界面模块加载之前**定下来——
 * main.tsx 先调 bootLocale()，再动态加载 start.tsx。
 * 之后 daemon 那边的设置和缓存不一样（在别处改了、或第一次连上），就更新缓存并重新载入页面：
 * 状态都在 daemon 里，重新载入不丢东西，也比让每个常量表都变成惰性求值可靠。
 */
import { type LocaleSetting, resolveLocale, setLocale } from '@domi/i18n'

export const LOCALE_KEY = 'domi.locale'

function stored(): LocaleSetting {
  try {
    const v = localStorage.getItem(LOCALE_KEY)
    return v === 'zh' || v === 'en' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

function resolved(setting: LocaleSetting): 'zh' | 'en' {
  return resolveLocale(
    setting,
    typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language],
  )
}

export function bootLocale(): void {
  const l = resolved(stored())
  setLocale(l)
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
}

/** daemon 的设置到了（或刚在设置页改了）：和缓存不一致就记下，实际语言变了就重新载入 */
export function syncLocale(setting: unknown): void {
  if (setting !== 'auto' && setting !== 'zh' && setting !== 'en') return
  const before = resolved(stored())
  try {
    localStorage.setItem(LOCALE_KEY, setting)
  } catch {
    // 存不了（隐私模式）：只影响下次打开时的第一屏
  }
  if (resolved(setting) !== before) location.reload()
}
