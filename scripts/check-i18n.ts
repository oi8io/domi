/**
 * PRD-M9-004 AC-2 / AC-3 · 界面文案守卫
 *
 * 两件事：
 *   1. zh / en 两份 locale：key 集合一致（类型已经保证一半，这里兜住另一半——en 多出来的 key）、每条的参数名一致
 *   2. 端代码（Web / TUI / CLI）里没有中文字面量：字符串、模板串、JSX 文本、JSX 属性。
 *      注释不算（AST 里本来就没有注释节点）；测试目录不扫。
 *      确实要留的（例如发给模型的提示词、识别用户输入的关键词）在那一行或上一行写 `i18n-ignore` 并说明原因
 *
 * 用法：bun run scripts/check-i18n.ts [--report]   （--report 只列各文件还剩多少，不失败）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { en, paramNames, zh } from '../packages/i18n/src/index.ts'

/** 已经迁到 t() 的目录。迁完一处加一处——这是防回退的唯一机制 */
export const SCANNED = process.env.I18N_SCAN?.split(',') ?? ['apps/web/src', 'packages/client-core/src']

const CJK = /[㐀-鿿＀-￯　-〿]/

interface Hit {
  file: string
  line: number
  text: string
}

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        if (relative(root, p).split(sep).includes('test')) continue
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

export function scanFile(file: string, src = readFileSync(file, 'utf8')): Hit[] {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.ES2023,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const lines = src.split('\n')
  const hits: Hit[] = []
  const report = (node: ts.Node, text: string): void => {
    if (!CJK.test(text)) return
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    if (/i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')) return
    hits.push({ file, line: line + 1, text: text.replace(/\s+/g, ' ').trim().slice(0, 60) })
  }
  const visit = (node: ts.Node): void => {
    // import / export 的模块路径不是文案
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text)
    else if (ts.isTemplateExpression(node)) {
      report(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' '))
    } else if (ts.isJsxText(node)) report(node, node.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** 两份 locale 的差异：多 / 少的 key，参数名对不上的 key */
export function localeProblems(a: Record<string, string>, b: Record<string, string>): string[] {
  const out: string[] = []
  for (const k of Object.keys(a)) if (!(k in b)) out.push(`en 缺 ${k}`)
  for (const k of Object.keys(b)) if (!(k in a)) out.push(`en 多了 ${k}（zh 里没有）`)
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue
    const pa = paramNames(a[k] as string).join(',')
    const pb = paramNames(b[k] as string).join(',')
    if (pa !== pb) out.push(`${k} 的参数对不上：zh {${pa}} / en {${pb}}`)
  }
  return out
}

if (import.meta.main) {
  const reportOnly = process.argv.includes('--report')
  const problems = localeProblems(zh, en)
  const hits = SCANNED.flatMap((r) => collect(r)).flatMap((f) => scanFile(f))
  if (reportOnly) {
    const by = new Map<string, number>()
    for (const h of hits) by.set(h.file, (by.get(h.file) ?? 0) + 1)
    for (const [f, n] of [...by].sort((x, y) => y[1] - x[1])) console.log(`${String(n).padStart(4)}  ${f}`)
    console.log(`合计 ${hits.length} 处；locale 问题 ${problems.length} 个；key ${Object.keys(zh).length} 个`)
    process.exit(0)
  }
  for (const p of problems) console.error(`[PRD-M9-004 AC-2] ${p}`)
  for (const h of hits) console.error(`[PRD-M9-004 AC-3] ${h.file}:${h.line} 中文字面量：${h.text}`)
  if (problems.length + hits.length > 0) {
    console.error(
      `\n[check-i18n] ${problems.length} 个 locale 问题、${hits.length} 处中文字面量。界面文案走 t()，确实要留的写 i18n-ignore 说明原因`,
    )
    process.exit(1)
  }
  console.log(
    `[check-i18n] OK —— ${Object.keys(zh).length} 个 key，zh / en 一致；${SCANNED.join('、')} 里没有中文字面量`,
  )
}
