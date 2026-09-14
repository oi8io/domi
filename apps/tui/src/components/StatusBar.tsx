import type { StatusSnapshot } from '@domi/client-core'
import { Box, Text } from 'ink'

/**
 * 状态栏 —— PRD-M1-007。
 *
 * 它只**显示**指标，一个都不自己算：数字全部来自 client-core 的投影，
 * 而投影又全部来自事件流。AC-3 的判据（删掉本文件 kernel 测试仍绿）
 * 守的就是这条——见 packages/kernel/test/metrics-independence.spec.ts。
 */
export const CONTEXT_COLOR = {
  ok: 'gray',
  warn: 'yellow',
  danger: 'red',
} as const

export function StatusBar({ status }: { status: StatusSnapshot }): React.ReactElement {
  const m = status.metrics
  const tokens = m === null ? '— tok' : formatTokens(m.tokens)
  const cost = m === null ? '—' : m.cost
  const pct = m?.contextPercent ?? 0
  const level = m?.contextLevel ?? 'ok'

  // 用一个 Text 包起来而不是并排的 Box：40 列下 Box 的 flex 会把
  // 「ctx N%」甩到另一段去，读起来像两条信息。整体折行才是对的
  return (
    <Box>
      <Text dimColor>
        {`${status.provider}/${status.model} · ${tokens} · ${cost} · ${status.toolCalls} 次工具 · `}
        <Text color={CONTEXT_COLOR[level]}>{`ctx ${pct}%`}</Text>
        {status.busy ? ' · 运行中' : ''}
      </Text>
    </Box>
  )
}

function formatTokens(t: { input: number; output: number; cacheRead: number }): string {
  const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return t.cacheRead > 0
    ? `${k(t.input)}/${k(t.output)} tok (cache ${k(t.cacheRead)})`
    : `${k(t.input)}/${k(t.output)} tok`
}
