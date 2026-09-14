/**
 * PRD-M1-010 AC-4 · 运行期不向 ~/.domi 与当前工作目录以外的位置写文件（INV-11）
 *
 * 规则只有一条，但它是真正危险的那一类：**写入路径不得是绝对路径字面量**。
 *
 * 第一版我写的是「路径来源看起来不安全就报」，结果三条全是误报——
 * `writeFileSync(index)` 里的 index 明明是 join(outDir, ...) 算出来的。
 * 启发式猜「来源安不安全」会变成一个越加越长的白名单，最后所有人都学会往里加名字。
 * 改成只认绝对路径字面量：它是唯一一种**在代码里就能确定**越界的写法，
 * 其余路径都能顺着变量追回去。
 *
 * 剩下的一半由运行期 fs 钩子覆盖（集成测试里挂）——静态扫描覆盖全部代码但判不了运行时值，
 * 运行期钩子判得了值但只覆盖跑到的路径。两者互补，缺一个都不够。
 *
 * 用法：bun run scripts/check-write-paths.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const WRITE_CALLS = new Set([
  'writeFileSync',
  'appendFileSync',
  'mkdirSync',
  'rmSync',
  'renameSync',
  'copyFileSync',
  'writeFile',
  'appendFile',
])

/** 允许写到这些绝对位置：系统临时目录之外没有别的例外 */
const ALLOWED_ABSOLUTE_PREFIXES = ['/tmp/', '/dev/null']

const roots = ['packages', 'apps']
const violations: string[] = []

function files(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
        const parts = relative(root, p).split(sep)
        if (parts.includes('test')) continue
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

/** 取出「在代码里就能确定」的路径开头；拿不准返回 null */
function staticPrefix(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text
  // join('/etc', x) —— 第一段是字面量时同样能确定
  if (ts.isCallExpression(node)) {
    const callee = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ''
    if ((callee === 'join' || callee === 'resolve') && node.arguments[0]) {
      return staticPrefix(node.arguments[0], sf)
    }
  }
  return null
}

for (const f of roots.flatMap(files)) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.ES2023, true)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ''
      const arg = node.arguments[0]
      if (WRITE_CALLS.has(name) && arg) {
        const prefix = staticPrefix(arg, sf)
        const isAbsolute = prefix !== null && (prefix.startsWith('/') || prefix.startsWith('~'))
        const allowed = prefix !== null && ALLOWED_ABSOLUTE_PREFIXES.some((p) => prefix.startsWith(p))
        if (isAbsolute && !allowed) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          violations.push(`${f}:${line + 1} ${name}() 写到了绝对路径字面量 "${prefix}"`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (violations.length > 0) {
  for (const v of violations) console.error(`[INV-11] ${v}`)
  console.error('\n写入路径不得是绝对路径字面量：它绕开了所有基于 dataDir / cwd 的约束。')
  console.error('要写到固定位置，请从 dataDir() 或显式传入的参数算出来。')
  process.exit(1)
}
console.log(`[check-write-paths] OK —— 无绝对路径字面量写入`)
