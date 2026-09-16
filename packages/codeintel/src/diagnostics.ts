/**
 * 类型诊断 —— PRD-M7-007 AC-2
 *
 * 每个 tsconfig 一个常驻的 LanguageService：第二次起只重查变了的文件（版本号 = mtime），比整仓 tsc 快得多。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type * as TS from 'typescript'
import { loadTypeScript, type TsModule } from './ts.ts'

export interface Diagnostic {
  file: string
  line: number
  col: number
  code: number
  category: 'error' | 'warning' | 'suggestion' | 'message'
  message: string
}

interface Project {
  ts: TsModule
  ls: TS.LanguageService
  files: Set<string>
  configPath: string | null
}

/** 没有 tsconfig 时用的选项：尽量宽，只报真错 */
function defaultOptions(ts: TsModule): TS.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: false,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    allowImportingTsExtensions: true,
  }
}

export const MAX_DIAGNOSTICS = 100

export class DiagnosticsService {
  private readonly projects = new Map<string, Promise<Project>>()

  private async project(absFile: string): Promise<Project> {
    const dir = dirname(absFile)
    const ts = await loadTypeScript(dir)
    const configPath = ts.findConfigFile(dir, (p) => ts.sys.fileExists(p)) ?? null
    const key = configPath ?? `nocfg:${dir}`
    const hit = this.projects.get(key)
    if (hit) return hit
    const made = (async (): Promise<Project> => {
      let options = defaultOptions(ts)
      let names: string[] = []
      if (configPath) {
        const parsed = ts.getParsedCommandLineOfConfigFile(
          configPath,
          {},
          {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: () => undefined,
          },
        )
        if (parsed) {
          options = { ...parsed.options, noEmit: true }
          names = parsed.fileNames
        }
      }
      const files = new Set(names.map((f) => resolve(f)))
      const host: TS.LanguageServiceHost = {
        getScriptFileNames: () => [...files],
        getScriptVersion: (f) => {
          try {
            return String(statSync(f).mtimeMs)
          } catch {
            return '0'
          }
        },
        getScriptSnapshot: (f) => {
          if (!existsSync(f)) return undefined
          return ts.ScriptSnapshot.fromString(readFileSync(f, 'utf8'))
        },
        getCurrentDirectory: () => (configPath ? dirname(configPath) : dir),
        getCompilationSettings: () => options,
        getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
        fileExists: (p) => ts.sys.fileExists(p),
        readFile: (p, e) => ts.sys.readFile(p, e),
        readDirectory: (...a) => ts.sys.readDirectory(...a),
        directoryExists: (p) => ts.sys.directoryExists(p),
        getDirectories: (p) => ts.sys.getDirectories(p),
      }
      const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
      return { ts, ls, files, configPath }
    })()
    this.projects.set(key, made)
    made.catch(() => this.projects.delete(key))
    return made
  }

  async check(absFile: string): Promise<{ diagnostics: Diagnostic[]; total: number; tsconfig: string | null }> {
    const p = await this.project(absFile)
    const file = resolve(absFile)
    p.files.add(file)
    const { ts } = p
    const raw = [...p.ls.getSyntacticDiagnostics(file), ...p.ls.getSemanticDiagnostics(file)]
    const cat = (c: TS.DiagnosticCategory): Diagnostic['category'] =>
      c === ts.DiagnosticCategory.Error
        ? 'error'
        : c === ts.DiagnosticCategory.Warning
          ? 'warning'
          : c === ts.DiagnosticCategory.Suggestion
            ? 'suggestion'
            : 'message'
    const all = raw.map((d) => {
      const pos =
        d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 }
      return {
        file: d.file?.fileName ?? file,
        line: pos.line + 1,
        col: pos.character + 1,
        code: d.code,
        category: cat(d.category),
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      }
    })
    return { diagnostics: all.slice(0, MAX_DIAGNOSTICS), total: all.length, tsconfig: p.configPath }
  }

  dispose(): void {
    for (const p of this.projects.values()) void p.then((x) => x.ls.dispose()).catch(() => undefined)
    this.projects.clear()
  }
}
