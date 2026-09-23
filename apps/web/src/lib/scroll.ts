/**
 * 滚动判定纯函数 —— PRD-M11-001 / PRD-M11-002
 *
 * SessionView 的贴底逻辑：距底多近算「在底部」。
 * 抽成纯函数是因为 SSR 测试测不了真实 scrollTop，DOM 行为靠它判定。
 */

/** 距底小于这个 px 就认为「贴在底部」，沿用 M8 的 160px 阈值 */
export const NEAR_BOTTOM_PX = 160

/**
 * distanceFromBottomPx = scrollHeight - scrollTop - clientHeight
 * 小于 NEAR_BOTTOM_PX → 贴底（新内容来了跟着走）；否则用户上翻了，不打扰
 */
export function shouldStickToBottom(distanceFromBottomPx: number): boolean {
  return distanceFromBottomPx < NEAR_BOTTOM_PX
}

/** 跟随态的输入：用户是否上翻、上次与这次的条数 */
export interface ScrollFollowInput {
  awayFromBottom: boolean
  prevLen: number
  nextLen: number
}

/** 跟随态该做什么：贴底 / 累计浮条 */
export interface ScrollFollowOutput {
  /** 该不该强制贴底 */
  stick: boolean
  /** 新增的未读浮条计数（delta，由调用方累加） */
  newCount: number
}

/**
 * 新内容来了之后的动作 —— PRD-M11-001 / PRD-M11-002
 *
 * 「跟随」不是瞬时距底，而是「用户有没有主动上翻过」：
 * - 没上翻（初始进入、或还停在底部）→ 无条件贴底；
 *   这覆盖了「切进会话时历史事件异步灌入」的场景——那一刻 scrollTop 还没跟上，
 *   瞬时距底会超过阈值，但不能因此判成「用户上翻」。
 * - 上翻过 → 不打扰，新增条数累计进浮条。
 */
export function nextScrollAction(input: ScrollFollowInput): ScrollFollowOutput {
  if (!input.awayFromBottom) return { stick: true, newCount: 0 }
  return { stick: false, newCount: Math.max(0, input.nextLen - input.prevLen) }
}
