/**
 * TUI Markdown 渲染层 —— PRD-M11-003 AC-6/AC-7/AC-8 · SPEC-M11-008
 *
 * 与 Web 共用同一个 parser（remark-parse + remark-gfm），只重写最后一层：
 * mdast → 块序列（Block[]），颜色/前缀由 Transcript 层按 theme 映射成 Ink 元素。
 *
 * 终端上限（诚实记录）：无斜体（多数终端不支持）、无真实字号
 * （标题用颜色/前缀分）；HTML 节点直接跳过（remark 不把 HTML 解析成标签，INV-06）。
 */
import type { BlockContent, DefinitionContent, List, ListItem, PhrasingContent, Root, RootContent, Table } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export type InlineStyle = 'plain' | 'bold' | 'code' | 'link' | 'del'

export interface Inline {
  text: string
  style: InlineStyle
  /** style === 'link' 时的目标地址 */
  url?: string
}

export type Block =
  | { kind: 'para'; children: Inline[] }
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'table'; align: ('left' | 'center' | 'right')[]; headers: Inline[][]; rows: Inline[][][] }
  | { kind: 'hr' }

const PARSER = unified().use(remarkParse).use(remarkGfm)

/** 行内节点 → 段序列。html 节点返回 []（跳过，INV-06）；break 转成换行文本 */
function inlines(node: PhrasingContent): Inline[] {
  switch (node.type) {
    case 'text':
      return [{ text: node.value, style: 'plain' }]
    case 'break':
      return [{ text: '\n', style: 'plain' }]
    case 'inlineCode':
      return [{ text: node.value, style: 'code' }]
    case 'strong':
      return node.children.flatMap(inlines).map((s) => ({ ...s, style: 'bold' as const }))
    case 'delete':
      return node.children.flatMap(inlines).map((s) => ({ ...s, style: 'del' as const }))
    case 'link':
      return node.children.flatMap(inlines).map((s) => ({ ...s, style: 'link' as const, url: node.url }))
    case 'emphasis':
      // 终端无斜体，保留文本（不丢内容）
      return node.children.flatMap(inlines)
    case 'image':
      return [{ text: node.alt || node.url, style: 'plain' }]
    case 'html':
      return []
    default:
      return []
  }
}

function blockquoteChildren(node: { children: (BlockContent | DefinitionContent)[] }): Inline[] {
  const parts: Inline[] = []
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      if (parts.length > 0) parts.push({ text: '\n', style: 'plain' })
      parts.push(...child.children.flatMap(inlines))
    }
  }
  return parts
}

/** 列表：扁平化，嵌套列表项加两格缩进；GFM 任务列表带 [x]/[ ] 前缀 */
function listItems(list: List, indent = ''): Inline[][] {
  const out: Inline[][] = []
  for (const item of list.children as ListItem[]) {
    const check = item.checked === null || item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] '
    const head = indent === '' && check === '' ? [] : [{ text: `${indent}${check}`, style: 'plain' as const }]
    let text: Inline[] = []
    let nested: Inline[][] = []
    for (const child of item.children) {
      if (child.type === 'paragraph') text = child.children.flatMap(inlines)
      else if (child.type === 'list') nested = listItems(child, `${indent}  `)
    }
    out.push([...head, ...text])
    out.push(...nested)
  }
  return out
}

function tableBlock(node: Table): Block {
  const align = (node.align ?? []).map((a) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left'))
  const [head, ...body] = node.children
  const headers = head === undefined ? [] : head.children.map((c) => c.children.flatMap(inlines))
  const rows = body.map((r) => r.children.map((c) => c.children.flatMap(inlines)))
  return { kind: 'table', align, headers, rows }
}

function block(node: RootContent): Block | null {
  switch (node.type) {
    case 'paragraph':
      return { kind: 'para', children: node.children.flatMap(inlines) }
    case 'heading':
      return { kind: 'heading', level: node.depth, children: node.children.flatMap(inlines) }
    case 'code':
      return { kind: 'code', lang: node.lang ?? '', code: node.value }
    case 'list':
      return { kind: 'list', ordered: node.ordered ?? false, items: listItems(node) }
    case 'blockquote':
      return { kind: 'quote', children: blockquoteChildren(node) }
    case 'table':
      return tableBlock(node)
    case 'thematicBreak':
      return { kind: 'hr' }
    case 'html':
      return null
    default:
      return null
  }
}

/** Markdown 文本 → 块序列。解析本身是容错的，不抛异常 */
export function parseMarkdownBlocks(md: string): Block[] {
  const root = PARSER.parse(md) as Root
  const blocks: Block[] = []
  for (const child of root.children) {
    const b = block(child)
    if (b !== null) blocks.push(b)
  }
  return blocks
}

/**
 * 是否值得走 Markdown 渲染。AC-7：纯文本（无块结构、无行内样式）返回 false，
 * Transcript 层据此走现状路径，保证与现状逐字一致。
 */
export function hasMarkdownStructure(blocks: Block[]): boolean {
  return blocks.some((b) => b.kind !== 'para' || (b.kind === 'para' && b.children.some((c) => c.style !== 'plain')))
}
