/**
 * 全局快捷键 —— PRD-M8-015 AC-1 · SPEC-M8-015
 *
 * 纯函数：按键 + 当前状态 → 动作，测试直接调。
 * 单键（p / s / t / ?）只在输入框为空、没有弹层时生效——否则它们就是在打字；
 * Ctrl+P / Ctrl+R / Ctrl+T 任何时候都行（弹层里 Ctrl+P 让给「上移」）。不占 Ctrl+S（终端的流控键）。
 */
export type OverlayId = 'projects' | 'sessions' | 'tasks' | 'help' | 'models' | 'settings'

export type KeyAction = { kind: 'open'; overlay: OverlayId } | { kind: 'close' } | null

export interface KeyLike {
  ctrl?: boolean
  meta?: boolean
}

const SINGLE: Record<string, OverlayId> = { p: 'projects', s: 'sessions', t: 'tasks', '?': 'help' }
const CTRL: Record<string, OverlayId> = { p: 'projects', r: 'sessions', t: 'tasks' }

export function routeKey(
  input: string,
  key: KeyLike,
  state: { inputEmpty: boolean; overlay: OverlayId | null },
): KeyAction {
  if (state.overlay !== null) {
    // Esc 由弹层自己处理（表单里 Esc 是回列表）。弹层里 Ctrl+P 是上移（和 Ctrl+N 一对），不抢；
    // 再按一次同一个 Ctrl 键 = 关掉
    if (key.ctrl && input !== 'p' && CTRL[input]) {
      const to = CTRL[input] as OverlayId
      return to === state.overlay ? { kind: 'close' } : { kind: 'open', overlay: to }
    }
    return null
  }
  if (key.ctrl && CTRL[input]) return { kind: 'open', overlay: CTRL[input] as OverlayId }
  if (state.inputEmpty && !key.ctrl && !key.meta && SINGLE[input]) {
    return { kind: 'open', overlay: SINGLE[input] as OverlayId }
  }
  return null
}

/** 列表里的上下移动：↑↓，或 Ctrl+P / Ctrl+N */
export function moveOf(input: string, key: { upArrow?: boolean; downArrow?: boolean; ctrl?: boolean }): -1 | 1 | 0 {
  if (key.upArrow || (key.ctrl && input === 'p')) return -1
  if (key.downArrow || (key.ctrl && input === 'n')) return 1
  return 0
}
