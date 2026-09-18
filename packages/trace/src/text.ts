/**
 * 轨迹的文本渲染 —— PRD-M2-005 AC-1 / AC-2 / AC-3
 *
 * 终端里的树。折叠态**不是把内容藏起来就完了**：
 * 它要显示前 200 字符加总字节数，这样人一眼能判断「要不要展开」——
 * 只显示一句「（已折叠）」等于逼人每一个都展开一遍。
 */
import { tr } from '@domi/i18n'
import type { TraceNode, TraceTree } from './model.ts'

/**
 * 终端里**行数**比字节数更接近人的忍耐度：120 行「(pass) case N」只有 1.8KB，
 * 够不着 AC-2 的 2KB 阈值，却能把一屏冲干净。
 * 所以文本渲染在 AC-2 之外再加一道行数上限——**只会折得更多，不会折得更少**，
 * 不违反 AC-2，也不影响 HTML 导出（那里全文照样在文件里）。
 */
export const MAX_LINES = 40

const GLYPH: Record<string, string> = {
  input: '▶',
  think: '·',
  tool: '⚙',
  permission: '🔑',
  cleanup: '✂',
  compact: '⊟',
  error: '✗',
  answer: '◆',
  task: '▸',
  other: '•',
}

function fmtCost(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(4)}`
}

function renderNode(n: TraceNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth)
  const bits: string[] = []
  if (n.ms !== null) bits.push(`${n.ms}ms`)
  if (n.tokens)
    bits.push(`↑${n.tokens.input} ↓${n.tokens.output}${n.tokens.cacheRead > 0 ? ` ⚡${n.tokens.cacheRead}` : ''}`)
  if (n.costUsdCumulative !== null) bits.push(tr('trace.cumulative', { fmtCost: fmtCost(n.costUsdCumulative) }))
  const suffix = bits.length > 0 ? `  [${bits.join(' · ')}]` : ''

  out.push(`${pad}${GLYPH[n.kind] ?? '•'} ${n.title}${suffix}`)

  let body = n.collapsed ? tr('trace.folded', { preview: n.preview, bytes: n.bytes }) : n.detail
  const lines = body.split('\n')
  if (!n.collapsed && lines.length > MAX_LINES) {
    body = tr('trace.truncated', {
      join: lines.slice(0, MAX_LINES).join('\n'),
      v: lines.length - MAX_LINES,
      bytes: n.bytes,
    })
  }
  for (const line of body.split('\n')) out.push(`${pad}    ${line}`)

  for (const c of n.children) renderNode(c, depth + 1, out)
}

export function renderText(tree: TraceTree): string {
  const out: string[] = [tr('trace.title', { sessionId: tree.sessionId }), '']
  for (const n of tree.nodes) renderNode(n, 0, out)
  out.push('')
  out.push(tr('trace.totalCost', { fmtCost: fmtCost(tree.totalCostUsd) }))
  if (tree.unpricedModels.length > 0) {
    // 显示 0 会让人以为免费，比显示「不知道」更糟 —— 与状态栏同一条口径
    out.push(tr('trace.unpriced', { join: tree.unpricedModels.join(tr('common.listSep')) }))
  }
  return out.join('\n')
}
