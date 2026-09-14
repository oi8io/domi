import type { TranscriptItem } from '@domi/client-core'
import { Box, Text } from 'ink'

const PREFIX: Record<TranscriptItem['kind'], string> = {
  user: '›',
  assistant: '',
  reason: '·',
  'tool-call': '⚙',
  'tool-result': '←',
  permission: '🔑',
  error: '✗',
  context: '✂',
}

function Line({ item }: { item: TranscriptItem }): React.ReactElement {
  const prefix = PREFIX[item.kind]
  switch (item.kind) {
    case 'user':
      return <Text color="green">{`${prefix} ${item.text}`}</Text>
    case 'reason':
      return <Text dimColor>{`${prefix} ${item.text}`}</Text>
    case 'tool-call':
      // 参数摘要规则由 client-core 的 summarizeArgs 定死（PRD-M0-005 AC-1），
      // 渲染层不再自己截断——两处各截一次必然对不上
      return (
        <Text color="yellow">
          {`${prefix} ${item.text} `}
          <Text dimColor>{item.summary}</Text>
        </Text>
      )
    case 'tool-result':
      return (
        <Text color={item.ok ? 'gray' : 'red'}>
          {`${prefix} ${item.text} `}
          <Text dimColor>{item.summary}</Text>
        </Text>
      )
    case 'permission':
      return <Text color={item.ok ? 'gray' : 'red'}>{`${prefix} ${item.text}`}</Text>
    case 'context':
      return (
        <Text color="cyan">
          {`${prefix} ${item.text} `}
          <Text dimColor>{item.summary}</Text>
        </Text>
      )
    case 'error':
      return <Text color="red">{`${prefix} ${item.text}`}</Text>
    default:
      return <Text>{item.text}</Text>
  }
}

export function Transcript({ items }: { items: TranscriptItem[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* key 用 seq 而不是数组下标：delta 合并时保留的是首条的 seq，仍然唯一，
          而下标会在前面插入条目时让 React 复用错行 */}
      {items.map((item) => (
        <Line key={item.seq} item={item} />
      ))}
    </Box>
  )
}
