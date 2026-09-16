/**
 * fs.edit —— PRD-M7-001 AC-1 · ADR-024
 *
 * 精确替换：old 必须恰好出现一次（replaceAll 时至少一次）。
 * 找不到 / 有好几处都**拒绝并说清楚在哪**，而不是猜一个——猜错的编辑比失败的编辑难发现得多。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { resolveWithinRoot } from '../paths.ts'
import type { Tool } from '../types.ts'
import { NotReadError, sha256 } from './stamps.ts'

export const FsEditArgs = z.object({
  path: z.string(),
  old: z.string().min(1).describe('要被替换的原文，必须与文件内容逐字一致（含缩进）'),
  new: z.string().describe('替换成的内容'),
  replaceAll: z.boolean().optional().describe('替换全部出现处；默认只允许恰好出现一次'),
})
export type FsEditArgs = z.infer<typeof FsEditArgs>

export interface FsEditResult {
  path: string
  replaced: number
  sha256: string
}

export class EditMatchError extends Error {
  constructor(
    name: 'not_found' | 'ambiguous',
    message: string,
    readonly lines: number[],
  ) {
    super(message)
    this.name = name
  }
}

/** 所有出现位置的起始行号（1 起） */
export function occurrenceLines(text: string, needle: string): number[] {
  const out: number[] = []
  let from = 0
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i === -1) return out
    out.push(text.slice(0, i).split('\n').length)
    from = i + needle.length
  }
}

/** old 没找到时，给出和 old 第一行最像的几行，帮模型定位（多半是缩进或空白不一致） */
export function nearestLines(text: string, old: string, n = 3): Array<{ line: number; text: string }> {
  const probe = (old.split('\n').find((l) => l.trim() !== '') ?? old).trim()
  if (probe === '') return []
  const words = new Set(probe.split(/\W+/).filter((w) => w.length > 1))
  const scored = text.split('\n').map((l, i) => {
    const t = l.trim()
    if (t === probe) return { line: i + 1, text: l, score: 1000 }
    let s = 0
    for (const w of t.split(/\W+/)) if (words.has(w)) s++
    return { line: i + 1, text: l, score: s }
  })
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, n)
    .map(({ line, text: t }) => ({ line, text: t.length > 200 ? `${t.slice(0, 200)}…` : t }))
}

export const fsEdit: Tool<FsEditArgs, FsEditResult> = {
  name: 'fs.edit',
  capability: 'fs.write',
  description:
    '修改工作目录内的已有文件：把 old 替换成 new。old 必须与文件内容逐字一致且只出现一次（replaceAll 时替换全部）。' +
    '改之前要先用 fs.read 读过这个文件。只改一小段时用它，不要用 fs.write 重写整个文件。',
  schema: FsEditArgs,
  async execute(args, ctx) {
    const abs = resolveWithinRoot(ctx.cwd, args.path)
    if (!existsSync(abs)) throw new Error(`${args.path} 不存在。新建文件用 fs.write。`)
    if (ctx.stamps && !ctx.stamps.has(abs)) throw new NotReadError(args.path)
    const before = readFileSync(abs, 'utf8')
    ctx.stamps?.check(abs, before, args.path)

    const lines = occurrenceLines(before, args.old)
    if (lines.length === 0) {
      const near = nearestLines(before, args.old)
      const hint =
        near.length === 0 ? '' : `\n最接近的几行：\n${near.map((x) => `  第 ${x.line} 行：${x.text}`).join('\n')}`
      throw new EditMatchError(
        'not_found',
        `在 ${args.path} 里没找到 old 的内容（要逐字一致，包括缩进与空白）。${hint}`,
        near.map((x) => x.line),
      )
    }
    if (lines.length > 1 && !args.replaceAll) {
      throw new EditMatchError(
        'ambiguous',
        `old 在 ${args.path} 里出现了 ${lines.length} 次（第 ${lines.join('、')} 行）。多带几行上下文让它唯一，或者设 replaceAll: true。`,
        lines,
      )
    }

    const after = args.replaceAll ? before.split(args.old).join(args.new) : before.replace(args.old, () => args.new)
    ctx.emit({
      t: 'fs.snapshot',
      path: args.path,
      phase: 'before',
      sha256: sha256(before),
      bytes: Buffer.byteLength(before, 'utf8'),
    })
    writeFileSync(abs, after, 'utf8')
    const digest = sha256(after)
    ctx.stamps?.record(abs, after)
    ctx.emit({
      t: 'fs.snapshot',
      path: args.path,
      phase: 'after',
      sha256: digest,
      bytes: Buffer.byteLength(after, 'utf8'),
    })
    return { path: args.path, replaced: lines.length, sha256: digest }
  },
}
