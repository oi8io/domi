import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { resolveWithinRoot } from '../paths.ts'
import type { Tool } from '../types.ts'

export const FsWriteArgs = z.object({
  path: z.string(),
  content: z.string(),
})
export type FsWriteArgs = z.infer<typeof FsWriteArgs>

export interface FsWriteResult {
  path: string
  bytes: number
  sha256: string
  created: boolean
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export const fsWrite: Tool<FsWriteArgs, FsWriteResult> = {
  name: 'fs.write',
  capability: 'fs.write',
  description: '写入工作目录内的文件（整体覆盖）。写入前后各产生一条内容指纹事件。',
  schema: FsWriteArgs,
  async execute(args, ctx) {
    const abs = resolveWithinRoot(ctx.cwd, args.path)
    const existed = existsSync(abs)
    const before = existed ? readFileSync(abs, 'utf8') : null
    // 读过之后被外部改了 → 拒绝（PRD-M7-001 AC-2）。在任何事件与写入之前
    ctx.stamps?.check(abs, before, args.path)

    // 前后两条指纹事件是 PRD-M0-004 AC-2 的全部意义：据此可重建 diff。
    // before 为 null 表示文件原本不存在——这个区别在回滚时是关键的。
    ctx.emit({
      t: 'fs.snapshot',
      path: args.path,
      phase: 'before',
      sha256: before === null ? null : sha256(before),
      bytes: before === null ? 0 : Buffer.byteLength(before, 'utf8'),
    })

    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, args.content, 'utf8')
    const bytes = Buffer.byteLength(args.content, 'utf8')
    const digest = sha256(args.content)
    ctx.stamps?.record(abs, args.content)

    ctx.emit({ t: 'fs.snapshot', path: args.path, phase: 'after', sha256: digest, bytes })

    return { path: args.path, bytes, sha256: digest, created: !existed }
  },
}
