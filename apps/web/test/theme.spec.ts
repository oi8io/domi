/**
 * 主题 —— PRD-M8-001 AC-2 / AC-5
 *
 * 深浅是「这台设备的偏好」（localStorage），色板存 daemon（ui.accent）并在连上时以它为准。
 * 这里不起浏览器：localStorage 与 matchMedia 都用替身，断言的是这几段纯逻辑与写入的内容。
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PALETTES, paletteOf } from '@domi/client-core'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v)
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
}

const theme = await import('../src/theme/store.ts')

/** <html> 的替身：只要 dataset 与 style.setProperty */
function fakeRoot() {
  const vars = new Map<string, string>()
  return {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (k: string, v: string) => {
        vars.set(k, v)
      },
    },
    vars,
  }
}

beforeEach(() => {
  store.clear()
  theme.$themeChoice.set('system')
  theme.$accent.set('blue')
  theme.$systemDark.set(true)
})

describe('PRD-M8-001 AC-2 · 三选一的深浅，写在 <html data-theme>，本浏览器记住', () => {
  test('跟随系统：系统深色就是深色，翻成浅色也跟着翻', () => {
    expect(theme.resolveMode('system', true)).toBe('dark')
    expect(theme.resolveMode('system', false)).toBe('light')
    expect(theme.resolveMode('dark', false)).toBe('dark')
    expect(theme.resolveMode('light', true)).toBe('light')
  })

  test('选择写进 localStorage，下次打开还在', () => {
    theme.setThemeChoice('light')
    expect(store.get(theme.THEME_KEY)).toBe('light')
    expect(theme.$themeChoice.get()).toBe('light')
  })

  test('状态栏的快捷切换：来回翻，并且不再跟随系统', () => {
    theme.$systemDark.set(true)
    theme.toggleTheme()
    expect(theme.$themeChoice.get()).toBe('light')
    theme.toggleTheme()
    expect(theme.$themeChoice.get()).toBe('dark')
  })

  test('applyTheme 写 data-theme', () => {
    const root = fakeRoot()
    theme.applyTheme(root as never, 'light', 'blue')
    expect(root.dataset.theme).toBe('light')
    theme.applyTheme(root as never, 'dark', 'blue')
    expect(root.dataset.theme).toBe('dark')
  })

  test('startTheme 跟着系统变：matchMedia 的 change 事件一来就重画', () => {
    const root = fakeRoot()
    const handlers: Array<(e: { matches: boolean }) => void> = []
    ;(globalThis as { matchMedia?: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        handlers.push(fn)
      },
      removeEventListener: () => undefined,
    })
    const stop = theme.startTheme(root as never)
    expect(root.dataset.theme).toBe('light')
    for (const fn of handlers) fn({ matches: true })
    expect(root.dataset.theme).toBe('dark')
    stop()
    ;(globalThis as { matchMedia?: unknown }).matchMedia = undefined
  })
})

describe('PRD-M8-001 AC-5 · 5 个色板，深浅各一套；选择存在 daemon 的 ui.accent', () => {
  test('换色板只写两个变量，派生色由 CSS 的 color-mix 算', () => {
    const root = fakeRoot()
    for (const p of PALETTES) {
      for (const mode of ['dark', 'light'] as const) {
        theme.applyTheme(root as never, mode, p.id)
        expect(root.vars.get('--accent')).toBe(p[mode].accent)
        expect(root.vars.get('--accent-emphasis')).toBe(p[mode].emphasis)
      }
    }
    expect([...root.vars.keys()].sort()).toEqual(['--accent', '--accent-emphasis'])
  })

  test('深浅两套取值不同（不是同一个颜色两处用）', () => {
    for (const p of PALETTES) expect(p.dark.accent).not.toBe(p.light.accent)
  })

  test('设置页把色板存到 daemon：点色板会 config.set 一次 ui.accent', () => {
    // 界面那一步在 SettingsView 里：`s.save({ 'ui.accent': p.id })`
    const src = readFileSync(join(import.meta.dir, '..', 'src/views/SettingsView.tsx'), 'utf8')
    expect(src).toContain("save({ 'ui.accent': p.id })")
    for (const p of PALETTES) expect(paletteOf(p.id).id).toBe(p.id)
  })

  test('本地也缓存一份：没连上 daemon 时仍然记得上次选的', () => {
    theme.setAccent('pink')
    expect(store.get(theme.ACCENT_KEY)).toBe('pink')
    expect(theme.$accent.get()).toBe('pink')
  })
})
