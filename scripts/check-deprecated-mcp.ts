/**
 * PRD-M2-001 AC-4 守卫：MCP 相关源码里不许出现已弃用的 sampling / roots / logging。
 *
 * 2026-07-28 规范（SEP-2577）把这三样标成弃用：server 不再能反过来让客户端调模型（sampling）、
 * 列目录（roots）或调日志级别（logging）。用了它们，老 server 能跑、新 server 不认——
 * 而且 sampling 意味着「别人的 server 花你的 token」，这本来就不该默认存在。
 *
 * 为什么扫 AST 而不是 grep：注释和文档字符串里提到这些词是正常的，
 * 只有**调用、注册处理器、声明能力**才算违规。
 *
 * 用法：bun run scripts/check-deprecated-mcp.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOTS = ['packages/mcp/src']

/** 已弃用的方法名（作为属性访问被调用时算违规） */
const METHODS = new Set(['setLoggingLevel', 'sendRootsListChanged', 'createMessage', 'listRoots'])
/** 已弃用的协议方法（作为字符串出现在调用参数里时算违规，比如 setRequestHandler('roots/list', …)） */
const WIRE_METHODS = new Set([
  'sampling/createMessage',
  'roots/list',
  'logging/setLevel',
  'notifications/roots/list_changed',
  'notifications/message',
])
/** 能力声明里的键 */
const CAPABILITY_KEYS = new Set(['sampling', 'roots', 'logging'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

const violations: string[] = []

for (const root of ROOTS) {
  for (const file of files(root)) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const report = (node: ts.Node, what: string): void => {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart())
      violations.push(`${file}:${line + 1}  ${what}`)
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isPropertyAccessExpression(callee) && METHODS.has(callee.name.text)) {
          report(node, `调用了已弃用的 ${callee.name.text}()`)
        }
        for (const arg of node.arguments) {
          if (ts.isStringLiteralLike(arg) && WIRE_METHODS.has(arg.text)) {
            report(arg, `使用了已弃用的协议方法 '${arg.text}'`)
          }
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          const name =
            prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null
          if (
            name &&
            CAPABILITY_KEYS.has(name) &&
            ts.isPropertyAssignment(prop) &&
            ts.isObjectLiteralExpression(prop.initializer)
          ) {
            report(prop, `声明了已弃用的能力 ${name}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(src)
  }
}

if (violations.length > 0) {
  console.error('[PRD-M2-001 AC-4] 发现已弃用的 MCP API（sampling / roots / logging，2026-07-28 规范 SEP-2577）：')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log(`[check-deprecated-mcp] OK —— ${ROOTS.join(', ')} 没有碰已弃用的 sampling / roots / logging`)
