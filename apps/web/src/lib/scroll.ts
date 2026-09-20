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
