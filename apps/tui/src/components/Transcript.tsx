import { summarizeReason, type TranscriptItem } from '@domi/client-core'
import { highlightLines } from '@domi/client-core/highlight'
import { tr } from '@domi/i18n'
import { Box, renderToString, Static, Text } from 'ink'
import { useEffect, useState } from 'react'
import stringWidth from 'string-width'
import { type Block, hasMarkdownStructure, type Inline, parseMarkdownBlocks } from '../render/markdown.ts'
import { scrollbarColumn, visibleRange } from '../render/viewport.ts'
import { ThemeContext, type TuiTheme, useTheme } from '../theme.ts'

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
  plan: '≡',
}

/** 计划步骤的状态标记（与 Web 同一套） */
const PLAN_MARK = { done: '✓', in_progress: '▸', skipped: '–', pending: '○' } as const

/** 工具调用那一行右边的「状态 · 耗时」：看紧跟着它的结果 */

export function toolMeta(result: TranscriptItem | undefined): string {
  if (result === undefined || result.kind !== 'tool-result') return tr('common.running')
  const state = result.ok ? 'done' : 'failed'
  return result.ms === undefined ? state : `${state} · ${result.ms}ms`
}

export function Line({
  item,
  next,
  collapsed = false,
}: {
  item: TranscriptItem
  next: TranscriptItem | undefined
  /** PRD-M10-005 AC-2：reason 行折叠时只显示「思考 · 摘要」；其余条目忽略它 */
  collapsed?: boolean
}): React.ReactElement {
  const t = useTheme()
  const prefix = PREFIX[item.kind]
  switch (item.kind) {
    case 'user':
      // 运行中补充（PRD-M13-001）：标出来，在模型真正看到它的位置
      return (
        <Text {...t.fg('ok')}>
          {item.note === true ? `${prefix} ${tr('web.transcript.note')} ${item.text}` : `${prefix} ${item.text}`}
        </Text>
      )
    case 'reason':
      // 折叠态：单行「· 思考 · 前 N 字…」，截断口径 = summarizeReason（与 summarizeArgs 同一 80 字符原则）
      return collapsed ? (
        <Text {...t.fg('mut')} dimColor={!t.truecolor}>
          {`${prefix} ${tr('web.transcript.thinking')} · ${summarizeReason(item.text)}`}
        </Text>
      ) : (
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
    case 'plan':
      // 计划卡片（PRD-M12-004 AC-8）
      return (
        <Box flexDirection="column">
          <Text {...t.fg('info')}>{`${prefix} ${item.text}`}</Text>
          {(item.plan ?? []).map((s, i) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: 计划步骤按位置展示，整份替换
              key={i}
              {...t.fg(s.status === 'in_progress' ? 'accent' : s.status === 'pending' ? 'ink2' : 'mut')}
              strikethrough={s.status === 'skipped'}
            >
              {`   ${PLAN_MARK[s.status]} ${s.text}`}
            </Text>
          ))}
        </Box>
      )
    case 'error':
      return <Text {...t.fg('bad')}>{`${prefix} ${item.text}`}</Text>
    case 'assistant': {
      // PRD-M11-003 AC-6/AC-7：有 Markdown 结构才走渲染，纯文本保持现状逐字一致（不破坏 golden 快照）
      const blocks = parseMarkdownBlocks(item.text)
      if (hasMarkdownStructure(blocks)) return <MarkdownBlocks blocks={blocks} />
      return (
        <Text>
          <Text {...t.fg('accent')}>{`${prefix} domi: `}</Text>
          <Text {...t.fg('ink')}>{item.text}</Text>
        </Text>
      )
    }
    default:
      return <Text>{item.text}</Text>
  }
}

