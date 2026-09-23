/**
 * 代码块语法高亮 —— PRD-M11-003 AC-9（v1.16 回写）· ADR-028
 *
 * 一份分词给两端用：Web 画成带颜色的 span，TUI 画成带颜色的 Text。颜色不在这里，在 tokens.ts 的 SYNTAX
 * （Primer 的语法色——主题本身就是 Primer 的底色，同源才协调）。
 *
 * 轻量：lowlight（highlight.js 的语法表，输出 hast，不碰 DOM）只注册常用的十几种语言。
 * 不认识的语言、没写语言 → 不猜（不用 highlightAuto），整段按纯文本——误染色比不染色更糟。
 * 单独一个子路径（@domi/client-core/highlight）：Web 按需 import()，不进首屏包。
 *
 * 引擎放在 highlight-engine.js（带手写的 .d.ts）：highlight.js 的类型声明里有 `/// <reference lib="dom" />`，
 * 一旦被 tsc 读到就把整个工程的 DOM 类型拉进来（Bun 的 Headers.entries 当场报错）。隔一层 .js，tsc 只看我们的 .d.ts
 */
import { highlightHast, isRegistered, LANG_NAMES } from './highlight-engine.js'
import type { SyntaxKind } from './tokens.ts'

export type { SyntaxKind } from './tokens.ts'

export interface SyntaxSpan {
  text: string
  kind: SyntaxKind | 'plain'
}

/** 认识的语言名（含别名，小写） */
export const SUPPORTED_LANGS: ReadonlySet<string> = new Set(LANG_NAMES)

/** highlight.js 的 class → 我们的几类。没列的（标点、运算符、参数…）按正文 */
const KIND_OF: Record<string, SyntaxKind> = {
  keyword: 'keyword',
  'selector-tag': 'keyword',
  name: 'keyword',
  doctag: 'keyword',
  string: 'string',
  regexp: 'string',
  char: 'string',
  number: 'constant',
  literal: 'constant',
  built_in: 'constant',
  attr: 'constant',
  attribute: 'constant',
  property: 'constant',
  symbol: 'constant',
  comment: 'comment',
  quote: 'comment',
  title: 'title',
  section: 'title',
  'selector-id': 'title',
  'selector-class': 'title',
  type: 'type',
  class: 'type',
  variable: 'variable',
  'template-variable': 'variable',
  meta: 'meta',
  bullet: 'meta',
  addition: 'added',
  deletion: 'removed',
}

function kindOf(classes: readonly string[]): SyntaxKind | undefined {
  // 'hljs-title class_' 这种组合：类名当类型色
  if (classes.includes('hljs-title') && classes.includes('class_')) return 'type'
  for (const c of classes) {
    const k = KIND_OF[c.replace(/^hljs-/, '')]
    if (k) return k
  }
  return undefined
}

interface HastNode {
  type: string
  value?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

/** 代码 → 按行的着色段。每行拼回去与原文一字不差 */
export function highlightLines(code: string, lang: string): SyntaxSpan[][] {
  const name = lang.trim().toLowerCase()
  if (name === '' || !SUPPORTED_LANGS.has(name) || !isRegistered(name)) {
    return code.split('\n').map((l) => [{ text: l, kind: 'plain' }])
  }
  const flat: SyntaxSpan[] = []
  const walk = (n: HastNode, inherited: SyntaxKind | 'plain'): void => {
    if (n.type === 'text') {
      flat.push({ text: n.value ?? '', kind: inherited })
      return
    }
    const own = n.type === 'element' ? kindOf(n.properties?.className ?? []) : undefined
    for (const c of n.children ?? []) walk(c, own ?? inherited)
  }
  walk(highlightHast(name, code) as HastNode, 'plain')
  // 切行，并把相邻同类的段合并（少画几个 span）
  const lines: SyntaxSpan[][] = [[]]
  for (const s of flat) {
    s.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part === '') return
      const line = lines[lines.length - 1] as SyntaxSpan[]
      const last = line[line.length - 1]
      if (last && last.kind === s.kind) last.text += part
      else line.push({ text: part, kind: s.kind })
    })
  }
  return lines.map((l) => (l.length === 0 ? [{ text: '', kind: 'plain' }] : l))
}
