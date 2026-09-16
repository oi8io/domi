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

/** 超过这个大小就不返回全文，只给结构化提示（PRD-M0-004 AC-1） */
export const FS_READ_MAX_BYTES = 1024 * 1024
const DEFAULT_HEAD_LINES = 200

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
  truncated?: { totalBytes: number; reason: 'file_too_large'; hint: string }
}

export const fsRead: Tool<FsReadArgs, FsReadResult> = {
  name: 'fs.read',
  capability: 'fs.read',
  description: '读取工作目录内的文件，支持行范围。超过 1MB 的文件只返回片段与总行数。',
  schema: FsReadArgs,
  async execute(args, ctx) {
    const abs = resolveReadable(ctx, args.path)
    const size = statSync(abs).size
    const raw = readFileSync(abs, 'utf8')
    ctx.stamps?.record(abs, raw)
    const lines = raw.split('\n')
    const total = lines.length

    const tooBig = size > FS_READ_MAX_BYTES
    const from = args.fromLine ?? 1
    const to = args.toLine ?? (tooBig ? Math.min(total, from + DEFAULT_HEAD_LINES - 1) : total)
    const slice = lines.slice(from - 1, to)

    const base: FsReadResult = {
      path: args.path,
      totalLines: total,
      returnedRange: { from, to: Math.min(to, total) },
      content: slice.join('\n'),
    }
    if (!tooBig) return base
    return {
      ...base,
      truncated: {
        totalBytes: size,
        reason: 'file_too_large',
        hint: `文件 ${size} 字节，超过 ${FS_READ_MAX_BYTES}。已返回第 ${from}–${base.returnedRange.to} 行，共 ${total} 行；用 fromLine/toLine 继续读。`,
      },
    }
  },
}
