/**
 * 影子仓库 —— PRD-M1-011 · SPEC-M1-011
 *
 * 算法抄自 Cline 的 shadow git checkpoint（`PRD-VISION.md` §6 第二类：只抄算法）。
 * 做法是拿系统 git，把 `--git-dir` 指到 `~/.domi/shadows/<hash>`、
 * `--work-tree` 指到用户的工作目录。于是：
 *   - 用户自己的 `.git` 完全不被触碰（HEAD / index / reflog 都不变）
 *   - untracked 文件也能被快照（这是 git stash 做不到的那部分）
 *   - 行为与用户自己的 git 完全一致 —— 给他看 diff 时这点很关键
 *
 * **git 没装时功能降级并明确告知**，不是静默跳过：
 * 用户以为有安全网而实际没有，比没有安全网更危险。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024

/** 内置排除表。这些目录进快照只会让每一步都慢几秒，且没人想回滚它们 */
export const BUILTIN_EXCLUDES = [
  'node_modules/',
  'dist/',
  'build/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  'target/',
  '.turbo/',
  'coverage/',
] as const

export interface Snapshot {
  id: string
  label: string
  createdAt: number
  files: number
  /** 超过阈值、只记了指纹没存内容的文件（AC-5） */
  largeFiles: LargeFileRecord[]
}

export interface LargeFileRecord {
  path: string
  bytes: number
  sha256: string
}

export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /** true 表示这个文件太大没存内容，diff 里要显式标注 */
  contentNotSnapshotted?: boolean
}

export interface ShadowRepoOptions {
  workTree: string
  /** 默认 ~/.domi/shadows/<workspace-hash> */
  gitDir?: string
  maxFileBytes?: number
  now?: () => number
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export class GitUnavailableError extends Error {
  readonly messageKey = 'error.git_unavailable'
  constructor() {
    super(
      'error.git_unavailable: 没有找到可用的 git，步级快照已关闭。\n' +
        'domi 不会静默跳过这件事——你以为有安全网而实际没有，比没有安全网更危险。\n' +
        '$ git --version   # 装上 git 后重启 domi 即可恢复',
    )
    this.name = 'GitUnavailableError'
  }
}

export function workspaceHash(workTree: string): string {
  return createHash('sha256').update(workTree).digest('hex').slice(0, 16)
}

export class ShadowRepo {
  readonly gitDir: string
  readonly workTree: string
  private readonly maxFileBytes: number
  private readonly now: () => number
  private initialized = false

  constructor(opts: ShadowRepoOptions) {
    this.workTree = opts.workTree
    this.gitDir = opts.gitDir ?? join(homedir(), '.domi', 'shadows', workspaceHash(opts.workTree))
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.now = opts.now ?? (() => Date.now())
  }

  private async run(args: string[]): Promise<RunResult> {
    const p = Bun.spawn(['git', '--git-dir', this.gitDir, '--work-tree', this.workTree, ...args], {
      cwd: this.workTree,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        // 影子仓库不该继承用户的身份或 hooks —— 它不是用户的提交
        GIT_AUTHOR_NAME: 'domi',
        GIT_AUTHOR_EMAIL: 'domi@localhost',
        GIT_COMMITTER_NAME: 'domi',
        GIT_COMMITTER_EMAIL: 'domi@localhost',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    })
    const stdout = await new Response(p.stdout).text()
    const stderr = await new Response(p.stderr).text()
    return { code: await p.exited, stdout, stderr }
  }

  async available(): Promise<boolean> {
    try {
      const p = Bun.spawn(['git', '--version'], { stdout: 'pipe', stderr: 'pipe' })
      await new Response(p.stdout).text()
      return (await p.exited) === 0
    } catch {
      return false
    }
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    if (!(await this.available())) throw new GitUnavailableError()
    if (!existsSync(join(this.gitDir, 'HEAD'))) {
      mkdirSync(this.gitDir, { recursive: true })
      const r = await this.run(['init', '--quiet', '--initial-branch', 'domi'])
      if (r.code !== 0) throw new Error(`影子仓库初始化失败：${r.stderr}`)
    }
    mkdirSync(join(this.gitDir, 'info'), { recursive: true })
    this.writeExcludes([])
    this.initialized = true
  }

  /** 内置排除表 + 本次的大文件，一起写进影子仓库的 info/exclude（不碰用户的 .gitignore） */
  private writeExcludes(largePaths: string[]): void {
    const lines = [
      '# 由 domi 生成 —— 这是影子仓库的排除表，你的 .gitignore 不受影响',
      ...BUILTIN_EXCLUDES,
      ...largePaths,
    ]
    writeFileSync(join(this.gitDir, 'info', 'exclude'), `${lines.join('\n')}\n`, 'utf8')
  }

