import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import { resolveWithinRoot } from '../paths.ts'
import type { Tool } from '../types.ts'

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
    const abs = resolveWithinRoot(ctx.cwd, args.path)
    const size = statSync(abs).size
    const lines = readFileSync(abs, 'utf8').split('\n')
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
