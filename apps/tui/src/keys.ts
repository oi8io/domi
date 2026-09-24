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

/**
 * PRD-M13-002 AC-6：Esc 中断这一轮——只在跑着、没有弹层、没有待答的询问时。
 * 有弹层 / 询问时 Esc 归它们（问题框里 Esc = 不回答）；Ctrl+C 语义不变
 */
export function isInterruptKey(
  key: { escape?: boolean; ctrl?: boolean; meta?: boolean },
  state: { busy: boolean; overlay: boolean; asking: boolean },
): boolean {
  return key.escape === true && !key.ctrl && !key.meta && state.busy && !state.overlay && !state.asking
}

/**
 * PRD-M10-005 AC-2：e 在输入框空时切换思考折叠。纯函数，main.tsx 的 useInput 直接问它；
 * 与滚动键（PgUp/PgDn/Ctrl+Home/End，render/viewport.ts 的 scrollKey）不冲突
 */
export function isReasonToggle(input: string, key: KeyLike, inputEmpty: boolean): boolean {
  return input === 'e' && !key.ctrl && !key.meta && inputEmpty
}

/** 列表里的上下移动：↑↓，或 Ctrl+P / Ctrl+N */
export function moveOf(input: string, key: { upArrow?: boolean; downArrow?: boolean; ctrl?: boolean }): -1 | 1 | 0 {
  if (key.upArrow || (key.ctrl && input === 'p')) return -1
  if (key.downArrow || (key.ctrl && input === 'n')) return 1
  return 0
}

/**
 * 问题框的按键（PRD-M12-004 AC-7）：纯函数，main.tsx 的 useInput 问它。
 * 在「其他」里打字时按键进输入框；否则 ←→ / Tab 切题、↑↓ 移动、回车 / 空格选、a–d 直选、n / Esc 不回答，
 * 核对页上回车 = 提交。
 */
export type QuestionKey =
  | { kind: 'act'; action: import('@domi/client-core').QuestionsAction }
  | { kind: 'submit' }
  | { kind: 'decline' }
  | null

export function questionKey(
  input: string,
  key: {
    ctrl?: boolean
    meta?: boolean
    return?: boolean
    escape?: boolean
    tab?: boolean
    shift?: boolean
    leftArrow?: boolean
    rightArrow?: boolean
    upArrow?: boolean
    downArrow?: boolean
    backspace?: boolean
    delete?: boolean
  },
  state: { editing: boolean; onReview: boolean },
): QuestionKey {
  if (state.editing) {
    if (key.return || key.escape) return { kind: 'act', action: { t: 'edit', on: false } }
    if (key.backspace || key.delete) return { kind: 'act', action: { t: 'backspace' } }
    if (!key.ctrl && !key.meta && input !== '') return { kind: 'act', action: { t: 'type', text: input } }
    return null
  }
  if (key.escape || (input === 'n' && !key.ctrl)) return { kind: 'decline' }
  if (key.leftArrow || (key.tab && key.shift)) return { kind: 'act', action: { t: 'prev' } }
  if (key.rightArrow || key.tab) return { kind: 'act', action: { t: 'next' } }
  if (state.onReview) return key.return ? { kind: 'submit' } : null
  if (key.upArrow) return { kind: 'act', action: { t: 'move', delta: -1 } }
  if (key.downArrow) return { kind: 'act', action: { t: 'move', delta: 1 } }
  if (key.return || input === ' ') return { kind: 'act', action: { t: 'choose' } }
  if (!key.ctrl && /^[a-d]$/.test(input)) return { kind: 'act', action: { t: 'letter', ch: input } }
  return null
}
