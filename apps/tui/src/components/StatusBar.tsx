import type { StatusSnapshot } from '@domi/client-core'
import { Box, Text } from 'ink'

/**
 * 状态栏只挑它认识的字段显示，**不改写 lastUsage**。
 * 原始 usage 整块留在事件流里（ADR-004），这里读不懂的字段不代表它们没用——
 * M2 的压缩要用的就是这些。
 */
function tokensOf(usage: Record<string, unknown> | null): string {
  if (!usage) return '— tok'
  const pick = (k: string): number | undefined => {
    const v = usage[k]
    return typeof v === 'number' ? v : undefined
  }
  const input = pick('input_tokens') ?? pick('inputTokens')
  const cached = pick('cache_read_input_tokens') ?? pick('cacheReadInputTokens')
  if (input === undefined) return '— tok'
  return cached === undefined ? `${input} tok` : `${input} tok (cache ${cached})`
}

export function StatusBar({ status }: { status: StatusSnapshot }): React.ReactElement {
  return (
    <Box>
      <Text dimColor>
        {`${status.provider}/${status.model} · ${tokensOf(status.lastUsage)} · ${status.toolCalls} 次工具`}
        {status.busy ? ' · 运行中' : ''}
      </Text>
    </Box>
  )
}
