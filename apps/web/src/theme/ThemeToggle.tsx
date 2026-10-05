/**
 * 深浅色切换按钮 —— PRD-M8-001 AC-2。
 * v1.19 起放在侧栏底部「设置」的右边（原来在状态栏，状态栏只留会话指标）
 */
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { IconMoon, IconSun } from '../icons.tsx'
import { $systemDark, $themeChoice, resolveMode, toggleTheme } from './store.ts'

export function ThemeToggle() {
  const choice = useStore($themeChoice)
  const dark = useStore($systemDark)
  const mode = resolveMode(choice, dark)
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center rounded-sm px-[9px] py-1.5 text-mut hover:bg-panel-h hover:text-ink2"
      title={mode === 'dark' ? tr('web.status.toLight') : tr('web.status.toDark')}
      aria-label={tr('web.status.toggleTheme')}
      onClick={toggleTheme}
    >
      {mode === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
    </button>
  )
}
