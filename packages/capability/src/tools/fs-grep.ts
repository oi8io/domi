/**
 * fs.grep —— PRD-M7-001 AC-3 · ADR-024
 *
 * 装了 ripgrep 就用它（快、语义成熟）；没装就用 TS 逐行正则（慢但能用）。
 * 两个后端返回同一个结构，模型不需要知道用的是哪个。
 */
import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { resolveWithinRoot } from '../paths.ts'
import type { Tool } from '../types.ts'
import { listFiles } from './file-list.ts'

export const GREP_DEFAULT_LIMIT = 100
/** 内置后端跳过的大文件 */
const BUILTIN_MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LINE_CHARS = 400

export const FsGrepArgs = z.object({
  pattern: z.string().describe('正则表达式（Rust / JS 正则的公共子集）'),
  path: z.string().optional().describe('在哪个子目录或文件里找，默认工作目录'),
  glob: z.string().optional().describe('只看匹配这个 glob 的文件，例如 *.ts'),
  ignoreCase: z.boolean().optional(),
  context: z.number().int().min(0).max(10).optional().describe('每处匹配前后各带几行'),
  limit: z.number().int().positive().max(1000).optional(),
})
export type FsGrepArgs = z.infer<typeof FsGrepArgs>

export interface GrepMatch {
  path: string
  line: number
  text: string
  before?: string[]
  after?: string[]
}

export interface FsGrepResult {
  matches: GrepMatch[]
  total: number
  backend: 'rg' | 'builtin'
  truncated?: { shown: number; total: number; hint: string }
}

/** 这台机器上用哪个后端（doctor 显示） */
export function grepBackend(): { backend: 'rg' | 'builtin'; path: string | null } {
  // DOMI_GREP_BACKEND=builtin：强制用内置实现（测试两个后端、或 rg 行为异常时临时绕开）
  const p = process.env.DOMI_GREP_BACKEND === 'builtin' ? null : Bun.which('rg')
  return p ? { backend: 'rg', path: p } : { backend: 'builtin', path: null }
}

function clip(s: string): string {
  return s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…` : s
}

function isBinary(abs: string): boolean {
  const fd = openSync(abs, 'r')
  try {
    const buf = Buffer.alloc(8000)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).includes(0)
  } finally {
    closeSync(fd)
  }
}

function builtinGrep(root: string, dir: string, args: FsGrepArgs, limit: number): FsGrepResult {
  let re: RegExp
  try {
    re = new RegExp(args.pattern, args.ignoreCase ? 'i' : '')
  } catch (e) {
    throw new Error(`正则写得不对：${e instanceof Error ? e.message : String(e)}`)
  }
  const glob = args.glob ? new Bun.Glob(args.glob) : null
  const ctxN = args.context ?? 0
  const isFile = statSync(dir).isFile()
  const files = isFile ? [relative(root, dir).split('\\').join('/')] : listFiles(root, dir).files
  const matches: GrepMatch[] = []
  let total = 0
  for (const f of files) {
    if (glob && !glob.match(f) && !glob.match(f.split('/').pop() ?? f)) continue
    const abs = join(root, f)
    let text: string
    try {
      if (statSync(abs).size > BUILTIN_MAX_FILE_BYTES || isBinary(abs)) continue
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    if (text.endsWith('\n')) lines.pop()
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i] as string)) continue
      total++
      if (matches.length >= limit) continue
      const m: GrepMatch = { path: f, line: i + 1, text: clip(lines[i] as string) }
      if (ctxN > 0) {
        m.before = lines.slice(Math.max(0, i - ctxN), i).map(clip)
        m.after = lines.slice(i + 1, i + 1 + ctxN).map(clip)
      }
      matches.push(m)
    }
  }
  return { matches, total, backend: 'builtin' }
}

function rgGrep(rg: string, root: string, dir: string, args: FsGrepArgs, limit: number, signal: AbortSignal) {
  const argv = ['--json', '--line-number']
  if (args.ignoreCase) argv.push('-i')
  if (args.context) argv.push('-C', String(args.context))
  if (args.glob) argv.push('--glob', args.glob)
  argv.push('--', args.pattern, relative(root, dir) || '.')
  return new Promise<FsGrepResult>((resolve, reject) => {
    const child = spawn(rg, argv, { cwd: root, signal })
    const matches: GrepMatch[] = []
    let total = 0
    let pendingBefore: string[] = []
    let last: GrepMatch | null = null
    let buf = ''
    let err = ''
    const onLine = (line: string): void => {
      if (line === '') return
      let msg: { type: string; data: Record<string, unknown> }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      const d = msg.data as {
        path?: { text?: string }
        line_number?: number
        lines?: { text?: string }
      }
      const text = clip((d.lines?.text ?? '').replace(/\r?\n$/, ''))
      if (msg.type === 'begin') {
        pendingBefore = []
        last = null
      } else if (msg.type === 'match') {
        total++
        if (matches.length >= limit) {
          last = null
          return
        }
        const m: GrepMatch = { path: (d.path?.text ?? '').replace(/^\.\//, ''), line: d.line_number ?? 0, text }
        if (args.context) {
          m.before = pendingBefore
          m.after = []
        }
        pendingBefore = []
        matches.push(m)
        last = m
      } else if (msg.type === 'context') {
        // 同一行可能既是上一处的 after、又是下一处的 before（两处匹配挨得近时）
        if (last?.after && last.after.length < (args.context ?? 0) && (d.line_number ?? 0) > last.line) {
          last.after.push(text)
        }
        pendingBefore.push(text)
        if (pendingBefore.length > (args.context ?? 0)) pendingBefore.shift()
      }
    }
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString('utf8')
      let i = buf.indexOf('\n')
      while (i !== -1) {
        onLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
        i = buf.indexOf('\n')
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      onLine(buf)
      // rg：0 = 有匹配，1 = 没有匹配，2 = 出错
      if (code === 2) reject(new Error(`ripgrep 出错：${err.trim().slice(0, 500)}`))
      else resolve({ matches, total, backend: 'rg' })
    })
  })
}

export const fsGrep: Tool<FsGrepArgs, FsGrepResult> = {
  name: 'fs.grep',
  capability: 'fs.read',
  description:
    '在工作目录内按正则搜索文件内容（遵守 .gitignore），返回 路径:行号 与该行内容；可带上下文行。找代码时优先用它，不要用 shell 拼 grep。',
  schema: FsGrepArgs,
  async execute(args, ctx) {
    const root = resolveWithinRoot(ctx.cwd, '.')
    const dir = resolveWithinRoot(ctx.cwd, args.path ?? '.')
    const limit = args.limit ?? GREP_DEFAULT_LIMIT
    const { path: rg } = grepBackend()
    const r = rg ? await rgGrep(rg, root, dir, args, limit, ctx.signal) : builtinGrep(root, dir, args, limit)
    return r.total > r.matches.length
      ? {
          ...r,
          truncated: {
            shown: r.matches.length,
            total: r.total,
            hint: `共 ${r.total} 处，只返回了前 ${r.matches.length} 处。用更具体的 pattern、path 或 glob 收窄。`,
          },
        }
      : r
  },
}
