import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

/** `/` 命令与 `@` 文件补全（PRD-M8-015 AC-5）：输入框下面列候选，Tab 补全选中的那个，↑↓ 换 */
export function SlashHints({
  items,
  selected,
  wide = false,
}: {
  items: ReadonlyArray<{ name: string; desc?: string; args?: string }>
  selected: number
  /** 名字长（文件路径）时不定宽 */
  wide?: boolean
}): React.ReactElement | null {
  const t = useTheme()
  if (items.length === 0) return null
  const start = Math.max(0, Math.min(selected - 3, items.length - 6))
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {items.slice(start, start + 6).map((c, i) => {
        const on = start + i === selected
        return (
          <Box key={c.name}>
            <Box {...(wide ? { flexShrink: 1, marginRight: 2 } : { width: 12, flexShrink: 0 })}>
              <Text {...t.fg(on ? 'accent' : 'ink2')} bold={on}>
                {c.name}
              </Text>
            </Box>
            <Text {...t.fg('mut2')} wrap="truncate-end">
              {c.desc ?? ''}
              {c.args === undefined ? '' : `  ${c.args}`}
            </Text>
          </Box>
        )
      })}
      <Text {...t.fg('mut2')}>{`tab 补全 · ↑↓ 选择${items.length > 6 ? ` · 共 ${items.length} 个` : ''}`}</Text>
    </Box>
  )
}
