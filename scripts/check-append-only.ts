/**
 * PRD-M0-001 AC-3 · 源码中不存在针对事件表的 UPDATE / DELETE
 *
 * 为什么是 AST 扫描而不是 grep：
 * grep 会被注释、文档和测试里的示例 SQL 骗到，误报多了人就会加 `-- ignore`，
 * 守卫随即失效。这里只看**字符串字面量与模板串**，注释与标识符一概不看。
 *
 * 用法：bun run scripts/check-append-only.ts [扫描目录...]
 * 默认扫 packages/ 与 apps/ 下的 src/（测试目录不扫——fixture 里就是要放违规 SQL）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

/** 命中即违规。events 表是 append-only 的唯一真相（INV-01） */
const FORBIDDEN: readonly { re: RegExp; what: string }[] = [
  { re: /\bupdate\s+events\b/i, what: 'UPDATE events' },
  { re: /\bdelete\s+from\s+events\b/i, what: 'DELETE FROM events' },
  { re: /\bdrop\s+table\s+(if\s+exists\s+)?events\b/i, what: 'DROP TABLE events' },
]

/**
 * 模板串里表名被插值时，无法证明目标不是 events —— fail-closed，一律拦。
 * 想改 sessions / meta 表？把表名写成字面量即可，这条规则不挡你。
 */
const FORBIDDEN_DYNAMIC: readonly { re: RegExp; what: string }[] = [
  { re: /\bupdate\s+\?/i, what: 'UPDATE <插值表名>' },
  { re: /\bdelete\s+from\s+\?/i, what: 'DELETE FROM <插值表名>' },
  { re: /\bdrop\s+table\s+(if\s+exists\s+)?\?/i, what: 'DROP TABLE <插值表名>' },
]

interface Violation {
  file: string
  line: number
  what: string
  text: string
}

function collectFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        walk(p)
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        // 只看 src/：test/ 与 fixtures/ 里允许出现违规 SQL 作为反例
        const parts = relative(root, p).split(sep)
        if (parts.includes('test') || parts.includes('fixtures')) continue
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

function scan(file: string): Violation[] {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2023, true)
  const found: Violation[] = []

  const check = (node: ts.Node, text: string, dynamic = false): void => {
    const flat = text.replace(/\s+/g, ' ')
    for (const { re, what } of dynamic ? [...FORBIDDEN, ...FORBIDDEN_DYNAMIC] : FORBIDDEN) {
      if (re.test(flat)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        found.push({ file, line: line + 1, what, text: flat.slice(0, 100) })
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      // 模板串：把插值位置当通配符，`UPDATE ${t}` 这种也要拦
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
      check(node, parts.join(' ? '), true)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : ['packages', 'apps']
const files = targets.flatMap((r) => collectFiles(r))
const violations = files.flatMap((f) => scan(f))

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`[INV-01] ${v.file}:${v.line} 出现 ${v.what} —— 事件表是 append-only 的`)
    console.error(`         ${v.text}`)
  }
  console.error(`\n[check-append-only] ${violations.length} 处违规，扫描了 ${files.length} 个文件`)
  process.exit(1)
}
console.log(`[check-append-only] OK —— ${files.length} 个文件，无针对 events 表的 UPDATE / DELETE`)
