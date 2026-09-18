/**
 * 单文件静态 HTML 导出 —— PRD-M2-005 AC-5
 *
 * AC-5 要的是：**内联所有 CSS/JS、无外部请求、在没有网络的浏览器里能打开并展开全部节点。**
 *
 * 所以这里做了一个决定：**一行 JavaScript 都不写。**
 * 折叠展开用原生 `<details>/<summary>`。理由不是洁癖：
 * 没有 JS 就没有「脚本没跑起来所以展不开」这类失败模式，
 * 而「无外部请求」也从一条需要测试去守的性质，变成了结构上不可能违反的性质。
 *
 * 这是**快照**，不含任何与 daemon 通信的能力——与 M3 Web 客户端的边界就在这里。
 */
import { tr } from '@domi/i18n'
import type { TraceNode, TraceTree } from './model.ts'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CSS = `
:root{color-scheme:light dark}
body{margin:0;padding:24px;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fbfbfa;color:#1a1a1a}
@media(prefers-color-scheme:dark){body{background:#151515;color:#e6e6e6}}
h1{font-size:16px;margin:0 0 4px}
.meta{opacity:.65;margin-bottom:20px}
details{border-left:2px solid currentColor;margin:6px 0;padding-left:12px;opacity:.95}
summary{cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ ";opacity:.5}
details[open]>summary::before{content:"▾ "}
.kind{opacity:.5;margin-right:6px}
.bits{opacity:.6;font-size:12px;margin-left:8px}
pre{white-space:pre-wrap;word-break:break-word;margin:6px 0;padding:8px;background:rgba(127,127,127,.12);border-radius:4px}
.seq{opacity:.35;font-size:11px;margin-left:8px}
.total{margin-top:24px;font-weight:600}
.note{opacity:.6;font-weight:400;font-size:12px}
`.trim()

function fmtCost(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(4)}`
}

function bits(n: TraceNode): string {
  const b: string[] = []
  if (n.ms !== null) b.push(`${n.ms}ms`)
  if (n.tokens)
    b.push(`↑${n.tokens.input} ↓${n.tokens.output}${n.tokens.cacheRead > 0 ? ` ⚡${n.tokens.cacheRead}` : ''}`)
  if (n.costUsdCumulative !== null) b.push(tr('trace.cumulative', { fmtCost: fmtCost(n.costUsdCumulative) }))
  return b.length > 0 ? `<span class="bits">${escapeHtml(b.join(' · '))}</span>` : ''
}

function renderNode(n: TraceNode): string {
  // id 用 seq：L1 回放的差异报告指到哪个 seq，这里就有一个锚点可以跳（PRD-M2-008 AC-4）
  const open = n.collapsed ? '' : ' open'
  const head =
    `<summary><span class="kind">${escapeHtml(n.kind)}</span>${escapeHtml(n.title)}` +
    `${bits(n)}<span class="seq">seq ${n.seq}</span></summary>`
  const body = `<pre>${escapeHtml(n.detail)}</pre>`
  const kids = n.children.map(renderNode).join('')
  const hint = n.collapsed ? tr('trace.htmlFolded', { bytes: n.bytes }) : ''
  return `<details id="seq-${n.seq}"${open}>${head}${hint}${body}${kids}</details>`
}

export function exportHtml(tree: TraceTree): string {
  const body = tree.nodes.map(renderNode).join('')
  const note =
    tree.unpricedModels.length > 0
      ? tr('trace.htmlUnpriced', { escapeHtml: escapeHtml(tree.unpricedModels.join(tr('common.listSep'))) })
      : ''
  return tr('trace.htmlPage', {
    escapeHtml: escapeHtml(tree.sessionId),
    CSS,
    escapeHtml2: escapeHtml(tree.sessionId),
    length: tree.nodes.length,
    body,
    fmtCost: fmtCost(tree.totalCostUsd),
    note,
  })
}
