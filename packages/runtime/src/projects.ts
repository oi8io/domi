/**
 * 项目归属 —— PRD-M8-003 / 004 / 017 · SPEC-M8-003 · 取舍-2 / 3
 *
 * 规则只有两条：
 * 1. 一个目录属于「路径与它相同或是它祖先」的项目里最深的那个
 * 2. 都不是时，按「仓库根（向上找 .git）或这个目录本身」自动登记一个
 * 「像不像项目」只看 git 仓库与规矩文件，不读别的内容（远程客户端能触发这里）。
 */

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import type { ProjectRow, ProjectSettings, ProjectSummary, SqliteEventLog } from '@domi/store'
import { findRepoRoot, RULES_FILE_NAMES } from './project.ts'

export class ProjectError extends KeyedError {
  constructor(key: MessageKey, params?: Params) {
    super(key, params)
    this.name = 'ProjectError'
  }
}

/** realpath + 去掉末尾分隔符。目录不存在时抛 ProjectError */
export function normalizeDir(p: string): string {
  const abs = resolve(p.startsWith('~') ? join(homeOf(), p.slice(1)) : p)
  let real: string
  try {
    real = realpathSync(abs)
  } catch {
    throw new ProjectError('error.project.dirMissing', { path: p })
  }
  if (!statSync(real).isDirectory()) throw new ProjectError('error.project.notDir', { path: p })
  return real.length > 1 && real.endsWith(sep) ? real.slice(0, -1) : real
}

function homeOf(): string {
  // Bun 的 os.homedir() 不跟随运行期改动的 HOME（测试会改）
  return process.env.HOME ?? homedir()
}

function within(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** git 仓库（家目录本身是仓库的不算）或目录里有规矩文件 */
export function projectLikeRoot(dir: string): string | null {
  const home = (() => {
    try {
      return realpathSync(homeOf())
    } catch {
      return homeOf()
    }
  })()
  const repo = findRepoRoot(dir)
  if (existsSync(join(repo, '.git')) && repo !== home) return repo
  if (RULES_FILE_NAMES.some((n) => existsSync(join(dir, n)))) return dir
  return null
}

export interface ProjectServiceOptions {
  log: SqliteEventLog
  newId?: () => string
  now?: () => number
  /** ~/.domi：自由会话的沙盒在它下面 */
  home: string
}

export class ProjectService {
  private readonly newId: () => string
  private readonly now: () => number

  constructor(private readonly opts: ProjectServiceOptions) {
    this.newId = opts.newId ?? (() => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
    this.now = opts.now ?? Date.now
  }

  private get repo() {
    return this.opts.log.projects
  }

  list(opts: { includeArchived?: boolean; recent?: number } = {}): ProjectSummary[] {
    return this.repo.list(opts)
  }

  summary(id: string): ProjectSummary {
    const p = this.repo.list({ includeArchived: true, recent: 5 }).find((x) => x.id === id)
    if (!p) throw new ProjectError('error.project.notFound', { id })
    return p
  }

  get(id: string): ProjectRow {
    const p = this.repo.get(id)
    if (!p) throw new ProjectError('error.project.notFound', { id })
    return p
  }

  /** 已登记项目里包含这个目录的最深的那个 */
  find(dir: string): ProjectRow | null {
    let best: ProjectRow | null = null
    for (const p of this.repo.all()) {
      if (within(dir, p.path) && (best === null || p.path.length > best.path.length)) best = p
    }
    return best
  }

  /** 登记；同一路径已登记就返回已有的（归档的顺带取消归档） */
  create(path: string, name?: string): { project: ProjectRow; created: boolean } {
    const dir = normalizeDir(path)
    const existing = this.repo.byPath(dir)
    if (existing) {
      if (existing.archivedAt !== null) this.repo.setArchived(existing.id, null)
      if (name !== undefined && name !== existing.name) this.repo.update(existing.id, { name })
      return { project: this.repo.get(existing.id) as ProjectRow, created: false }
    }
    const project = this.repo.insert({
      id: this.newId(),
      name: name ?? (basename(dir) || dir),
      path: dir,
      createdAt: this.now(),
    })
    return { project, created: true }
  }

  /** 任务要落在哪个项目：已登记的最深者，否则按仓库根（或目录本身）自动登记 */
  assign(cwd: string): { project: ProjectRow; auto: boolean } {
    const dir = normalizeDir(cwd)
    const hit = this.find(dir)
    if (hit) return { project: hit, auto: false }
    const { project, created } = this.create(projectLikeRoot(dir) ?? dir)
    return { project, auto: created }
  }

  resolve(cwd: string): { project: ProjectRow | null; projectLike: boolean; root: string } {
    const dir = normalizeDir(cwd)
    const root = projectLikeRoot(dir)
    return { project: this.find(dir), projectLike: root !== null, root: root ?? dir }
  }

  update(id: string, patch: { name?: string; settings?: Partial<ProjectSettings> }): ProjectRow {
    const p = this.repo.update(id, patch)
    if (!p) throw new ProjectError('error.project.notFound', { id })
    return p
  }

  archive(id: string, archived: boolean): void {
    this.get(id)
    this.repo.setArchived(id, archived ? this.now() : null)
  }

  /** 自由会话的沙盒目录（建好） */
  scratchDir(sessionId: string): string {
    const d = join(this.opts.home, 'scratch', sessionId)
    mkdirSync(d, { recursive: true })
    return d
  }

  /**
   * 升级前的老会话归类（SPEC-M8-004 取舍-3）：cwd 像项目 → 任务并归到（自动登记的）项目；其余 → 自由会话。
   * 只改列表元数据，不往老会话里追加事件（事件记录的是当时的事实）。返回归类了几个
   */
  backfill(): number {
    const sessions = this.opts.log.sessions
    let n = 0
    for (const s of sessions.unclassified()) {
      let dir: string | null = null
      try {
        dir = normalizeDir(s.cwd)
      } catch {
        // 目录已经没了：当自由会话
      }
      const root = dir === null ? null : (this.find(dir)?.path ?? projectLikeRoot(dir))
      if (dir !== null && root !== null) sessions.setKind(s.id, 'task', this.assign(dir).project.id)
      else sessions.setKind(s.id, 'chat', null)
      n++
    }
    return n
  }
}
