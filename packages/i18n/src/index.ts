/**
 * 界面文案 —— PRD-M9-004 · SPEC-M9-004 取舍-7
 *
 * 三端共用一份 key：zh 是源，en 的类型是「zh 的每个 key 都要有」，缺一个 typecheck 就红；
 * 参数名一致与「端代码里没有中文字面量」由 `guard:i18n` 查。
 *
 * 只翻界面与面向用户的错误。事件流、轨迹、soul、记忆、用户输入、日志、提示词层都不翻（AC-5）。
 * daemon 不感知语言：错误带 messageKey + params，由端按自己的语言渲染（一个 domid 可以同时连中英两个端）。
 */
import { en } from './en.ts'
import { format, type Params } from './format.ts'
import { zh } from './zh.ts'

export { en } from './en.ts'
export { format, type Params, paramNames } from './format.ts'
export { zh } from './zh.ts'

export type Locale = 'zh' | 'en'
export type LocaleSetting = 'auto' | Locale
export type MessageKey = keyof typeof zh

const TABLES: Record<Locale, Record<MessageKey, string>> = { zh, en }

let current: Locale = 'zh'
const listeners = new Set<(l: Locale) => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  for (const f of listeners) f(l)
}

/** 语言变了通知（Web 用它整页重渲染）。返回取消订阅 */
export function onLocaleChange(f: (l: Locale) => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** 这个字符串是不是一个已知 key（错误的 messageKey 来自 daemon，可能是端上不认识的新 key） */
export function isMessageKey(k: unknown): k is MessageKey {
  return typeof k === 'string' && Object.hasOwn(zh, k)
}

export function t(key: MessageKey, params?: Params): string {
  return format(TABLES[current][key], params)
}

/**
 * `t` 的别名，端代码统一用它：TUI 里 `t` 是主题（`const t = useTheme()`），列表回调里也常有 `(t) =>`，
 * 用 `t` 会被遮住而且不报错——换个不撞名的名字，从根上避开
 */
export const tr = t

/**
 * 设置 + 系统线索 → 实际语言（AC-1）。auto 时看第一个非空线索：`zh` 开头为中文，其余为英文；一个都没有按中文
 */
export function resolveLocale(setting: LocaleSetting | undefined, hints: ReadonlyArray<string | undefined>): Locale {
  if (setting === 'zh' || setting === 'en') return setting
  const hint = hints.find((h) => h !== undefined && h !== '' && h !== 'C' && h !== 'POSIX')
  if (hint === undefined) return 'zh'
  return /^zh/i.test(hint) ? 'zh' : 'en'
}

/** 终端的系统语言线索：LC_ALL > LC_MESSAGES > LANG（POSIX 的优先级） */
export function envLocaleHints(env: Readonly<Record<string, string | undefined>>): Array<string | undefined> {
  return [env.LC_ALL, env.LC_MESSAGES, env.LANG]
}
