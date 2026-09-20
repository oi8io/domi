/**
 * 新消息浮条 —— PRD-M11-002 AC-2/AC-3
 *
 * 用户上翻离开底部、又有新输出时，SessionView 在底部悬一张这个条；
 * 点一下回到底部、计数清零。纯展示组件，交互由父组件接线。
 */
import { tr } from '@domi/i18n'

export function JumpBar({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border2 bg-panel px-3.5 py-1.5 text-xs text-ink2 shadow-md hover:bg-panel-h"
      data-part="jump-bar"
    >
      {tr('web.chat.newItems', { count })}
    </button>
  )
}
