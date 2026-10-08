/**
 * 模型窗口表 —— PRD-M15-002 AC-1（SPEC-M15-002 取舍-15）
 *
 * 内置常用模型的 contextWindow / maxOutput（输出预留）。未知模型按保守默认
 * 128k / 8k（宁可低估窗口也不让请求 400）。
 * 精确匹配优先；其次前缀匹配（gemini-2.x 等系列型号）；再回退保守默认。
 * 用户在设置里填的 model.contextWindow / model.maxOutput 覆盖内置表。
 */

export interface ModelWindow {
  /** 上下文窗口（token） */
  contextWindow: number
  /** 输出预留（token）：模型单次最多能吐多少，请求前先扣掉 */
  maxOutput: number
}

export const DEFAULT_WINDOW: ModelWindow = { contextWindow: 128_000, maxOutput: 8_000 }

export const MODEL_WINDOWS: Readonly<Record<string, ModelWindow>> = {
  // deepseek 系
  'deepseek-chat': { contextWindow: 128_000, maxOutput: 8_000 },
  'deepseek-v4-pro': { contextWindow: 128_000, maxOutput: 8_000 },
  'deepseek-flash': { contextWindow: 128_000, maxOutput: 8_000 },
  // glm 系
  'glm-4.7-flash': { contextWindow: 128_000, maxOutput: 8_000 },
  // openai 系
  'gpt-4o': { contextWindow: 128_000, maxOutput: 16_000 },
  'o-series': { contextWindow: 128_000, maxOutput: 16_000 },
  // anthropic 系
  'claude-3-5-sonnet': { contextWindow: 200_000, maxOutput: 32_000 },
  'claude-3-7-sonnet': { contextWindow: 200_000, maxOutput: 32_000 },
}

/** 前缀匹配表（系列型号）：键是前缀，命中即用该窗口 */
const PREFIX_WINDOWS: ReadonlyArray<readonly [prefix: string, w: ModelWindow]> = [
  // gemini 系：2.x 估算 1M / 8k
  ['gemini-2', { contextWindow: 1_000_000, maxOutput: 8_000 }],
  ['gemini-', { contextWindow: 1_000_000, maxOutput: 8_000 }],
]

export interface WindowOverride {
  contextWindow?: number | undefined
  maxOutput?: number | undefined
}

export function modelWindow(model: string, override: WindowOverride = {}): ModelWindow {
  const exact = MODEL_WINDOWS[model]
  let w: ModelWindow
  if (exact !== undefined) {
    w = exact
  } else {
    const hit = PREFIX_WINDOWS.find(([prefix]) => model.startsWith(prefix))
    w = hit !== undefined ? hit[1] : DEFAULT_WINDOW
  }
  return {
    contextWindow: override.contextWindow ?? w.contextWindow,
    maxOutput: override.maxOutput ?? w.maxOutput,
  }
}