/** 单个行内段 → Ink 文本。终端无斜体/字号，样式映射为：粗体→bold、行内代码→info 色、链接→accent+下划线、删除线→strikethrough */
function StyledInline({ s }: { s: Inline }): React.ReactElement {
  const t = useTheme()
  switch (s.style) {
    case 'bold':
      return (
        <Text bold {...t.fg('ink')}>
          {s.text}
        </Text>
      )
    case 'code':
      return (
        <Text {...t.fg('info')} dimColor={!t.truecolor}>
          {s.text}
        </Text>
      )
    case 'link':
      return (
        <Text underline {...t.fg('accent')}>
          {s.text}
        </Text>
      )
    case 'del':
      return (
        <Text strikethrough {...t.fg('mut')}>
          {s.text}
        </Text>
      )
    default:
      return <Text {...t.fg('ink')}>{s.text}</Text>
  }
}

/** 行内段序列 → Ink 文本 */
function InlineText({ inlines }: { inlines: readonly Inline[] }): React.ReactElement {
  return (
    <Text>
      {inlines.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本流，顺序不可变，index 即稳定身份
        <StyledInline key={i} s={s} />
      ))}
    </Text>
  )
}

function plainText(inlines: readonly Inline[]): string {
  return inlines.map((s) => s.text).join('')
}

/**
 * GFM 表格 → 对齐的文本行（PRD-M11-003 AC-6，与 Web 同一个原则：只留横线）。
 * 宽度按显示宽度算（一个汉字占两格）；单元格内样式简化为纯文本（终端表格的已知上限）
 */
export function tableLines(t: Extract<Block, { kind: 'table' }>): { header: string; rule: string; rows: string[] } {
  const cols = t.headers.length
  const widths = new Array<number>(cols).fill(0)
  for (const row of [t.headers, ...t.rows]) {
    for (let i = 0; i < cols; i++) {
      const w = stringWidth(plainText(row[i] ?? []))
      if (w > (widths[i] ?? 0)) widths[i] = w
    }
  }
  const pad = (s: string, w: number, align: string): string => {
    const gap = Math.max(0, w - stringWidth(s))
    if (align === 'right') return `${' '.repeat(gap)}${s}`
    if (align === 'center') return `${' '.repeat(Math.floor(gap / 2))}${s}${' '.repeat(gap - Math.floor(gap / 2))}`
    return `${s}${' '.repeat(gap)}`
  }
  const line = (row: Inline[][]): string =>
    row
      .map((c, i) => pad(plainText(c ?? []), widths[i] ?? 0, t.align[i] ?? 'left'))
      .join('  ')
      .replace(/\s+$/, '')
  const total = widths.reduce((a, w) => a + w, 0) + 2 * Math.max(0, cols - 1)
  return { header: line(t.headers), rule: '─'.repeat(total), rows: t.rows.map(line) }
}

/** 代码块（PRD-M11-003 AC-6 / AC-9）：语言头 + 左边线 + 语法色，和 Web 的代码卡片同一个意思 */
function CodeLines({ block }: { block: Extract<Block, { kind: 'code' }> }): React.ReactElement {
  const t = useTheme()
  const lines = highlightLines(block.code.replace(/\n$/, ''), block.lang)
  return (
    <Box flexDirection="column">
      <Text {...t.fg('mut2')}>{`╭─ ${block.lang === '' ? tr('web.md.code') : block.lang}`}</Text>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本行，顺序不可变
        <Text key={i}>
          <Text {...t.fg('mut2')}>│ </Text>
          {line.map((s, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同上
            <Text key={j} {...t.syntax(s.kind)} italic={s.kind === 'comment'}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
      <Text {...t.fg('mut2')}>╰─</Text>
    </Box>
  )
}

function BlockLine({ block }: { block: Block }): React.ReactElement {
  const t = useTheme()
  switch (block.kind) {
    case 'para':
      return <InlineText inlines={block.children} />
    case 'heading': {
      // 不带 #：终端没有字号，层次靠粗细与明暗（与 Web 的「小阶梯」同一个原则）
      const tone = block.level <= 2 ? 'ink' : block.level === 3 ? 'ink2' : 'mut'
      return (
        <Text bold {...t.fg(tone)}>
          {plainText(block.children)}
        </Text>
      )
    }
    case 'code':
      return <CodeLines block={block} />
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本行，顺序不可变
            <Text key={i}>
              <Text {...t.fg('mut')}>{block.ordered ? `${i + 1}. ` : '• '}</Text>
              <InlineText inlines={item} />
            </Text>
          ))}
        </Box>
      )
    case 'quote':
      return (
        <Text {...t.fg('mut')}>
          <Text {...t.fg('mut2')}>│ </Text>
          <InlineText inlines={block.children} />
        </Text>
      )
    case 'table': {
      const tl = tableLines(block)
      return (
        <Box flexDirection="column">
          <Text bold {...t.fg('ink2')}>
            {tl.header}
          </Text>
          <Text {...t.fg('mut2')}>{tl.rule}</Text>
          {tl.rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本行，顺序不可变
            <Text key={i} {...t.fg('ink')}>
              {r}
            </Text>
          ))}
        </Box>
      )
    }
    case 'hr':
      return <Text {...t.fg('mut2')}>{'─'.repeat(24)}</Text>
  }
}

