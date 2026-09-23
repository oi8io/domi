/**
 * 问题框的交互状态 —— PRD-M12-004 AC-7 · SPEC-M12-004 第二轮 取舍-1
 *
 * Web 与 TUI 共用这一份纯函数状态机，端上只管画与把按键 / 点击翻译成 action（INV-02：端上没有业务逻辑）。
 * 交互照 Claude Code 的 AskUserQuestion：每题一个 tab、最后一个 tab 核对后提交；
 * 单选选中即跳下一题，多选来回勾；「其他」永远在选项最后一行。
 */
import type { Question, QuestionsContent } from '@domi/protocol'

export interface QuestionsState {
  /** 当前 tab；等于题数时是核对页 */
  tab: number
  /** 每题的光标：0…options.length-1 是选项，options.length 是「其他」 */
  cursor: number[]
  /** 每题选中的 label（按选项顺序） */
  selected: string[][]
  /** 每题自己写的 */
  other: string[]
  /** 正在「其他」里打字（TUI 用：这时按键进输入，不当命令） */
  editing: boolean
}

export type QuestionsAction =
  | { t: 'tab'; to: number }
  | { t: 'next' }
  | { t: 'prev' }
  | { t: 'move'; delta: -1 | 1 }
  /** 选 / 取消一个选项（点击、或字母键解析后） */
  | { t: 'pick'; label: string }
  /** 选光标所在的那一行；在「其他」上 = 进入输入 */
  | { t: 'choose' }
  /** a–d：选对应的选项 */
  | { t: 'letter'; ch: string }
  | { t: 'edit'; on: boolean }
  | { t: 'type'; text: string }
  | { t: 'backspace' }
  /** Web 的输入框直接给整段 */
  | { t: 'setOther'; text: string }

export function initQuestions(qs: readonly Question[]): QuestionsState {
  return {
    tab: 0,
    cursor: qs.map(() => 0),
    selected: qs.map(() => []),
    other: qs.map(() => ''),
    editing: false,
  }
}

const set = <T>(arr: readonly T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x))

function withOther(qs: readonly Question[], s: QuestionsState, i: number, text: string): QuestionsState {
  const q = qs[i]
  if (!q) return s
  // 单选题：自己写了就不再算选了某个选项（二者择一）；多选题两个都留
  const selected = q.multiSelect !== true && text.trim() !== '' ? set(s.selected, i, []) : s.selected
  return { ...s, other: set(s.other, i, text), selected }
}

function pick(qs: readonly Question[], s: QuestionsState, i: number, label: string): QuestionsState {
  const q = qs[i]
  if (q === undefined) return s
  if (!q.options.some((o) => o.label === label)) return s
  if (q.multiSelect === true) {
    const cur = s.selected[i] ?? []
    const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
    const ordered = q.options.map((o) => o.label).filter((l) => next.includes(l))
    return { ...s, selected: set(s.selected, i, ordered) }
  }
  // 单选：选中即替换、清掉自定义、跳下一题（最后一题跳到核对页）
  return {
    ...s,
    selected: set(s.selected, i, [label]),
    other: set(s.other, i, ''),
    tab: Math.min(i + 1, qs.length),
    editing: false,
  }
}

export function reduceQuestions(qs: readonly Question[], s: QuestionsState, a: QuestionsAction): QuestionsState {
  const i = s.tab
  const q = qs[i]
  switch (a.t) {
    case 'tab':
      return { ...s, tab: Math.max(0, Math.min(qs.length, a.to)), editing: false }
    case 'next':
      return { ...s, tab: Math.min(qs.length, i + 1), editing: false }
    case 'prev':
      return { ...s, tab: Math.max(0, i - 1), editing: false }
    case 'move': {
      if (!q) return s
      const c = Math.max(0, Math.min(q.options.length, (s.cursor[i] ?? 0) + a.delta))
      return { ...s, cursor: set(s.cursor, i, c), editing: false }
    }
    case 'pick':
      return pick(qs, s, i, a.label)
    case 'choose': {
      if (!q) return s
      const c = s.cursor[i] ?? 0
      if (c >= q.options.length) return { ...s, editing: true }
      return pick(qs, s, i, q.options[c]?.label ?? '')
    }
    case 'letter': {
      if (!q) return s
      const n = a.ch.toLowerCase().charCodeAt(0) - 97
      const label = q.options[n]?.label
      return label === undefined ? s : pick(qs, { ...s, cursor: set(s.cursor, i, n) }, i, label)
    }
    case 'edit':
      return q ? { ...s, editing: a.on, cursor: a.on ? set(s.cursor, i, q.options.length) : s.cursor } : s
    case 'type':
      return q ? withOther(qs, s, i, (s.other[i] ?? '') + a.text) : s
    case 'backspace':
      return q ? withOther(qs, s, i, [...(s.other[i] ?? '')].slice(0, -1).join('')) : s
    case 'setOther':
      return q ? withOther(qs, s, i, a.text) : s
  }
}

/** 每题答了没有：选了选项或者写了字 */
export function answeredFlags(qs: readonly Question[], s: QuestionsState): boolean[] {
  return qs.map((_, i) => (s.selected[i] ?? []).length > 0 || (s.other[i] ?? '').trim() !== '')
}

/** 提交给 session.answer 的 content（runtime 的 normalizeAnswers 读它） */
export function questionsContent(qs: readonly Question[], s: QuestionsState): QuestionsContent {
  return {
    answers: qs.map((_, i) => {
      const other = (s.other[i] ?? '').trim()
      return { selected: s.selected[i] ?? [], ...(other === '' ? {} : { other }) }
    }),
  }
}
