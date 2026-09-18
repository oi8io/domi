import type { TranscriptItem } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/**
 * 对话流 —— PRD-M0-005 · PRD-M8-014 AC-2（样式按 docs/ui-redesign/tui.html）。
 * 前缀是单宽字符（📁🔍 之类在部分终端里宽度算错，会让整行错位）。
 */
export const PREFIX: Record<TranscriptItem['kind'], string> = {
  user: '›',
  assistant: '✓',
  reason: '·',
  'tool-call': '⚙',
  'tool-result': '←',
  permission: '🔑',
  error: '✗',
  context: '✂',
  task: '▸',
}

/** 工具调用那一行右边的「状态 · 耗时」：看紧跟着它的结果 */
export function toolMeta(result: TranscriptItem | undefined): string {
  if (result === undefined || result.kind !== 'tool-result') return tr('common.running')
  const state = result.ok ? 'done' : 'failed'
  return result.ms === undefined ? state : `${state} · ${result.ms}ms`
}

function Line({ item, next }: { item: TranscriptItem; next: TranscriptItem | undefined }): React.ReactElement {
  const t = useTheme()
  const prefix = PREFIX[item.kind]
  switch (item.kind) {
    case 'user':
      return <Text {...t.fg('ok')}>{`${prefix} ${item.text}`}</Text>
    case 'reason':
      return (
        <Text>
          <Text {...t.fg('info')}>{`${prefix} `}</Text>
          <Text {...t.fg('mut')} dimColor={!t.truecolor}>
            {item.text}
          </Text>
        </Text>
      )
    case 'tool-call':
      // 参数摘要规则由 client-core 的 summarizeArgs 定死（PRD-M0-005 AC-1），
      // 渲染层不再自己截断——两处各截一次必然对不上
      return (
        <Text {...t.fg('tool')}>
          {`${prefix} ${item.text} `}
          <Text {...t.fg('mut2')} dimColor>
            {item.summary}
          </Text>
          <Text {...t.fg('mut2')} dimColor>{`  ${toolMeta(next)}`}</Text>
        </Text>
      )
    case 'tool-result':
      return (
        <Text {...t.fg(item.ok ? 'ink2' : 'bad')}>
          <Text {...t.fg('mut')}>{`${prefix} `}</Text>
          {`${item.text} `}
          <Text {...t.fg('mut2')} dimColor>
            {item.summary}
          </Text>
        </Text>
      )
    case 'permission':
      return <Text {...t.fg(item.ok ? 'mut' : 'bad')}>{`${prefix} ${item.text}`}</Text>
    case 'context':
      return (
        <Text {...t.fg('accent')}>
          {`${prefix} ${item.text} `}
          <Text {...t.fg('mut2')} dimColor>
            {item.summary}
          </Text>
        </Text>
      )
    case 'task':
      return (
        <Text {...t.fg(item.ok === false ? 'bad' : item.ok ? 'ok' : 'info')}>
          {`${prefix} ${item.text} `}
          <Text {...t.fg('mut2')} dimColor>
            {item.summary}
          </Text>
        </Text>
      )
    case 'error':
      return <Text {...t.fg('bad')}>{`${prefix} ${item.text}`}</Text>
    case 'assistant':
      return (
        <Text>
          <Text {...t.fg('accent')}>{`${prefix} domi: `}</Text>
          <Text {...t.fg('ink')}>{item.text}</Text>
        </Text>
      )
    default:
      return <Text>{item.text}</Text>
  }
}

/** 调用之后的结果：中间隔着的权限决定跳过，碰到下一个调用或别的内容就算还没结果 */
export function resultAfter(items: readonly TranscriptItem[], i: number): TranscriptItem | undefined {
  for (let j = i + 1; j < items.length; j++) {
    const it = items[j] as TranscriptItem
    if (it.kind === 'permission') continue
    return it.kind === 'tool-result' ? it : undefined
  }
  return undefined
}

export function Transcript({ items }: { items: TranscriptItem[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* key 用 seq 而不是数组下标：delta 合并时保留的是首条的 seq，仍然唯一，
          而下标会在前面插入条目时让 React 复用错行 */}
      {items.map((item, i) => (
        <Line key={item.seq} item={item} next={item.kind === 'tool-call' ? resultAfter(items, i) : undefined} />
      ))}
    </Box>
  )
}
