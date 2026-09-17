import { Box, Text, useInput, useWindowSize } from 'ink'
import { type ReactNode, useEffect, useState } from 'react'
import { moveOf } from '../keys.ts'
import { type Tone, useTheme } from '../theme.ts'
import { KeyHints } from './ContextBar.tsx'

/**
 * 弹层 —— PRD-M8-015 · SPEC-M8-015（原型 tui.html 的 .modal）。
 * 终端里没有真正的「浮在上面」：弹层打开时顶替对话区，顶栏和状态栏不动。
 * 标题、搜索行（直接打字就是搜索）、分组列表、底部按键提示；宽度 min(80, 列数 - 4)。
 */
export interface OverlayItem {
  key: string
  label: string
  meta?: string
  group?: string
  /** 左边的点：running 会在 ● ○ 之间闪 */
  dot?: Tone | 'running' | 'off'
  /** 搜索时额外匹配的文字（路径之类） */
  search?: string
}

const MAX_ROWS = 12

export function filterItems(items: readonly OverlayItem[], query: string): OverlayItem[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...items]
  return items.filter((i) => `${i.label} ${i.meta ?? ''} ${i.search ?? ''}`.toLowerCase().includes(q))
}

/** 运行中的点：每 500ms 在 ● ○ 之间切（代替 Web 的脉冲） */
function useBlink(on: boolean): boolean {
  const [lit, setLit] = useState(true)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setLit((x) => !x), 500)
    return () => clearInterval(t)
  }, [on])
  return lit
}

export function Overlay({
  title,
  items,
  searchable = true,
  placeholder = '搜索…',
  hints,
  empty = '没有内容',
  notice,
  active = true,
  onSelect,
  onKey,
  onClose,
  children,
}: {
  title: string
  items: readonly OverlayItem[]
  searchable?: boolean
  placeholder?: string
  hints: ReadonlyArray<readonly [string, string]>
  empty?: string
  notice?: string | null | undefined
  /** false = 按键交给别人（例如弹层里的表单） */
  active?: boolean
  onSelect(item: OverlayItem): void
  /** 列表之外的单键（不可搜索的弹层里才有意义），返回 true 表示吃掉了 */
  onKey?(input: string, item: OverlayItem | undefined): boolean
  onClose(): void
  /** 顶替列表的内容（表单） */
  children?: ReactNode
}): React.ReactElement {
  const t = useTheme()
  const { columns } = useWindowSize()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const shown = filterItems(items, searchable ? query : '')
  const cur = Math.min(sel, Math.max(shown.length - 1, 0))
  const blink = useBlink(shown.some((i) => i.dot === 'running'))

  useInput(
    (input, key) => {
      if (key.escape) return onClose()
      const d = moveOf(input, key)
      if (d !== 0) {
        setSel(shown.length === 0 ? 0 : (cur + d + shown.length) % shown.length)
        return
      }
      if (key.return) {
        const it = shown[cur]
        if (it) onSelect(it)
        return
      }
      if (key.ctrl || key.meta || key.tab) return
      if (searchable) {
        if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1))
        else if (input) setQuery((q) => q + input)
        setSel(0)
        return
      }
      if (input) onKey?.(input, shown[cur])
    },
    { isActive: active },
  )

  // 只画选中项附近的一屏
  const start = Math.max(0, Math.min(cur - Math.floor(MAX_ROWS / 2), shown.length - MAX_ROWS))
  const page = shown.slice(start, start + MAX_ROWS)
  const width = Math.max(20, Math.min(80, (columns || 80) - 4))
  let lastGroup: string | undefined

  return (
    <Box justifyContent="center">
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={t.border('accent')}>
        <Box paddingX={1}>
          <Text {...t.fg('accent')} bold>
            {title}
          </Text>
        </Box>
        {children ?? (
          <>
            {searchable && (
              <Box paddingX={1} borderStyle="single" borderColor={t.border('mut2')} marginX={1}>
                <Text {...t.fg(query === '' ? 'mut2' : 'ink2')}>
                  {query === '' ? `⌕ ${placeholder}` : `⌕ ${query}`}
                </Text>
                {query !== '' && <Text inverse> </Text>}
              </Box>
            )}
            <Box flexDirection="column" paddingY={0}>
              {page.length === 0 && (
                <Box paddingX={2}>
                  <Text {...t.fg('mut')}>{empty}</Text>
                </Box>
              )}
              {page.map((it) => {
                const header = it.group !== undefined && it.group !== lastGroup ? it.group : null
                lastGroup = it.group
                const selected = it === shown[cur]
                const dot = it.dot ?? 'off'
                const glyph = dot === 'running' ? (blink ? '●' : '○') : dot === 'off' ? '○' : '●'
                const dotTone: Tone = dot === 'running' ? 'accent' : dot === 'off' ? 'mut2' : dot
                return (
                  <Box key={it.key} flexDirection="column">
                    {header !== null && (
                      <Box paddingX={1} marginTop={1}>
                        <Text {...t.fg('mut2')} bold>
                          {header.toUpperCase()}
                        </Text>
                      </Box>
                    )}
                    <Box paddingX={1}>
                      <Text {...t.fg(selected ? 'accent' : 'mut2')}>{selected ? '› ' : '  '}</Text>
                      <Text {...t.fg(dotTone)}>{`${glyph} `}</Text>
                      <Box flexGrow={1} flexShrink={1}>
                        <Text {...t.fg(selected ? 'accent' : 'ink2')} bold={selected} wrap="truncate-end">
                          {it.label}
                        </Text>
                      </Box>
                      {it.meta !== undefined && (
                        <Box flexShrink={2} marginLeft={1}>
                          <Text {...t.fg('mut2')} wrap="truncate-start">
                            {it.meta}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )
              })}
              {shown.length > page.length && (
                <Box paddingX={2}>
                  <Text {...t.fg('mut2')}>{`… 共 ${shown.length} 项`}</Text>
                </Box>
              )}
            </Box>
          </>
        )}
        {notice !== undefined && notice !== null && (
          <Box paddingX={1}>
            <Text {...t.fg('warn')}>{notice}</Text>
          </Box>
        )}
        <Box
          paddingX={1}
          borderStyle="single"
          borderColor={t.border('mut2')}
          borderLeft={false}
          borderRight={false}
          borderBottom={false}
        >
          <KeyHints hints={hints} />
        </Box>
      </Box>
    </Box>
  )
}
