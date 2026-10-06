/**
 * SPEC-M14-003 取舍-3/6/7 · PRD-M14-003 AC-2/AC-5
 * ShadowRepo 新增能力：clean（无变化判定）、restorePath（单文件恢复）、diffFiles（带 patch 的 diff）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATCH_MAX, ShadowRepo } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-shadow-m14-'))
  dirs.push(d)
  return d
}

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.map((a) => `'${a}'`).join(' ')}`, { cwd, encoding: 'utf8' }).trim()
}

function repo(workTree: string): ShadowRepo {
  return new ShadowRepo({ workTree, gitDir: join(tmp(), 'shadow.git') })
}

/** 用户自己的仓库：tracked + .gitignore + untracked，全部提交过 */
async function fixture(): Promise<{ work: string; r: ShadowRepo }> {
  const work = tmp()
  writeFileSync(join(work, 'tracked.txt'), 'v1\n')
  writeFileSync(join(work, '.gitignore'), 'ignored.txt\nsecret/\n')
  writeFileSync(join(work, 'ignored.txt'), '不该进快照\n')
  mkdirSync(join(work, 'secret'), { recursive: true })
  writeFileSync(join(work, 'secret', 's.txt'), '秘密\n')
  git(work, 'init', '-q', '--initial-branch', 'main')
  git(work, '-c', 'user.email=u@e.com', '-c', 'user.name=U', 'add', '-A')
  git(work, '-c', 'user.email=u@e.com', '-c', 'user.name=U', 'commit', '-q', '-m', 'init')
  writeFileSync(join(work, 'untracked.txt'), '新建没 add\n')
  return { work, r: repo(work) }
}

/** 用户仓库指纹：HEAD + 索引 + status + reflog */
function fingerprint(work: string): string {
  return [
    git(work, 'rev-parse', 'HEAD'),
    git(work, 'ls-files', '-s'),
    git(work, 'status', '--porcelain'),
    git(work, 'reflog', '-1'),
  ].join('\n')
}

describe('ShadowRepo.clean（SPEC-M14-003 取舍-3）', () => {
  test('无变化 true；改文件 / 新建 untracked / 删文件都 false', async () => {
    const { work, r } = await fixture()
    await r.snapshot('s0')
    expect(await r.clean()).toBe(true)

    writeFileSync(join(work, 'tracked.txt'), 'v2\n')
    expect(await r.clean()).toBe(false)
    await r.snapshot('s1')

    writeFileSync(join(work, 'new.txt'), '新建\n')
    expect(await r.clean()).toBe(false) // untracked 也算脏
    await r.snapshot('s2')

    rmSync(join(work, 'new.txt'))
    expect(await r.clean()).toBe(false) // 删了文件（相对 HEAD 少一个）
  })
})

describe('ShadowRepo.diffFiles（SPEC-M14-003 取舍-6）', () => {
  test('shell 改的文件出现在 diff 里；.gitignore 排除的不出现（AC-2）', async () => {
    const { work, r } = await fixture()
    const b = await r.snapshot('before')
    // shell 行为：sed -i 改 tracked、新建 untracked、写 ignored（不该进）
    execSync(`printf 'v2\\n' > tracked.txt && printf '新\\n' > untracked.txt && printf 'x\\n' > ignored.txt`, {
      cwd: work,
    })
    const a = await r.snapshot('after')

    const files = await r.diffFiles(b.id, a.id)
    const paths = files.map((f) => f.path).sort()
    expect(paths).toContain('tracked.txt')
    expect(paths).toContain('untracked.txt')
    expect(paths).not.toContain('ignored.txt')
    expect(paths).not.toContain('secret/s.txt')

    const tracked = files.find((f) => f.path === 'tracked.txt')
    expect(tracked?.status).toBe('modified')
    expect(tracked?.patch).toContain('+v2')
    expect(tracked?.patch).toContain('-v1')

    // path 过滤
    const only = await r.diffFiles(b.id, a.id, 'tracked.txt')
    expect(only.map((f) => f.path)).toEqual(['tracked.txt'])
  })

  test('新增文件 status=added；删除 status=deleted；patch 截断标 truncated', async () => {
    const { work, r } = await fixture()
    const b = await r.snapshot('before')
    writeFileSync(join(work, 'made.txt'), '新文件\n')
    const a = await r.snapshot('after')
    const added = await r.diffFiles(b.id, a.id, 'made.txt')
    expect(added[0]).toMatchObject({ path: 'made.txt', status: 'added' })

    rmSync(join(work, 'made.txt'))
    writeFileSync(join(work, 'tracked.txt'), '改\n')
    const c = await r.snapshot('after2')
    const deleted = await r.diffFiles(a.id, c.id, 'made.txt')
    expect(deleted[0]).toMatchObject({ path: 'made.txt', status: 'deleted' })

    // 超长 patch 截断
    writeFileSync(join(work, 'big.txt'), `${'x'.repeat(PATCH_MAX + 1000)}\n`)
    const d = await r.snapshot('after3')
    const big = await r.diffFiles(c.id, d.id, 'big.txt')
    expect(big[0]?.truncated).toBe(true)
    expect(big[0]?.patch.length).toBeLessThanOrEqual(PATCH_MAX)
  })
})

describe('ShadowRepo.restorePath（SPEC-M14-003 取舍-7）', () => {
  test('快照里有该文件 → 内容恢复；不动用户 .git 的 HEAD / 索引 / reflog', async () => {
    const { work, r } = await fixture()
    const before = fingerprint(work)
    const b = await r.snapshot('s1')
    writeFileSync(join(work, 'tracked.txt'), 'v2\n')
    const a = await r.snapshot('s2')

    await r.restorePath(b.id, 'tracked.txt')
    expect(readFileSync(join(work, 'tracked.txt'), 'utf8')).toBe('v1\n')
    expect(fingerprint(work)).toBe(before)
    // 影子仓库自己的 HEAD 往前长（restorePath 不动它）：count 还是 2
    expect(await r.count()).toBe(2)
    void a
  })

  test('快照里没有该文件 → 从工作树与索引移除', async () => {
    const { work, r } = await fixture()
    const b = await r.snapshot('s1')
    writeFileSync(join(work, 'later.txt'), '后来建的\n')
    const a = await r.snapshot('s2')

    await r.restorePath(b.id, 'later.txt')
    expect(existsSync(join(work, 'later.txt'))).toBe(false)
    // 影子仓库索引里也没了
    const listed = git(join(r.gitDir), '--git-dir', r.gitDir, 'ls-files', 'later.txt')
    expect(listed).toBe('')
  })

  test('路径逃逸（.. / 绝对路径 / .git）拒绝', async () => {
    const { work, r } = await fixture()
    const b = await r.snapshot('s1')
    await expect(r.restorePath(b.id, '../x.txt')).rejects.toThrow('不在工作目录')
    await expect(r.restorePath(b.id, '/etc/passwd')).rejects.toThrow('不在工作目录')
    await expect(r.restorePath(b.id, '.git/config')).rejects.toThrow('不在工作目录')
  })
})
