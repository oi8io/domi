/**
 * PRD-M1-011 · 步级快照与回滚（AC-1/2/4/5）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_EXCLUDES, ShadowRepo } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-shadow-'))
  dirs.push(d)
  return d
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(p.stdout).text()
  await p.exited
  return out.trim()
}

/** 一个真实的用户仓库：有自己的 .git、有 .gitignore、有 untracked 文件 */
async function userRepo(): Promise<string> {
  const d = tmp()
  writeFileSync(join(d, 'tracked.txt'), 'v1\n')
  writeFileSync(join(d, '.gitignore'), 'ignored.txt\nsecret/\n')
  writeFileSync(join(d, 'ignored.txt'), '不该进快照\n')
  mkdirSync(join(d, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(d, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(1000))
  await git(d, 'init', '--quiet', '--initial-branch', 'main')
  await git(d, 'config', 'user.email', 'u@example.com')
  await git(d, 'config', 'user.name', 'User')
  await git(d, 'add', 'tracked.txt', '.gitignore')
  await git(d, 'commit', '-q', '-m', 'init')
  writeFileSync(join(d, 'untracked.txt'), '新建但没 add\n')
  return d
}

function repo(workTree: string, maxFileBytes?: number): ShadowRepo {
  return new ShadowRepo({
    workTree,
    gitDir: join(tmp(), 'shadow.git'),
    ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
  })
}

describe('AC-1 · 不污染用户的 .git', () => {
  test('快照前后 HEAD / index mtime / reflog 三者均无变化', async () => {
    const work = await userRepo()
    const r = repo(work)

    // 顺序有讲究：`git status` 会刷新并**写回** index，
    // 所以它必须排在读 mtime 之前，否则测到的是自己搅动的结果。
    const statusBefore = await git(work, 'status', '--porcelain')
    const before = {
      head: await git(work, 'rev-parse', 'HEAD'),
      reflog: await git(work, 'reflog', '--format=%H %gs'),
      indexMtime: statSync(join(work, '.git', 'index')).mtimeMs,
    }
    expect(statusBefore).not.toContain('v2')

    await r.snapshot('第一次')
    writeFileSync(join(work, 'tracked.txt'), 'v2\n')
    await r.snapshot('第二次')

    // 同理：mtime 先读，status 最后跑
    expect(statSync(join(work, '.git', 'index')).mtimeMs).toBe(before.indexMtime)
    expect(await git(work, 'rev-parse', 'HEAD')).toBe(before.head)
    expect(await git(work, 'reflog', '--format=%H %gs')).toBe(before.reflog)
    expect(await git(work, 'status', '--porcelain')).toContain('tracked.txt')
  }, 30_000)

  test('影子仓库在工作目录之外，工作目录里不留任何 domi 的文件', async () => {
    const work = await userRepo()
    const r = repo(work)
    await r.snapshot('x')
    const entries = await git(work, 'status', '--porcelain', '--untracked-files=all')
    expect(entries).not.toContain('.domi')
    expect(entries).not.toContain('shadow')
  }, 30_000)
})

describe('AC-2 · untracked 与排除表', () => {
  test('untracked 文件能被快照，回滚后消失', async () => {
    const work = await userRepo()
    const r = repo(work)
    const base = await r.snapshot('有 untracked.txt')

    writeFileSync(join(work, 'brand-new.txt'), '第二次之后才有的\n')
    await r.snapshot('多了一个文件')

    await r.restore(base.id)
    expect(readFileSync(join(work, 'untracked.txt'), 'utf8')).toBe('新建但没 add\n')
    expect(() => readFileSync(join(work, 'brand-new.txt'), 'utf8')).toThrow()
  }, 30_000)

  test('.gitignore 生效：被忽略的文件不进快照', async () => {
    const work = await userRepo()
    const r = repo(work)
    const snap = await r.snapshot('x')
    expect(snap.files).toBeGreaterThan(0)

    // 改掉被忽略的文件，回滚后它**不该**被还原（它压根没进快照）
    writeFileSync(join(work, 'ignored.txt'), '改过了\n')
    await r.restore(snap.id)
    expect(readFileSync(join(work, 'ignored.txt'), 'utf8')).toBe('改过了\n')
  }, 30_000)

  test('内置排除表挡住 node_modules —— 不然每一步都要慢几秒', async () => {
    const work = await userRepo()
    const r = repo(work)
    await r.snapshot('x')
    const excludes = readFileSync(join(r.gitDir, 'info', 'exclude'), 'utf8')
    for (const e of BUILTIN_EXCLUDES) expect(excludes).toContain(e)
    expect(excludes).toContain('你的 .gitignore 不受影响')
  }, 30_000)
})

describe('AC-4 · 回滚本身可回滚', () => {
  test('连续两次回滚回到初始状态', async () => {
    const work = await userRepo()
    const r = repo(work)

    writeFileSync(join(work, 'tracked.txt'), 'A\n')
    const snapA = await r.snapshot('状态 A')
    writeFileSync(join(work, 'tracked.txt'), 'B\n')
    await r.snapshot('状态 B')
    expect(readFileSync(join(work, 'tracked.txt'), 'utf8')).toBe('B\n')

    // 回到 A
    const first = await r.restore(snapA.id)
    expect(readFileSync(join(work, 'tracked.txt'), 'utf8')).toBe('A\n')

    // 回滚前自动打的那个快照记录的是 B —— 所以「撤销这次回滚」回到了 B
    await r.restore(first.undoSnapshotId)
    expect(readFileSync(join(work, 'tracked.txt'), 'utf8')).toBe('B\n')
  }, 30_000)
})

describe('AC-5 · 大文件只记指纹', () => {
  test('超过 maxFileBytes 的文件不存内容，但路径与 SHA-256 记下来了', async () => {
    const work = await userRepo()
    const r = repo(work, 1024)
    writeFileSync(join(work, 'big.bin'), 'x'.repeat(5000))

    const snap = await r.snapshot('含大文件')
    expect(snap.largeFiles).toHaveLength(1)
    expect(snap.largeFiles[0]?.path).toBe('big.bin')
    expect(snap.largeFiles[0]?.bytes).toBe(5000)
    expect(snap.largeFiles[0]?.sha256).toHaveLength(64)

    // 大文件不在快照内容里
    const excludes = readFileSync(join(r.gitDir, 'info', 'exclude'), 'utf8')
    expect(excludes).toContain('big.bin')
  }, 30_000)

  test('diff 里显式标注「内容未快照」', async () => {
    const work = await userRepo()
    const r = repo(work, 1024)
    const base = await r.snapshot('基线')
    writeFileSync(join(work, 'big.bin'), 'y'.repeat(5000))
    writeFileSync(join(work, 'tracked.txt'), '改了\n')
    const after = await r.snapshot('改动之后')

    const diffs = await r.diff(base.id, after.id)
    const big = diffs.find((d) => d.path === 'big.bin')
    const small = diffs.find((d) => d.path === 'tracked.txt')
    expect(big?.contentNotSnapshotted).toBe(true)
    expect(small?.contentNotSnapshotted).toBeUndefined()
    expect(small?.status).toBe('modified')
  }, 30_000)
})

describe('git 不可用时', () => {
  test('available() 反映真实情况（本环境有 git）', async () => {
    expect(await repo(await userRepo()).available()).toBe(true)
  }, 30_000)
})