/** assistant 的 Markdown 正文：第一行「✓ domi:」标签，下面逐块渲染；块与块之间空一行（与 Web 的段距同一个意思） */
export function MarkdownBlocks({ blocks }: { blocks: readonly Block[] }): React.ReactElement {
  const t = useTheme()
  return (
    <Box flexDirection="column">
      <Text {...t.fg('accent')}>✓ domi:</Text>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示文本块，顺序不可变
        <Box key={i} marginTop={i === 0 ? 0 : 1}>
          <BlockLine block={b} />
        </Box>
      ))}
    </Box>
  )
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

export function Transcript({
  items,
  reasonsExpanded = false,
}: {
  items: TranscriptItem[]
  /** PRD-M10-005：false = reason 默认折叠；true = 全部展开（e 键切换，纯展示层，不持久化） */
  reasonsExpanded?: boolean
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* key 用 seq 而不是数组下标：delta 合并时保留的是首条的 seq，仍然唯一，
          而下标会在前面插入条目时让 React 复用错行 */}
      {items.map((item, i) => (
        <Line
          key={item.seq}
          item={item}
          next={item.kind === 'tool-call' ? resultAfter(items, i) : undefined}
          collapsed={item.kind === 'reason' && !reasonsExpanded}
        />
      ))}
    </Box>
  )
}

/**
 * classic 渲染器（PRD-M9-005 AC-5）：已经定型的条目进 <Static>——只输出一次，之后留在终端原生回滚区里，不再重绘；
 * 只有还可能变的尾巴（流式追加的最后一条、还没结果的工具调用）参与每一帧的重绘。长会话不再每个 delta 重画整段历史
 */
export function settledCount(items: readonly TranscriptItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (i === items.length - 1) return i
    if ((items[i] as TranscriptItem).kind === 'tool-call' && resultAfter(items, i) === undefined) return i
  }
  return items.length
}

export function ClassicTranscript({
  items,
  reasonsExpanded = false,
}: {
  items: TranscriptItem[]
  reasonsExpanded?: boolean
}): React.ReactElement {
  const n = settledCount(items)
  const settled = items.slice(0, n)
  return (
    <>
      <Static items={settled}>
        {(item, i) => (
          <Line
            key={item.seq}
            item={item}
            next={item.kind === 'tool-call' ? resultAfter(items, i) : undefined}
            collapsed={item.kind === 'reason' && !reasonsExpanded}
          />
        )}
      </Static>
      <Box flexDirection="column">
        {items.slice(n).map((item, j) => (
          <Line
            key={item.seq}
            item={item}
            next={item.kind === 'tool-call' ? resultAfter(items, n + j) : undefined}
            collapsed={item.kind === 'reason' && !reasonsExpanded}
          />
        ))}
      </Box>
    </>
  )
}

/**
 * 一条条目在给定宽度下折成的显示行（带颜色的 ANSI 串）。用 Ink 自己的 renderToString 渲染同一个 <Line>，
 * 折行、中日韩双宽字符都和直接渲染一模一样。按条目对象缓存：没变的条目不重算（client-core 只替换变了的那一条）
 *
 * ⚠️ 不能在 React 的渲染 / 提交阶段里调（组件体、useMemo、useEffect 同步部分）：Ink 的 reconciler 是单例，
 * 嵌套的 renderToString 在渲染里返回空串、在 effect 里直接把 yoga 弄崩。组件里一律走 useTranscriptLines
 */
