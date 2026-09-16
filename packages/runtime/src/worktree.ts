/**
 * 隔离工作区 —— PRD-M7-006 · SPEC-M7-006 · ADR-026
 *
 * 一个隔离会话 = 一个 git worktree + 分支 `domi/<会话>`，放在 ~/.domi/worktrees/<仓库哈希>/<会话>。
 * 用户的工作区一个字节不动；带回原仓库要人批准。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export interface WorktreeInfo {
  /** 原仓库根 */
  repo: string
  /** worktree 目录 */
  path: string
  branch: string
  /** 创建时的 HEAD */
  base: string
}

export interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  patch: string
  /** patch 太大被截断了 */
  truncated?: boolean
}

const PATCH_MAX = 200_000
/** 没配置 git 身份时用这个提交（worktree 里的中间提交） */
const FALLBACK_IDENTITY = ['-c', 'user.name=domi', '-c', 'user.email=domi@localhost']

function git(cwd: string, args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  })
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '').trim() || (r.error ? String(r.error) : '') }
}

function must(cwd: string, args: string[], what: string): string {
  const r = git(cwd, args)
  if (!r.ok) throw new WorktreeError(`${what}失败：${r.err || `git ${args.join(' ')}`}`)
  return r.out.trim()
}

export function repoHash(repo: string): string {
  return createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12)
}

export function worktreesRoot(domiHome: string): string {
  return join(domiHome, 'worktrees')
}

function hasIdentity(cwd: string): boolean {
  return git(cwd, ['config', 'user.email']).ok && git(cwd, ['config', 'user.name']).ok
}

/**
 * 在 cwd 所在的仓库里建隔离工作区。cwd 是仓库里的子目录时，返回的 cwd 也落在 worktree 的同一个子目录
 */
export function createWorktree(cwd: string, sessionId: string, domiHome: string): { info: WorktreeInfo; cwd: string } {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) throw new WorktreeError(`${cwd} 不在 git 仓库里，没法隔离。可以不隔离直接开会话（改动仍有步级快照保护）`)
  const repo = top.out.trim()
  const head = git(repo, ['rev-parse', 'HEAD'])
  if (!head.ok) throw new WorktreeError(`${repo} 还没有任何提交，没法从 HEAD 建隔离工作区。先提交一次再试`)
  const base = head.out.trim()
  const path = join(worktreesRoot(domiHome), repoHash(repo), sessionId)
  const branch = `domi/${sessionId}`
  mkdirSync(dirname(path), { recursive: true })
  must(repo, ['worktree', 'add', '-b', branch, path, base], '建隔离工作区')
  const rel = relative(repo, resolve(cwd))
  return { info: { repo, path, branch, base }, cwd: rel === '' || rel.startsWith('..') ? path : join(path, rel) }
}

/** worktree 目录没了（会话被删过又恢复）：按分支重新挂上 */
export function ensureWorktree(info: WorktreeInfo): void {
  if (existsSync(info.path)) return
  git(info.repo, ['worktree', 'prune'])
  mkdirSync(dirname(info.path), { recursive: true })
  must(info.repo, ['worktree', 'add', info.path, info.branch], '重新挂上隔离工作区')
}

