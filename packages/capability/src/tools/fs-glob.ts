/**
 * fs.glob —— PRD-M7-001 AC-3
 * 按 glob 找文件。遵守 .gitignore（file-list.ts），结果有上限，超了标注截断与总数。
 */
import { relative } from 'node:path'
import { z } from 'zod'
import { resolveWithinRoot } from '../paths.ts'
import type { Tool } from '../types.ts'
import { listFiles } from './file-list.ts'

export const GLOB_DEFAULT_LIMIT = 200

export const FsGlobArgs = z.object({
  pattern: z.string().describe('glob，例如 src/**/*.ts、**/*.test.*'),
  path: z.string().optional().describe('在哪个子目录里找，默认工作目录'),
  limit: z.number().int().positive().max(2000).optional(),
})
export type FsGlobArgs = z.infer<typeof FsGlobArgs>

export interface FsGlobResult {
  files: string[]
  total: number
  truncated?: { shown: number; total: number; hint: string }
}

export const fsGlob: Tool<FsGlobArgs, FsGlobResult> = {
  name: 'fs.glob',
  capability: 'fs.read',
  description: '按 glob 模式列出工作目录内的文件（遵守 .gitignore），返回相对工作目录的路径。',
  schema: FsGlobArgs,
  async execute(args, ctx) {
    const dir = resolveWithinRoot(ctx.cwd, args.path ?? '.')
    const root = resolveWithinRoot(ctx.cwd, '.')
    const base = relative(root, dir).split('\\').join('/')
    const glob = new Bun.Glob(args.pattern)
    const limit = args.limit ?? GLOB_DEFAULT_LIMIT
    const matched = listFiles(root, dir).files.filter((f) => {
      const rel = base === '' ? f : f.slice(base.length + 1)
      return glob.match(rel) || glob.match(f)
    })
    const files = matched.slice(0, limit)
    return matched.length > limit
      ? {
          files,
          total: matched.length,
          truncated: {
            shown: limit,
            total: matched.length,
            hint: `共 ${matched.length} 个，只列了前 ${limit} 个。把 pattern 或 path 收窄一些。`,
          },
        }
      : { files, total: matched.length }
  },
}