const lineCache = new WeakMap<
  TranscriptItem,
  { width: number; next: TranscriptItem | undefined; theme: TuiTheme; collapsed: boolean; lines: string[] }
>()

export function itemLines(
  item: TranscriptItem,
  next: TranscriptItem | undefined,
  width: number,
  theme: TuiTheme,
  collapsed = false,
): string[] {
  const hit = lineCache.get(item)
  if (hit && hit.width === width && hit.next === next && hit.theme === theme && hit.collapsed === collapsed) {
    return hit.lines
  }
  const out = renderToString(
    <ThemeContext.Provider value={theme}>
      <Line item={item} next={next} collapsed={collapsed} />
    </ThemeContext.Provider>,
    { columns: Math.max(10, width) },
  )
  const lines = out === '' ? [''] : out.split('\n')
  lineCache.set(item, { width, next, theme, collapsed, lines })
  return lines
}

export function transcriptLines(
  items: readonly TranscriptItem[],
  width: number,
  theme: TuiTheme,
  reasonsExpanded = false,
): string[] {
  return items.flatMap((item, i) =>
    itemLines(
      item,
      item.kind === 'tool-call' ? resultAfter(items, i) : undefined,
      width,
      theme,
      item.kind === 'reason' && !reasonsExpanded,
    ),
  )
}

/**
 * Ctrl+O 写进终端原生回滚区的内容（PRD-M9-005 AC-4）：**完整**对话，按 classic 的样子（同一个 <Line>），末尾一行回去的提示。
 * 在按键回调里调（不在 React 渲染里），见 itemLines 的警告
 */
export function dumpText(items: readonly TranscriptItem[], width: number, theme: TuiTheme): string {
  return `${transcriptLines(items, width, theme).join('\n')}\n\n${tr('tui.scroll.dumpHint')}\n`
}

/**
 * 组件里拿显示行的唯一入口：条目 / 宽度 / 主题变了之后，在 setImmediate 里（React 的工作循环之外）重算。
 * 代价是新内容晚一个事件循环出现，换来的是不和 Ink 的 reconciler 抢
 */
export function useTranscriptLines(
  items: readonly TranscriptItem[],
  width: number,
  theme: TuiTheme,
  reasonsExpanded = false,
): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    const h = setImmediate(() => setLines(transcriptLines(items, width, theme, reasonsExpanded)))
    return () => clearImmediate(h)
  }, [items, width, theme, reasonsExpanded])
  return lines
}

/**
 * fullscreen 渲染器的对话区（PRD-M9-005 AC-2）：只画可见的那几行，右边一列滚动条。
 * lines / offset 由上层算好传进来（上层要拿总行数去处理翻页）
 */
export function Viewport({
  lines,
  height,
  offset,
  unseen,
}: {
  lines: readonly string[]
  height: number
  offset: number
  unseen: number
}): React.ReactElement {
  const t = useTheme()
  // 「N 条新消息」自己占底部一行，不压在内容上（压上去会留下半截旧字）
  const badge = unseen > 0 && height > 1
  const rows = badge ? height - 1 : height
  const { start, end } = visibleRange(lines.length, rows, offset)
  const shown = lines.slice(start, end)
  // 内容不满一屏时顶部留白，最新的内容贴着输入区
  const pad = Math.max(0, rows - shown.length)
  const bar = scrollbarColumn(lines.length, rows, start)
  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection="row" height={rows}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {pad > 0 && <Box height={pad} />}
          <Text>{shown.join('\n')}</Text>
        </Box>
        <Box flexDirection="column" width={1} flexShrink={0}>
          <Text {...t.fg('mut2')}>{bar.join('\n')}</Text>
        </Box>
      </Box>
      {badge && (
        <Box justifyContent="center" height={1} overflow="hidden">
          <Text {...t.fg('accent')} inverse>{` ${tr('tui.scroll.newItems', { n: unseen })} `}</Text>
        </Box>
      )}
    </Box>
  )
}
