import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/**
 * 顶栏 —— PRD-M8-014 AC-1：「项目 › 标题」（自由会话是「会话 › 标题」）+ 轮数。
 * 窄终端里标题先被截断，项目名留着。
 */
export function ContextBar({
  project,
  title,
  turns,
}: {
  /** 任务所属项目的名字；自由会话传 null */
  project: string | null
  title: string
  turns?: number | undefined
}): React.ReactElement {
  const t = useTheme()
  return (
    <Box>
      <Box flexShrink={0}>
        <Text {...t.fg(project === null ? 'mut' : 'accent')} bold={project !== null}>
          {project === null ? '▸ 会话' : `▸ ${project}`}
        </Text>
        <Text {...t.fg('mut2')}>{' › '}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text {...t.fg('ink2')} wrap="truncate-end">
          {title === '' ? '新会话' : title}
        </Text>
      </Box>
      {turns !== undefined && (
        <Box flexShrink={0} marginLeft={1}>
          <Text {...t.fg('mut2')}>{`${turns} turns`}</Text>
        </Box>
      )}
    </Box>
  )
}

/** 底部的按键提示。只列真的能用的键；窄终端里按整条换行，不把「退出」拆到下一行 */
export function KeyHints({ hints }: { hints: ReadonlyArray<readonly [string, string]> }): React.ReactElement {
  const t = useTheme()
  return (
    <Box flexWrap="wrap" columnGap={2}>
      {hints.map(([k, label]) => (
        <Box key={k} flexShrink={0}>
          <Text {...t.fg('mut2')} dimColor={!t.truecolor}>
            <Text {...t.fg('mut')} inverse>{` ${k} `}</Text>
            {` ${label}`}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** 原型 tui.html 的按键提示（单键在输入框为空时生效；Enter / Ctrl+J 写在输入框的占位里） */
export const DEFAULT_HINTS = [
  ['p', '项目'],
  ['s', '会话'],
  ['t', '任务'],
  ['/', '命令'],
  ['?', '帮助'],
  ['Ctrl+C', '退出'],
] as const
