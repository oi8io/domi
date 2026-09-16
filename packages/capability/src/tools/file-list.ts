/**
 * 文件清单 —— SPEC-M7-001 · ADR-024
 *
 * git 仓库里用 `git ls-files -co --exclude-standard`：和用户自己的 git 看到的一模一样
 * （嵌套 .gitignore、全局 excludes 都对）。不是 git 仓库时退回内置排除表。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 非 git 目录时跳过的目录（与步级快照的排除表同一思路，外加 .git 本身） */
export const LIST_EXCLUDES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  'target',
  '.turbo',
  'coverage',
])

/** 一次最多列多少个文件：再多就是在扫错目录了 */
export const LIST_HARD_CAP = 200_000

export interface FileListing {
  /** 相对 `root` 的路径，统一用 / 分隔 */
  files: string[]
  source: 'git' | 'walk'
}

/**
 * 列出 root 下（或其子目录 dir 下）的文件。dir 必须已经过路径收口。
 * 返回的路径相对 root。
 */
export function listFiles(root: string, dir: string = root): FileListing {
  const git = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', '.'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (git.status === 0 && typeof git.stdout === 'string') {
    const prefix = relative(root, dir)
    const files = git.stdout
      .split('\0')
      .filter((f) => f !== '')
      .slice(0, LIST_HARD_CAP)
      .map((f) => toPosix(prefix === '' ? f : join(prefix, f)))
    return { files, source: 'git' }
  }
  const files: string[] = []
  const walk = (d: string): void => {
    if (files.length >= LIST_HARD_CAP) return
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries.sort()) {
      if (LIST_EXCLUDES.has(e)) continue
      const p = join(d, e)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (st.isFile()) files.push(toPosix(relative(root, p)))
      if (files.length >= LIST_HARD_CAP) return
    }
  }
  walk(dir)
  return { files, source: 'walk' }
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}