/** 相对 base 的全部改动（含未跟踪文件与 worktree 里已经提交的） */
export function worktreeDiff(info: WorktreeInfo): FileChange[] {
  const out: FileChange[] = []
  const tracked = must(info.path, ['diff', '--name-status', '-z', '--no-renames', info.base, '--'], '读改动')
  const parts = tracked.split('\0').filter((x) => x !== '')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i] as string
    const file = parts[i + 1] as string
    const status = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified'
    const patch = git(info.path, ['diff', '--no-color', info.base, '--', file]).out
    out.push(clipPatch({ path: file, status, patch }))
  }
  const untracked = git(info.path, ['ls-files', '--others', '--exclude-standard', '-z']).out
  for (const file of untracked.split('\0').filter((x) => x !== '')) {
    // --no-index 在有差异时退出码是 1，不算失败
    const patch = git(info.path, ['diff', '--no-color', '--no-index', '--', '/dev/null', file]).out
    out.push(clipPatch({ path: file, status: 'added', patch }))
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function clipPatch(c: FileChange): FileChange {
  return c.patch.length > PATCH_MAX ? { ...c, patch: c.patch.slice(0, PATCH_MAX), truncated: true } : c
}

function safeRel(info: WorktreeInfo, file: string): string {
  const abs = resolve(info.path, file)
  const rel = relative(info.path, abs)
  if (rel === '' || rel.startsWith('..') || rel.split(/[\\/]/)[0] === '.git') {
    throw new WorktreeError(`路径不在隔离工作区里：${file}`)
  }
  return rel
}

function trashDir(domiHome: string, info: WorktreeInfo): string {
  return join(worktreesRoot(domiHome), '.trash', repoHash(info.repo), info.branch.replace(/\//g, '_'))
}

/** 丢弃一个文件的改动（恢复成 base）。先把现在的内容存进回收站，返回回收站编号，可以撤销 */
export function discardFile(info: WorktreeInfo, file: string, domiHome: string): string {
  const rel = safeRel(info, file)
  const abs = join(info.path, rel)
  const dir = trashDir(domiHome, info)
  mkdirSync(dir, { recursive: true })
  const id = String(readdirSync(dir).filter((x) => /^\d+$/.test(x)).length + 1)
  const slot = join(dir, id)
  mkdirSync(slot, { recursive: true })
  const existed = existsSync(abs) && statSync(abs).isFile()
  if (existed) copyFileSync(abs, join(slot, 'content'))
  writeFileSync(join(slot, 'meta.json'), JSON.stringify({ path: rel, existed }))
  const inBase = git(info.path, ['cat-file', '-e', `${info.base}:${rel}`]).ok
  if (inBase) {
    must(info.path, ['restore', `--source=${info.base}`, '--staged', '--worktree', '--', rel], '恢复文件')
  } else {
    git(info.path, ['rm', '--cached', '-q', '--ignore-unmatch', '--', rel])
    if (existsSync(abs)) rmSync(abs)
  }
  return id
}

/** 撤销一次丢弃 */
export function restoreDiscard(info: WorktreeInfo, trash: string, domiHome: string): string {
  if (!/^\d+$/.test(trash)) throw new WorktreeError(`回收站编号不对：${trash}`)
  const slot = join(trashDir(domiHome, info), trash)
  if (!existsSync(join(slot, 'meta.json'))) throw new WorktreeError(`回收站里没有 ${trash}`)
  const meta = JSON.parse(readFileSync(join(slot, 'meta.json'), 'utf8')) as { path: string; existed: boolean }
  const rel = safeRel(info, meta.path)
  const abs = join(info.path, rel)
  if (meta.existed) {
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(join(slot, 'content'), abs)
  } else if (existsSync(abs)) {
    rmSync(abs)
  }
  return rel
}

export function isDirty(path: string): boolean {
  const r = git(path, ['status', '--porcelain'])
  return r.ok && r.out.trim() !== ''
}

/** 把 worktree 里没提交的改动提交到分支上。没有改动时返回 null */
function commitPending(info: WorktreeInfo, message: string): string | null {
  if (!isDirty(info.path)) return null
  must(info.path, ['add', '-A'], '暂存改动')
  const id = hasIdentity(info.path) ? [] : FALLBACK_IDENTITY
  must(info.path, [...id, 'commit', '-q', '-m', message], '提交隔离工作区的改动')
  return must(info.path, ['rev-parse', 'HEAD'], '读提交')
}

export type ApplyMode = 'squash' | 'merge' | 'branch'

export interface ApplyResult {
  ok: boolean
  commit?: string
  message: string
}

/**
 * 把改动带回原仓库。原仓库里改动涉及的文件有未提交的修改 → 拒绝（不做冲突处理，SPEC 取舍-8）
 */
export function applyWorktree(info: WorktreeInfo, mode: ApplyMode, message: string): ApplyResult {
  commitPending(info, message)
  const tip = must(info.path, ['rev-parse', 'HEAD'], '读分支')
  if (tip === info.base) return { ok: false, message: '隔离工作区里没有任何改动，没什么可带回的' }
  if (mode === 'branch') {
    return { ok: true, commit: tip, message: `改动留在分支 ${info.branch} 上（${tip.slice(0, 8)}），原仓库没有动` }
  }
  const touched = new Set(
    must(info.repo, ['diff', '--name-only', '-z', info.base, info.branch], '读改动清单')
      .split('\0')
      .filter((x) => x !== ''),
  )
  const dirty = git(info.repo, ['status', '--porcelain', '-z'])
    .out.split('\0')
    .filter((x) => x.length > 3)
    .map((x) => x.slice(3))
  const clash = dirty.filter((f) => touched.has(f))
  if (clash.length > 0) {
    return {
      ok: false,
      message: `原仓库里这些文件有没提交的修改，和隔离工作区的改动重叠，先处理掉再带回：${clash.slice(0, 10).join('、')}`,
    }
  }
  const id = hasIdentity(info.repo) ? [] : FALLBACK_IDENTITY
  if (mode === 'squash') {
    const m = git(info.repo, ['merge', '--squash', info.branch])
    if (!m.ok) {
      git(info.repo, ['reset', '--merge'])
      return { ok: false, message: `合并时有冲突，原仓库已恢复原样：${m.err || m.out}`.slice(0, 2000) }
    }
    const staged = git(info.repo, ['diff', '--cached', '--quiet'])
    if (staged.ok) return { ok: false, message: '原仓库里已经有这些改动了，没有要提交的' }
    const c = git(info.repo, [...id, 'commit', '-q', '-m', message])
    if (!c.ok) {
      git(info.repo, ['reset', '--merge'])
      return { ok: false, message: `提交失败，原仓库已恢复原样：${c.err}`.slice(0, 2000) }
    }
  } else {
    const m = git(info.repo, [...id, 'merge', '--no-ff', '-m', message, info.branch])
    if (!m.ok) {
      git(info.repo, ['merge', '--abort'])
      return { ok: false, message: `合并时有冲突，原仓库已恢复原样：${m.err || m.out}`.slice(0, 2000) }
    }
  }
  const commit = must(info.repo, ['rev-parse', 'HEAD'], '读提交')
  return {
    ok: true,
    commit,
    message: `已${mode === 'squash' ? '压成一个提交' : '合并'}带回原仓库（${commit.slice(0, 8)}）`,
  }
}

/** 删会话时清理：有没提交的改动就拒绝；删目录不删分支 */
export function removeWorktree(info: WorktreeInfo): void {
  if (!existsSync(info.path)) return
  if (isDirty(info.path)) {
    throw new WorktreeError(
      `隔离工作区 ${info.path} 里还有没提交的改动。先带回原仓库（或只留分支）、或者逐个丢弃，再删会话`,
    )
  }
  must(info.repo, ['worktree', 'remove', info.path], '清理隔离工作区')
}

/** 从事件流里找这个会话的 worktree */
export function worktreeFromEvents(events: readonly { ev: { t: string } }[]): WorktreeInfo | null {
  for (const { ev } of events) {
    if (ev.t === 'worktree.create') {
      const e = ev as unknown as WorktreeInfo
      return { repo: e.repo, path: e.path, branch: e.branch, base: e.base }
    }
  }
  return null
}
