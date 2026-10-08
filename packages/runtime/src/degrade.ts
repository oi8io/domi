/**
 * 降级链 —— PRD-M15-002 AC-3（SPEC-M15-002 取舍-17）
 *
 * 请求前预检：>遮蔽阈值 → 遮蔽一批（落 ctx.mask，付一次缓存重写）→ 仍 >压缩阈值 →
 * 压缩（可轮中）→ 仍 >硬顶 → 本轮停，落 `error{scope:'context', recoverable:true}` + 可执行出路。
 *
 * 遮蔽 / 压缩的动作由调用方注入（004 用确定性清理与现有压缩；005 / 006 分别精化为
 * 热区遮蔽与压缩 v2），本函数只管**编排与事件**——每一级动作后重估占用，逐级降。
 */

import { type BudgetLevel, evaluate } from '@domi/kernel'
import type { AnyEvent, DomiEvent } from '@domi/protocol'

export interface MaskAction {
  /** 遮蔽一批冷区，返回腾出的 token 与要落的事件。腾不出（freed=0）视为未生效 */
  mask: () => Promise<{ freed: number; ev?: AnyEvent }>
}

export interface CompactAction {
  /** 压缩一次，返回是否成功与腾出的 token。失败或腾不出 → 链继续往下（硬顶检查） */
  compact: () => Promise<{ ok: boolean; freed: number }>
}

export interface DegradeActions extends MaskAction, CompactAction {}

export interface DegradeOutcome {
  /** proceed：可以继续发请求；stop：本轮停下（已落 error 事件） */
  action: 'proceed' | 'stop'
  /** 每一级落盘的事件（ctx.mask / ctx.compact / error） */
  events: DomiEvent[]
  /** 每一级判到的档位（调试与 doctor 用） */
  levels: BudgetLevel[]
}

/**
 * 逐级降：mask 档 → 遮蔽 → 重估；compact 档 → 压缩 → 重估；hard 档 → 停。
 * 遮蔽 / 压缩动作失败或腾不出 → 继续往下走（不阻断，最终由硬顶收口）。
 */
export async function degrade(used: number, effective: number, actions: DegradeActions): Promise<DegradeOutcome> {
  const levels: BudgetLevel[] = []
  const events: DomiEvent[] = []
  let u = used
  // 阈值同源（SPEC-M15-002 取舍-16）：与守卫、状态栏、上下文 tab 读同一个 evaluate
  const level = (): BudgetLevel => evaluate(u, effective)

  let l = level()
  levels.push(l)

  // 非 ok 档都走链：遮蔽 →（重估）→ 压缩 →（重估）→ 硬顶收口。
  // 遮蔽 / 压缩动作失败或腾不出 → 继续往下（不阻断，最终由硬顶收口）
  if (l !== 'ok') {
    // ≥ 遮蔽档先遮蔽（hard 档也试——尽量把占用打下来，落 ctx.mask 付一次缓存重写）
    if (l === 'mask' || l === 'hard') {
      const r = await actions.mask()
      if (r.freed > 0) {
        if (r.ev !== undefined) events.push(r.ev as DomiEvent)
        u = Math.max(0, u - r.freed)
      }
      l = level()
      levels.push(l)
    }
    // 仍 ≥ 压缩档 → 压缩（可轮中）
    if (l === 'compact' || l === 'hard') {
      const r = await actions.compact()
      if (r.ok && r.freed > 0) {
        u = Math.max(0, u - r.freed)
        l = level()
        levels.push(l)
      } else {
        levels.push(l)
      }
    }
  }

  if (level() === 'hard') {
    events.push({
      t: 'error',
      scope: 'context',
      message:
        '上下文已到硬顶，这一轮停下。可以：在对话里再压缩一次（/compact）；开一个新会话并把摘要带过去；或换一个窗口更大的模型。',
      recoverable: true,
    })
    return { action: 'stop', events, levels }
  }
  return { action: 'proceed', events, levels }
}
