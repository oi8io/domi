/**
 * PRD-M0-006 AC-1 · kernel 的纯度
 *
 * depcruise 能管"import 了什么"，管不了"调用了什么"。
 * Date.now() 与 Math.random() 不需要 import——它们是全局的，
 * 所以架构守卫在这里有个洞，必须另外补一条 AST 扫描。
 *
 * 用法：bun run scripts/check-kernel-purity.ts [扫描目录...]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

/** 非确定性来源。kernel 需要时间或随机数，必须由调用方从入参传进来 */
const FORBIDDEN_CALLS = ['Date.now', 'Math.random', 'performance.now', 'crypto.randomUUID'] as const

interface Violation {
  file: string
  line: number
  what: string
}

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        const parts = relative(root, p).split(sep)
        if (parts.includes('test')) continue
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

function scan(file: string): Violation[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true)
  const found: Violation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(sf).replace(/\s+/g, '')
      for (const bad of FORBIDDEN_CALLS) {
        if (text === bad) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          found.push({ file, line: line + 1, what: bad })
        }
      }
    }
    // new Date() 同样是非确定性来源
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Date' && (node.arguments?.length ?? 0) === 0) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      found.push({ file, line: line + 1, what: 'new Date()' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : ['packages/kernel/src']
const files = targets.flatMap(collect)
const violations = files.flatMap(scan)

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`[INV-02/PRD-M0-006 AC-1] ${v.file}:${v.line} 调用了 ${v.what}`)
    console.error('         kernel 必须是纯函数——时间与随机数由调用方从入参传进来。')
  }
  process.exit(1)
}
console.log(`[check-kernel-purity] OK —— ${files.length} 个文件，无非确定性调用`)
