/**
 * code.outline / code.diagnostics —— PRD-M7-007 · 都归 fs.read（只读）
 */
import { statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listFiles, resolveWithinRoot, type Tool } from '@domi/capability'
import { z } from 'zod'
import type { Diagnostic, DiagnosticsService } from './diagnostics.ts'
import { formatOutline, outlineFile } from './outline.ts'
import { isSupported, loadTypeScript } from './ts.ts'

export const OUTLINE_MAX_CHARS = 16_000
export const OUTLINE_MAX_FILES = 50

const OutlineArgs = z.object({ path: z.string().describe('文件或目录（相对工作目录）') })
const DiagArgs = z.object({ path: z.string().describe('TS / JS 文件（相对工作目录）') })

export class UnsupportedFileError extends Error {
  constructor(path: string) {
    super(`${path} 不是 TS / JS 文件，code.* 只支持 .ts .tsx .js .jsx .mts .cts .mjs .cjs。其它语言用 fs.grep 搜。`)
    this.name = 'unsupported'
  }
}

export function makeOutlineTool(): Tool<
  z.infer<typeof OutlineArgs>,
  { outline: string; files: number; truncated?: string }
> {
  return {
    name: 'code.outline',
    capability: 'fs.read',
    description:
      '看 TS / JS 文件或目录的骨架：导出的函数、类、类型及其签名（不含函数体）。陌生代码先用它，再按需 fs.read。',
    schema: OutlineArgs,
    async execute(args, ctx) {
      const root = resolveWithinRoot(ctx.cwd, '.')
      const abs = resolveWithinRoot(ctx.cwd, args.path)
      const isDir = statSync(abs).isDirectory()
      let targets: string[]
      if (isDir) {
        targets = listFiles(root, abs)
          .files.filter((f) => isSupported(f) && !/\.d\.[mc]?ts$/.test(f))
          .map((f) => join(root, f))
      } else {
        if (!isSupported(abs)) throw new UnsupportedFileError(args.path)
        targets = [abs]
      }
      if (targets.length === 0) throw new UnsupportedFileError(args.path)
      const ts = await loadTypeScript(root)
      const parts: string[] = []
      let used = 0
      let shown = 0
      let truncated: string | undefined
      for (const f of targets) {
        if (shown >= OUTLINE_MAX_FILES) {
          truncated = `目录下有 ${targets.length} 个文件，只列了前 ${OUTLINE_MAX_FILES} 个。给更具体的子目录。`
          break
        }
        const block = formatOutline(relative(root, f), outlineFile(ts, f))
        if (used + block.length > OUTLINE_MAX_CHARS) {
          truncated = `提纲超过 ${OUTLINE_MAX_CHARS} 字符，只列了前 ${shown} 个文件（共 ${targets.length} 个）。给更具体的子目录或文件。`
          break
        }
        parts.push(block)
        used += block.length
        shown++
      }
      return { outline: parts.join('\n\n'), files: shown, ...(truncated === undefined ? {} : { truncated }) }
    },
  }
}

export function makeDiagnosticsTool(
  service: DiagnosticsService,
): Tool<z.infer<typeof DiagArgs>, { diagnostics: Diagnostic[]; total: number; tsconfig: string | null; ms: number }> {
  return {
    name: 'code.diagnostics',
    capability: 'fs.read',
    description:
      '对一个 TS / JS 文件做类型检查，返回错误的位置与信息。改完文件后用它快速确认，比跑完整的 tsc 快；最终仍按项目的验证命令确认。',
    schema: DiagArgs,
    async execute(args, ctx) {
      const root = resolveWithinRoot(ctx.cwd, '.')
      const abs = resolveWithinRoot(ctx.cwd, args.path)
      if (!isSupported(abs) || statSync(abs).isDirectory()) throw new UnsupportedFileError(args.path)
      const t0 = performance.now()
      const r = await service.check(abs)
      return {
        ...r,
        diagnostics: r.diagnostics.map((d) => ({ ...d, file: relative(root, d.file) || d.file })),
        tsconfig: r.tsconfig === null ? null : relative(root, r.tsconfig) || r.tsconfig,
        ms: Math.round(performance.now() - t0),
      }
    },
  }
}
