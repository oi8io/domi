/**
 * 代码提纲 —— PRD-M7-007 AC-1
 *
 * 只要导出的符号与签名（函数体不要）。文件没有任何导出（脚本）时退回列顶层声明。
 */
import { readFileSync } from 'node:fs'
import type * as TS from 'typescript'
import type { TsModule } from './ts.ts'

export interface OutlineEntry {
  kind:
    | 'function'
    | 'class'
    | 'method'
    | 'property'
    | 'interface'
    | 'type'
    | 'const'
    | 'let'
    | 'var'
    | 'enum'
    | 'export'
  name: string
  signature: string
  line: number
}

export const SIGNATURE_MAX = 300

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > SIGNATURE_MAX ? `${one.slice(0, SIGNATURE_MAX)}…` : one
}

export function outlineSource(ts: TsModule, fileName: string, text: string): OutlineEntry[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const line = (n: TS.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const head = (n: TS.Node, body: TS.Node | undefined): string =>
    clip(text.slice(n.getStart(sf), body ? body.getStart(sf) : n.getEnd()))
  const isExported = (n: TS.Node): boolean =>
    (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const isPrivate = (n: TS.Node): boolean =>
    (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []).some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    )

  const collect = (onlyExported: boolean): OutlineEntry[] => {
    const out: OutlineEntry[] = []
    for (const st of sf.statements) {
      if (onlyExported && !isExported(st) && !ts.isExportDeclaration(st) && !ts.isExportAssignment(st)) continue
      if (ts.isFunctionDeclaration(st)) {
        out.push({ kind: 'function', name: st.name?.text ?? 'default', signature: head(st, st.body), line: line(st) })
      } else if (ts.isClassDeclaration(st)) {
        const name = st.name?.text ?? 'default'
        const first = st.members[0]
        const classHead = clip(
          text.slice(st.getStart(sf), first ? first.getStart(sf) : st.getEnd()).replace(/\{\s*$/, ''),
        )
        out.push({ kind: 'class', name, signature: classHead, line: line(st) })
        for (const m of st.members) {
          if (isPrivate(m) || (m.name && ts.isPrivateIdentifier(m.name))) continue
          const mName = m.name ? m.name.getText(sf) : 'constructor'
          if (
            ts.isMethodDeclaration(m) ||
            ts.isConstructorDeclaration(m) ||
            ts.isGetAccessor(m) ||
            ts.isSetAccessor(m)
          ) {
            out.push({ kind: 'method', name: `${name}.${mName}`, signature: head(m, m.body), line: line(m) })
          } else if (ts.isPropertyDeclaration(m)) {
            const init = m.initializer
            const sig =
              init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? head(m, init.body) : head(m, init)
            out.push({
              kind: 'property',
              name: `${name}.${mName}`,
              signature: sig.replace(/=\s*$/, '').trim(),
              line: line(m),
            })
          }
        }
      } else if (ts.isInterfaceDeclaration(st)) {
        out.push({ kind: 'interface', name: st.name.text, signature: clip(st.getText(sf)), line: line(st) })
      } else if (ts.isTypeAliasDeclaration(st)) {
        out.push({ kind: 'type', name: st.name.text, signature: clip(st.getText(sf)), line: line(st) })
      } else if (ts.isEnumDeclaration(st)) {
        out.push({ kind: 'enum', name: st.name.text, signature: clip(st.getText(sf)), line: line(st) })
      } else if (ts.isVariableStatement(st)) {
        const flags = st.declarationList.flags
        const kind = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var'
        for (const d of st.declarationList.declarations) {
          const init = d.initializer
          let sig: string
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            sig = `${kind} ${clip(text.slice(d.getStart(sf), init.body.getStart(sf)))}`
          } else if (d.type) {
            sig = `${kind} ${d.name.getText(sf)}: ${clip(d.type.getText(sf))}`
          } else {
            sig = `${kind} ${clip(text.slice(d.getStart(sf), init ? init.getStart(sf) : d.getEnd()))}${init ? ` ${describeInit(ts, init)}` : ''}`
          }
          const prefix = isExported(st) ? 'export ' : ''
          out.push({
            kind,
            name: d.name.getText(sf),
            signature: `${prefix}${sig.replace(/=\s*=/, '=')}`.trim(),
            line: line(d),
          })
        }
      } else if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) {
        out.push({ kind: 'export', name: '', signature: clip(st.getText(sf)), line: line(st) })
      }
    }
    return out
  }

  const exported = collect(true)
  return exported.length > 0 ? exported : collect(false)
}

/** 变量初始值只给个形状，不给全文（对象字面量可能几百行） */
function describeInit(ts: TsModule, init: TS.Expression): string {
  if (ts.isObjectLiteralExpression(init)) return '{ … }'
  if (ts.isArrayLiteralExpression(init)) return '[ … ]'
  if (ts.isCallExpression(init) || ts.isNewExpression(init)) {
    const callee = init.expression.getText().split('\n')[0] ?? ''
    return `${ts.isNewExpression(init) ? 'new ' : ''}${callee.slice(0, 80)}(…)`
  }
  const t = init.getText()
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

export function outlineFile(ts: TsModule, absPath: string): OutlineEntry[] {
  return outlineSource(ts, absPath, readFileSync(absPath, 'utf8'))
}

export function formatOutline(path: string, entries: readonly OutlineEntry[]): string {
  if (entries.length === 0) return `${path}：没有顶层声明`
  return [`${path}`, ...entries.map((e) => `  ${e.line}: ${e.signature}`)].join('\n')
}
