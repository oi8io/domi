/**
 * TUI 的滚动视口 —— PRD-M9-005 AC-2 / AC-3 · SPEC-M9-005 取舍-8
 *
 * 全是纯函数：显示行怎么切、滚动条画在哪、往上翻之后新内容来了怎么办、该用哪种渲染器。
 * 组件只负责把这里算出来的东西画出来（Ink 的按键在无 TTY 环境里验不了，见 docs/adr/001）。
 *
 * 偏移量从**底部**算（0 = 贴底）：内容在底部增长，贴底时什么都不用改；
 * 往上翻过的人，新内容来了要把偏移量加上新增的行数，看到的那一屏才不会被推走。
 */

export interface ScrollState {
  /** 离底部多少行；0 = 贴底 */
  offset: number
  /** 贴底自动跟随 */
  follow: boolean
  /** 暂停跟随期间新来的条目数（「N 条新消息」） */
  unseen: number
}

export const INITIAL_SCROLL: ScrollState = { offset: 0, follow: true, unseen: 0 }

const maxOffset = (total: number, height: number): number => Math.max(0, total - height)

export function scrollBy(s: ScrollState, delta: number, total: number, height: number): ScrollState {
  const offset = Math.min(maxOffset(total, height), Math.max(0, s.offset + delta))
  return offset === 0 ? { offset: 0, follow: true, unseen: 0 } : { offset, follow: false, unseen: s.unseen }
}

export function toTop(s: ScrollState, total: number, height: number): ScrollState {
  return scrollBy(s, Number.POSITIVE_INFINITY, total, height)
}

export function toBottom(): ScrollState {
  return INITIAL_SCROLL
}

/** 半屏（Claude Code 同款：PgUp / PgDn 翻半屏） */
export const halfPage = (height: number): number => Math.max(1, Math.floor(height / 2))

/**
 * 内容变了（新条目、流式追加、窗口变宽导致折行变化）。
 * 贴底时什么都不做；往上翻着的时候把新增的行数加到偏移上，并记下新来了几条
 */
export function onContentChange(
  s: ScrollState,
  change: { addedLines: number; addedItems: number; total: number; height: number },
): ScrollState {
  if (s.follow) return s
  const offset = Math.min(maxOffset(change.total, change.height), Math.max(0, s.offset + change.addedLines))
  return { offset, follow: false, unseen: s.unseen + Math.max(0, change.addedItems) }
}

/** 这一屏显示第几行到第几行（左闭右开） */
export function visibleRange(total: number, height: number, offset: number): { start: number; end: number } {
  const h = Math.max(0, height)
  const o = Math.min(maxOffset(total, h), Math.max(0, offset))
  const end = total - o
  return { start: Math.max(0, end - h), end }
}

/**
 * 滚动条几何：一屏装得下就不画（null）。
 * 滑块长度按可见比例、至少 1 格；位置按「已经往下看了多少」线性映射
 */
export function scrollbar(
  total: number,
  height: number,
  start: number,
): { thumbStart: number; thumbSize: number } | null {
  if (height <= 0 || total <= height) return null
  const thumbSize = Math.max(1, Math.round((height * height) / total))
  const travel = height - thumbSize
  const thumbStart = Math.round((start / (total - height)) * travel)
  return { thumbStart: Math.min(travel, Math.max(0, thumbStart)), thumbSize }
}

/** 滚动条那一列的字符（从上到下 height 个） */
export function scrollbarColumn(total: number, height: number, start: number): string[] {
  const bar = scrollbar(total, height, start)
  return Array.from({ length: Math.max(0, height) }, (_, i) =>
    bar === null ? ' ' : i >= bar.thumbStart && i < bar.thumbStart + bar.thumbSize ? '┃' : '│',
  )
}

/**
 * SGR 1006 鼠标滚轮：`ESC[<64;x;yM` 向上、`65` 向下（带修饰键时按位或 4/8/16）。
 * 一次 data 里可能连着好几个事件；不是滚轮的鼠标事件忽略
 */
