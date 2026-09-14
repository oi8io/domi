import type { AskSnapshot } from '@domi/client-core'
import { Box, Text } from 'ink'

export const CONFIRM_FOCUS_ID = 'domi-confirm'

/**
 * PRD-M0-003 AC-1：确认框必须显示**完整的待执行内容**（写入的 diff / 待执行的命令行）。
 * 只显示能力名（"要执行 shell.exec，同意吗"）等于让用户闭着眼点同意——
 * 那样这道权限就成了摆设。
 */
export function ConfirmDialog({ ask }: { ask: AskSnapshot }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{`需要授权：${ask.capabilityId}`}</Text>
      <Text>{ask.detail}</Text>
      <Text dimColor>y 允许 / n 拒绝（默认拒绝）</Text>
    </Box>
  )
}
