/**
 * PRD-M15-010 AC-2 · 环境采集
 *
 * 定格一半（os/shell/项目根/项目类型/包管理器/git 远端）——会话开始采集一次，进冻结前缀（ctx.env）
 * 会变一半（日期/git 分支与改动文件数）——每轮采集，变化由 session 走 ctx.note 追加
 *
 * 后台作业：domi 目前没有后台作业机制，SPEC 提到的「后台作业」留待机制出现再接（取舍记录 docs/tasks/M15.md）。
 * 所有 IO 都带 fallback：git 不存在 / 无仓库 / 无锁文件时返回 null / unknown，绝不抛。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptEnv } from '@domi/prompt'

/** 项目根标记文件，按优先级找（向上逐级） */
const ROOT_MARKS = [
  'package.json',
  'pnpm-workspace.yaml',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'bun.lock',
] as const

const LOCK_TO_MANAGER: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['go.sum', 'go'],
  ['Cargo.lock', 'cargo'],
]

function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** 向上找项目根：有 ROOT_MARKS 的最近父目录；找不到返回 cwd 本身 */
export function findProjectRoot(cwd: string): string {
  let dir = cwd
  for (;;) {
    for (const mark of ROOT_MARKS) {
      if (existsSync(join(dir, mark))) return dir
    }
    const parent = dir.slice(0, Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\')))
    if (parent === dir) return cwd
    dir = parent
  }
}

function projectType(root: string): string {
  if (existsSync(join(root, 'go.mod'))) return 'go'
  if (existsSync(join(root, 'Cargo.toml'))) return 'rust'
  if (existsSync(join(root, 'pyproject.toml'))) return 'python'
  if (existsSync(join(root, 'package.json'))) return 'node'
  return 'unknown'
}

function pkgManager(root: string): string {
  for (const [lock, manager] of LOCK_TO_MANAGER) {
    if (existsSync(join(root, lock))) return manager
  }
  return 'unknown'
}

function shellName(): string {
  const shell = process.env.SHELL ?? ''
  if (shell === '') return 'unknown'
  const base = shell.split('/').pop() ?? shell
  return base === 'fish' || base === 'bash' || base === 'zsh' ? base : shell
}

/** 定格一半：会话开始采集一次 */
export function collectEnv(cwd: string): PromptEnv {
  const root = findProjectRoot(cwd)
  return {
    os: `${process.platform} ${process.arch}`,
    shell: shellName(),
    projectRoot: root,
    projectType: projectType(root),
    pkgManager: pkgManager(root),
    gitRemote: git(cwd, ['remote', 'get-url', 'origin']),
  }
}

/** 会变一半：每轮采集；由 session 与上次比较，不同才追加 */
export function collectEnvDynamic(cwd: string): { date: string; gitBranch: string | null; gitChanged: number | null } {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const porcelain = git(cwd, ['status', '--porcelain'])
  return {
    date,
    gitBranch: branch,
    gitChanged: porcelain === null ? null : porcelain === '' ? 0 : porcelain.split('\n').length,
  }
}

/** 会变一半的展示文本（ctx.note 用） */
export function envDynamicText(cwd: string): string {
  const d = collectEnvDynamic(cwd)
  const parts = [`日期 ${d.date}`]
  if (d.gitBranch !== null) parts.push(`分支 ${d.gitBranch}`)
  if (d.gitChanged !== null) parts.push(`改动文件 ${d.gitChanged}`)
  return `环境：${parts.join(' · ')}`
}