  /** 找出超过阈值的文件。只在 git 认为需要跟踪的范围内找，所以先问 git */
  private async findLargeFiles(): Promise<LargeFileRecord[]> {
    const r = await this.run(['ls-files', '--others', '--cached', '--exclude-standard'])
    const out: LargeFileRecord[] = []
    for (const rel of r.stdout.split('\n').filter(Boolean)) {
      const abs = join(this.workTree, rel)
      try {
        const st = statSync(abs)
        if (!st.isFile() || st.size <= this.maxFileBytes) continue
        out.push({
          path: rel,
          bytes: st.size,
          sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
        })
      } catch {
        /* 文件在扫描途中没了，忽略 */
      }
    }
    return out
  }

  private largeManifestPath(id: string): string {
    return join(this.gitDir, `large-${id}.json`)
  }

  async snapshot(label: string): Promise<Snapshot> {
    await this.ensureInit()

    const large = await this.findLargeFiles()
    this.writeExcludes(large.map((f) => f.path))

    await this.run(['add', '-A'])
    const commit = await this.run(['commit', '--allow-empty', '--no-verify', '-q', '-m', label])
    if (commit.code !== 0) throw new Error(`快照失败：${commit.stderr}`)

    const head = (await this.run(['rev-parse', 'HEAD'])).stdout.trim()
    const count = (await this.run(['ls-files'])).stdout.split('\n').filter(Boolean).length

    // 大文件清单存在**影子仓库里**，不写进用户的工作目录
    writeFileSync(this.largeManifestPath(head), JSON.stringify(large), 'utf8')

    return { id: head, label, createdAt: this.now(), files: count, largeFiles: large }
  }

  largeFilesOf(id: string): LargeFileRecord[] {
    const p = this.largeManifestPath(id)
    if (!existsSync(p)) return []
    return JSON.parse(readFileSync(p, 'utf8')) as LargeFileRecord[]
  }

  async diff(from: string, to?: string): Promise<FileDiff[]> {
    await this.ensureInit()
    const args = to ? ['diff', '--name-status', from, to] : ['diff', '--name-status', from]
    const r = await this.run(args)
    const large = new Set(this.largeFilesOf(to ?? from).map((f) => f.path))

    const map: Record<string, FileDiff['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' }
    const out: FileDiff[] = []
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const [code, ...rest] = line.split('\t')
      const path = rest[rest.length - 1] ?? ''
      const status = map[(code ?? '')[0] ?? ''] ?? 'modified'
      out.push(large.has(path) ? { path, status, contentNotSnapshotted: true } : { path, status })
    }
    // 大文件不在 git diff 里（被排除了），但用户需要知道它们存在
    for (const f of large) {
      if (!out.some((d) => d.path === f)) out.push({ path: f, status: 'modified', contentNotSnapshotted: true })
    }
    return out
  }

  /**
   * 回滚到某个快照。
   * **先给当前状态打一个快照**（AC-4）——否则用户误点一次就回不去了，
   * 而"回滚"恰恰是最容易误点的操作。
   */
  async restore(id: string): Promise<{ undoSnapshotId: string }> {
    await this.ensureInit()
    const undo = await this.snapshot(`回滚前的自动快照（目标 ${id.slice(0, 8)}）`)

    // 用 read-tree 而不是 checkout / reset --hard，两个原因：
    //   1. `checkout <id> -- .` 只覆盖目标快照里有的路径，**之后新建的文件会留在索引里**，
    //      于是 clean 也清不掉它们（它们已经被 add 过了）——这是第一版的 bug
    //   2. `reset --hard` 会把影子仓库的 HEAD 往回搬，历史就不再是 append-only 了；
    //      read-tree -u --reset 只动索引与工作区，HEAD 继续往前长，
    //      跟事件流「只增不改」是同一个立场
    const r = await this.run(['read-tree', '-u', '--reset', id])
    if (r.code !== 0) throw new Error(`回滚失败：${r.stderr}`)
    // 索引已经回到目标快照，此时 clean 才能真正清掉之后新建的文件
    await this.run(['clean', '-fd'])
    return { undoSnapshotId: undo.id }
  }

  /** 给测试与 doctor 用：影子仓库有多少个快照 */
  async count(): Promise<number> {
    await this.ensureInit()
    const r = await this.run(['rev-list', '--count', 'HEAD'])
    return r.code === 0 ? Number(r.stdout.trim()) : 0
  }

  relativize(abs: string): string {
    return relative(this.workTree, abs)
  }
}
