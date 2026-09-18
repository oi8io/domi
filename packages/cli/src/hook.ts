/**
 * 随包附带的两个示例钩子 —— PRD-M7-003 AC-6
 *
 * 在 config.yaml 里这样引用（run 是 sh -c 执行的命令）：
 *   hooks:
 *     - { name: commit-msg, on: pre, match: shell.exec, run: "domi hook commit-msg" }
 *     - { name: secrets,    on: pre, match: shell.exec, run: "domi hook secrets" }
 *
 * 钩子从环境变量拿到这次调用（DOMI_CMD 等），退出码非 0 = 拦下，输出就是给模型的理由。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tr } from '@domi/i18n'
import { CREDENTIAL_PATTERNS } from '@domi/store'
import type { Io } from './io.ts'

/** 提交信息里默认不许出现的行（AI 署名、会话链接） */
export const DEFAULT_FORBIDDEN_TRAILERS = [
  /^\s*co-authored-by:/im,
  /^\s*claude-session:/im,
  /generated with \[?claude/im,
]

const GIT_COMMIT = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+commit\b/

/** 从命令里找 `-F <文件>` / `--file=<文件>` 指向的提交信息文件 */
function messageFiles(cmd: string, cwd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/(?:\s-F\s+|\s--file[=\s])(['"]?)([^\s'"]+)\1/g)) {
    const p = m[2] as string
    if (p === '-') continue
    out.push(isAbsolute(p) ? p : join(cwd, p))
  }
  return out
}

/**
 * 命令行里 `-m` / `--message` 给的每一段（BUG-M7-002）。规则按「行首」匹配，
 * 而 `git commit -m "x" -m "Co-Authored-By: y"` 里署名在命令的行中间——不把每段单独拿出来就漏了
 */
function inlineMessages(cmd: string): string[] {
  const out: string[] = []
  const re = /(?:^|\s)(?:-m|--message)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s'"]+)/g
  for (const m of cmd.matchAll(re)) {
    const v = m[1] as string
    if (v.startsWith('"')) out.push(v.slice(1, -1).replace(/\\(["\\$`])/g, '$1'))
    else if (v.startsWith("'")) out.push(v.slice(1, -1))
    else out.push(v)
  }
  return out
}

export function checkCommitMessage(
  cmd: string,
  cwd: string,
  extra: readonly RegExp[] = [],
): { ok: true } | { ok: false; reason: string } {
  if (!GIT_COMMIT.test(cmd)) return { ok: true }
  const texts = [
    cmd,
    ...inlineMessages(cmd),
    ...messageFiles(cmd, cwd)
      .filter(existsSync)
      .map((f) => readFileSync(f, 'utf8')),
  ]
  for (const re of [...DEFAULT_FORBIDDEN_TRAILERS, ...extra]) {
    for (const t of texts) {
      const m = t.match(re)
      if (m) {
        return {
          ok: false,
          reason: tr('cli.hook.commitMsg', { trim: m[0].trim() }),
        }
      }
    }
  }
  return { ok: true }
}

export function scanStaged(cwd: string): { ok: true } | { ok: false; reason: string } {
  const diff = spawnSync('git', ['diff', '--cached', '-U0', '--no-color'], { cwd, encoding: 'utf8' })
  if (diff.status !== 0) return { ok: true } // 不是 git 仓库，或 git 不可用：不拦
  let file = ''
  const hits: string[] = []
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6)
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const re of CREDENTIAL_PATTERNS) {
      const m = line.match(new RegExp(re.source, re.flags.replace('g', '')))
      if (m) hits.push(tr('cli.hook.secretHit', { file, slice: m[0].slice(0, 8) }))
    }
  }
  if (hits.length === 0) return { ok: true }
  const unique = [...new Set(hits)]
  return {
    ok: false,
    reason: tr('cli.hook.secrets', {
      join: unique
        .slice(0, 10)
        .map((h) => `  ${h}`)
        .join('\n'),
    }),
  }
}

export function runHook(name: string | undefined, args: readonly string[], io: Io): number {
  const cmd = process.env.DOMI_CMD ?? ''
  const cwd = process.env.DOMI_CWD ?? process.cwd()
  if (name === 'commit-msg') {
    const extra = args.map((a) => new RegExp(a, 'im'))
    const r = checkCommitMessage(cmd, cwd, extra)
    if (r.ok) return 0
    io.err(r.reason)
    return 1
  }
  if (name === 'secrets') {
    if (!GIT_COMMIT.test(cmd)) return 0
    const r = scanStaged(cwd)
    if (r.ok) return 0
    io.err(r.reason)
    return 1
  }
  io.err(tr('cli.hook.usage'))
  return 2
}
