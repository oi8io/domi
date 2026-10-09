import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { z } from 'zod'
import { PathEscapeError, resolveWithinRoot } from '../paths.ts'
import type { Tool, ToolCtx } from '../types.ts'

/**
 * 读路径：工作目录内，或本会话的输出落盘目录（SPEC-M7-001：被截断的命令输出全文在那里）。
 * 只有读放行这个目录，写不放行
 */
export function resolveReadable(ctx: Pick<ToolCtx, 'cwd' | 'outputDir'>, p: string): string {
  try {
    return resolveWithinRoot(ctx.cwd, p)
  } catch (e) {
    if (!(e instanceof PathEscapeError) || !ctx.outputDir || !isAbsolute(p)) throw e
    const rel = relative(ctx.outputDir, p)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw e
    return resolveWithinRoot(ctx.outputDir, p)
  }
}

/**
 * 不带行范围时默认最多返回这么多行（PRD-M15-007 AC-2）。
 * 超过时给「共几行、用 fromLine/toLine 继续」——不再整篇 1MB 返回
 */
export const FS_READ_DEFAULT_MAX_LINES = 2000

export const FsReadArgs = z.object({
  path: z.string(),
  fromLine: z.number().int().positive().optional(),
  toLine: z.number().int().positive().optional(),
})
export type FsReadArgs = z.infer<typeof FsReadArgs>

export interface FsReadResult {
  path: string
  totalLines: number
  returnedRange: { from: number; to: number }
  content: string
  /** 只有被截断时才出现。给模型一个明确的「还有更多」信号，而不是让它以为读完了 */
  truncated?: { totalBytes: number; reason: 'line_limit'; hint: string }
}

export const fsRead: Tool<FsReadArgs, FsReadResult> = {
  name: 'fs.read',
  capability: 'fs.read',
  description:
    '读取工作目录内的文件，支持行范围。不带行范围时默认最多返回 2000 行；大文件按范围读（fromLine/toLine）或先用 fs.grep。',
  schema: FsReadArgs,
  async execute(args, ctx) {
    const abs = resolveReadable(ctx, args.path)
    const size = statSync(abs).size
    const raw = readFileSync(abs, 'utf8')
    ctx.stamps?.record(abs, raw)
    const lines = raw.split('\n')
    const total = lines.length

    // PRD-M15-007 AC-2：不带行范围默认最多 2000 行；带范围精确返回（按范围读大文件正是工作方法）
    const hasRange = args.fromLine !== undefined || args.toLine !== undefined
    const from = args.fromLine ?? 1
    const to = args.toLine ?? (hasRange ? total : Math.min(total, FS_READ_DEFAULT_MAX_LINES))
    const slice = lines.slice(from - 1, to)

    const base: FsReadResult = {
      path: args.path,
      totalLines: total,
      returnedRange: { from, to: Math.min(to, total) },
      content: slice.join('\n'),
    }
    // 带范围 = 用户明确只要这一段，永不标 truncated；不带范围没读全才提示继续
    if (hasRange || to >= total) return base
    return {
      ...base,
      truncated: {
        totalBytes: size,
        reason: 'line_limit',
        hint: `文件共 ${total} 行。已返回第 ${from}–${base.returnedRange.to} 行；用 fromLine/toLine 继续读。`,
      },
    }
  },
}
