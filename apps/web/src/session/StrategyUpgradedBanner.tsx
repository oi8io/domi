/**
 * 旧上下文策略升级提示 —— M15（SPEC 取舍-2）
 *
 * 配置里还写着旧策略名（full/clean/compact）时，读入已映射为「均衡」。
 * 这里是**首次启动一次性**提示：显示一次、用户关掉后不再出现（localStorage 记 dismissed）。
 * 不回写 yaml —— 想改就手动编辑 context.strategy。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { type ReactNode, useEffect, useState } from 'react'

const DISMISS_KEY = 'domi.strategyUpgraded.dismissed'

export function StrategyUpgradedBanner({ client }: { client: DomiClient }): ReactNode | null {
  const [upgraded, setUpgraded] = useState(false)
  useEffect(() => {
    let alive = true
    try {
      if (localStorage.getItem(DISMISS_KEY) !== null) return
    } catch {
      return
    }
    client
      .getSettings()
      .then((s) => {
        if (alive && s.values['context.strategyUpgraded'] === true) setUpgraded(true)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [client])
  if (!upgraded) return null
  return (
    <div
      className="flex items-start gap-2 border-b border-warn/30 bg-warn/10 px-5 py-1.5 text-xs text-warn"
      data-part="strategy-upgraded"
    >
      <span className="min-w-0 flex-1">{tr('settings.strategyUpgraded')}</span>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 text-warn/80 transition-colors hover:text-warn"
        data-action="dismiss-strategy-upgraded"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, '1')
          } catch {
            // 隐私模式等场景写不了就算了——下次再提示
          }
          setUpgraded(false)
        }}
      >
        ✕
      </button>
    </div>
  )
}
