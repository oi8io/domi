/**
 * TUI 配色与行样式 —— PRD-M8-014 AC-2 / AC-4 / AC-5 / AC-6
 *
 * 配色取自 client-core 的共享 token；三档能力（truecolor / 16 色 / NO_COLOR）各断言一次。
 * 行前缀与状态栏的内容在 golden 快照里（四种宽度），这里只钉住不随宽度变的那几条。
 */
import { describe, expect, test } from 'bun:test'
import { paletteOf, TOKENS } from '@domi/client-core'
import { renderToString } from 'ink'
import { DEFAULT_HINTS } from '../src/components/ContextBar.tsx'
import { editAction } from '../src/components/Prompt.tsx'
import { PREFIX } from '../src/components/Transcript.tsx'
import { detectMode, makeTheme, supportsTruecolor } from '../src/theme.ts'

describe('PRD-M8-014 AC-6 · 配色来自共享 token，按终端能力分三档', () => {
  test('truecolor：直接用 tokens.ts 里的 hex，和 Web 一模一样', () => {
    const t = makeTheme({ mode: 'dark', accent: 'blue', env: { COLORTERM: 'truecolor' } })
    expect(t.truecolor).toBe(true)
    expect(t.color('ok')).toBe(TOKENS.dark.ok)
    expect(t.color('mut')).toBe(TOKENS.dark.mut)
    expect(t.color('accent')).toBe(paletteOf('blue').dark.accent)
    const light = makeTheme({ mode: 'light', accent: 'pink', env: { COLORTERM: 'truecolor' } })
    expect(light.color('ok')).toBe(TOKENS.light.ok)
    expect(light.color('accent')).toBe(paletteOf('pink').light.accent)
  })

  test('普通终端：退回 16 色的名字，交给终端自己的配色', () => {
    const t = makeTheme({ mode: 'dark', env: {} })
    expect(t.truecolor).toBe(false)
    expect(t.color('ok')).toBe('green')
    expect(t.color('bad')).toBe('red')
    expect(t.color('accent')).toBe('blue')
    expect(t.color('ink')).toBeUndefined()
    expect(t.border('ink')).toBe('gray')
  })

  test('NO_COLOR：一点颜色都不输出（hex 也不能漏出去）', () => {
    const t = makeTheme({ mode: 'dark', accent: 'green', env: { NO_COLOR: '1', COLORTERM: 'truecolor' } })
    expect(t.truecolor).toBe(false)
    for (const tone of ['ink', 'mut', 'accent', 'ok', 'bad', 'warn', 'info', 'tool'] as const) {
      expect(t.color(tone)).toBeUndefined()
      expect(t.fg(tone)).toEqual({})
    }
  })

  test('深浅：tui.theme 显式指定；auto 读 COLORFGBG，读不到按深色', () => {
    expect(detectMode('light', {})).toBe('light')
    expect(detectMode('dark', { COLORFGBG: '0;15' })).toBe('dark')
    expect(detectMode('auto', { COLORFGBG: '0;15' })).toBe('light')
    expect(detectMode('auto', { COLORFGBG: '15;0' })).toBe('dark')
    expect(detectMode('auto', {})).toBe('dark')
    expect(detectMode(undefined, {})).toBe('dark')
  })

  test('truecolor 的判断只认 COLORTERM', () => {
    expect(supportsTruecolor({ COLORTERM: 'truecolor' })).toBe(true)
    expect(supportsTruecolor({ COLORTERM: '24bit' })).toBe(true)
    expect(supportsTruecolor({ TERM: 'xterm-256color' })).toBe(false)
  })
})

describe('PRD-M8-014 AC-2 · 各类行的前缀', () => {
  test('用户 ›、思考 ·、工具 ⚙、结果 ←、assistant ✓、上下文 ✂、任务 ▸、错误 ✗', () => {
    expect(PREFIX.user).toBe('›')
    expect(PREFIX.reason).toBe('·')
    expect(PREFIX['tool-call']).toBe('⚙')
    expect(PREFIX['tool-result']).toBe('←')
    expect(PREFIX.assistant).toBe('✓')
    expect(PREFIX.context).toBe('✂')
    expect(PREFIX.task).toBe('▸')
    expect(PREFIX.error).toBe('✗')
  })
})

describe('PRD-M8-014 AC-5 · 输入行的按键与提示一致', () => {
  test('Enter 发送；Ctrl+J / Alt+Enter / Shift+Enter 换行', () => {
    expect(editAction('', { return: true })).toEqual({ kind: 'submit' })
    expect(editAction('', { return: true, shift: true })).toEqual({ kind: 'newline' })
    expect(editAction('', { return: true, meta: true })).toEqual({ kind: 'newline' })
    expect(editAction('j', { ctrl: true })).toEqual({ kind: 'newline' })
    expect(editAction('\n', {})).toEqual({ kind: 'newline' })
    expect(editAction('', { backspace: true })).toEqual({ kind: 'backspace' })
    expect(editAction('好', {})).toEqual({ kind: 'insert', text: '好' })
    // Ctrl / Alt 组合不当字符输入
    expect(editAction('p', { ctrl: true })).toBeNull()
  })

  test('按键提示就是原型那一排，并且都是真能用的键', async () => {
    expect(DEFAULT_HINTS().map(([k]) => k)).toEqual(['p', 's', 't', '/', '?', 'Ctrl+C'])
    const { routeKey } = await import('../src/keys.ts')
    for (const [key] of DEFAULT_HINTS()) {
      if (key === '/' || key === 'Ctrl+C') continue
      expect(routeKey(key, {}, { inputEmpty: true, overlay: null })).not.toBeNull()
    }
  })
})

describe('PRD-M8-014 AC-4 · 状态栏与提示行都画得出来（内容见 golden）', () => {
  test('40 列下按键提示整条换行，不把「退出」拆开', async () => {
    const { KeyHints } = await import('../src/components/ContextBar.tsx')
    const { createElement } = await import('react')
    const out = await renderToString(createElement(KeyHints, { hints: DEFAULT_HINTS() }), { columns: 40 })
    for (const line of out.split('\n')) expect(line.trimEnd().endsWith('Ctrl+C')).toBe(false)
    expect(out).toContain('退出')
  })
})