export function parseWheel(data: string): Array<'up' | 'down'> {
  const out: Array<'up' | 'down'> = []
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR 鼠标上报以 ESC 开头，本来就是控制字符
  for (const m of data.matchAll(/\u001b?\[<(\d+);\d+;\d+[Mm]/g)) {
    const b = Number(m[1])
    if ((b & 64) === 0) continue
    out.push((b & 1) === 0 ? 'up' : 'down')
  }
  return out
}

/** 是不是一段鼠标上报（输入框要忽略它，不能当文字打进去） */
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR 鼠标上报以 ESC 开头，本来就是控制字符
export const isMouseReport = (input: string): boolean => /^\u001b?\[<\d+;\d+;\d+[Mm]/.test(input)

export const MOUSE_ON = '\u001b[?1000h\u001b[?1006h'
export const MOUSE_OFF = '\u001b[?1000l\u001b[?1006l'

export type Renderer = 'fullscreen' | 'classic'

/**
 * 用哪种渲染器（PRD-M9-005 AC-1）：环境变量 > 配置；非 TTY、dumb 终端、屏幕阅读器强制 classic；
 * 上次 fullscreen 首帧前就崩了（留了回退标记）且没有显式要求 fullscreen → classic
 */
export function chooseRenderer(o: {
  setting: Renderer
  env: Readonly<Record<string, string | undefined>>
  isTTY: boolean
  screenReader: boolean
  fallbackMarked: boolean
}): { renderer: Renderer; reason: string | null } {
  const fromEnv = o.env.DOMI_TUI_RENDERER
  const explicit = fromEnv === 'fullscreen' || fromEnv === 'classic' ? fromEnv : null
  if (!o.isTTY) return { renderer: 'classic', reason: 'not-tty' }
  if (o.env.TERM === 'dumb') return { renderer: 'classic', reason: 'dumb' }
  if (o.screenReader) return { renderer: 'classic', reason: 'screen-reader' }
  if (explicit !== null) return { renderer: explicit, reason: null }
  if (o.setting === 'fullscreen' && o.fallbackMarked) return { renderer: 'classic', reason: 'fallback' }
  return { renderer: o.setting, reason: null }
}

/** 滚动命令：按键、滚轮都翻成这几种，交给持有滚动状态的组件执行 */
export type ScrollCmd = 'pageUp' | 'pageDown' | 'top' | 'bottom' | 'wheelUp' | 'wheelDown'

/** 滚轮一格滚几行（vim 的默认值） */
export const WHEEL_LINES = 3

export function applyScroll(s: ScrollState, cmd: ScrollCmd, total: number, height: number): ScrollState {
  switch (cmd) {
    case 'pageUp':
      return scrollBy(s, halfPage(height), total, height)
    case 'pageDown':
      return scrollBy(s, -halfPage(height), total, height)
    case 'wheelUp':
      return scrollBy(s, WHEEL_LINES, total, height)
    case 'wheelDown':
      return scrollBy(s, -WHEEL_LINES, total, height)
    case 'top':
      return toTop(s, total, height)
    case 'bottom':
      return toBottom()
  }
}

/** 按键 → 滚动命令（PRD-M9-005 AC-3）。不是滚动键返回 null，交给输入框 */
export function scrollKey(key: {
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
  ctrl?: boolean
}): ScrollCmd | null {
  if (key.pageUp) return 'pageUp'
  if (key.pageDown) return 'pageDown'
  if (key.ctrl && key.home) return 'top'
  if (key.ctrl && key.end) return 'bottom'
  return null
}

/** 一个极小的命令总线：Root 收按键 / 滚轮，App 持有滚动状态 */
export function createScrollBus(): { emit(cmd: ScrollCmd): void; on(f: (cmd: ScrollCmd) => void): () => void } {
  const subs = new Set<(cmd: ScrollCmd) => void>()
  return {
    emit: (cmd) => {
      for (const f of subs) f(cmd)
    },
    on: (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
  }
}
