/**
 * PRD-M7-008 · 从 git 历史出评估题（AC-1 ~ AC-4）· SPEC-M7-008
 *
 * fixture 仓库在测试里现造（真 git、真 bun test），覆盖四种提交：
 *   fix-add      —— 该收：父提交上测试失败、放入参考答案后通过；说明里带协作者署名与一行和改动逐字相同的代码
 *   sub-already  —— 该丢：父提交上测试已经通过（判别不了）
 *   needs-env    —— 该丢：放入参考答案后仍失败（依赖提交外的东西）
 *   tests-only / src-only —— 根本不是候选
 * 模型不参与：跑题时用一个「照抄参考答案」的替身跑 L2 harness（INV-08）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPrompt, listCandidates, loadL2Tasks, type MinedTask, mineTasks, runOne } from '../src/index.ts'

const dirs: string[] = []
function tmp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const GIT = '-c user.email=a@b -c user.name=a'
function commit(repo: string, files: Record<string, string>, message: string): string {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(repo, p, '..'), { recursive: true })
    writeFileSync(join(repo, p), text)
  }
  const msg = join(repo, '..', `msg-${Math.random().toString(36).slice(2)}`)
  writeFileSync(msg, message)
  execSync(`git add -A && git ${GIT} commit -q -F ${JSON.stringify(msg)}`, { cwd: repo })
  rmSync(msg)
  return execSync('git rev-parse HEAD', { cwd: repo }).toString().trim()
}

const FIXED_LINE = 'return a + b // 修好的那一行'
let repo = ''
let out = ''
let results: MinedTask[] = []
const sha = { fixAdd: '', subAlready: '', needsEnv: '' }

beforeAll(() => {
  repo = join(tmp('domi-mine-'), 'calc')
  mkdirSync(repo)
  execSync('git init -q', { cwd: repo })
  commit(
    repo,
    {
      'src/add.ts': 'export function add(a: number, b: number): number {\n  return a - b\n}\n',
      'src/sub.ts': 'export function sub(a: number, b: number): number {\n  return a - b\n}\n',
    },
    'init',
  )
  sha.fixAdd = commit(
    repo,
    {
      'src/add.ts': `export function add(a: number, b: number): number {\n  ${FIXED_LINE}\n}\n`,
      'test/add.test.ts':
        "import { expect, test } from 'bun:test'\nimport { add } from '../src/add.ts'\ntest('加法进位', () => expect(add(1, 2)).toBe(3))\n",
    },
    `fix: 加法写成了减法\n\n用户报的：1 + 2 算出来是 -1。\n${FIXED_LINE}\n\nCo-Authored-By: Some Bot <bot@example.invalid>\nSigned-off-by: a <a@b>\n`,
  )
  sha.subAlready = commit(
    repo,
    {
      'src/sub.ts': 'export function sub(a: number, b: number): number {\n  // 注释\n  return a - b\n}\n',
      'test/sub.test.ts':
        "import { expect, test } from 'bun:test'\nimport { sub } from '../src/sub.ts'\ntest('减法', () => expect(sub(3, 1)).toBe(2))\n",
    },
    'test: 给减法补测试',
  )
  sha.needsEnv = commit(
    repo,
    {
      'src/cfg.ts':
        "import { readFileSync } from 'node:fs'\nexport const cfg = () => JSON.parse(readFileSync('/definitely/not/here.json', 'utf8'))\n",
      'test/cfg.test.ts':
        "import { expect, test } from 'bun:test'\nimport { cfg } from '../src/cfg.ts'\ntest('读配置', () => expect(cfg().ok).toBe(true))\n",
    },
    'feat: 读配置',
  )
  commit(repo, { 'test/more.test.ts': "import { test } from 'bun:test'\ntest('x', () => {})\n" }, 'test: 只改测试')
  commit(repo, { 'src/extra.ts': 'export const x = 1\n' }, 'feat: 只改源码')
  out = tmp('domi-mine-out-')
  results = mineTasks({ repo, out, testCmd: 'bun test {files}', setup: '', timeoutMs: 60_000 })
}, 120_000)

describe('PRD-M7-008 AC-1 · 挑同时改了源码与测试的提交，生成 PRD-M6-005 格式的题', () => {
  test('候选只有三个：只改测试 / 只改源码的提交不算', () => {
    expect(
      listCandidates(repo)
        .map((c) => c.commit)
        .sort(),
    ).toEqual([sha.fixAdd, sha.subAlready, sha.needsEnv].sort())
  })

  test('工作区 = 父提交；判据 = 该提交带来的测试；参考答案 = 该提交改的源码', () => {
    const kept = results.find((r) => r.kept)
    expect(kept?.commit).toBe(sha.fixAdd)
    const dir = join(out, 'tasks', kept?.id as string)
    expect(readFileSync(join(dir, 'workspace', 'src', 'add.ts'), 'utf8')).toContain('return a - b')
    expect(existsSync(join(dir, 'workspace', 'test', 'add.test.ts'))).toBe(false)
    expect(readFileSync(join(dir, 'tests', 'test', 'add.test.ts'), 'utf8')).toContain('加法进位')
    expect(readFileSync(join(dir, 'solution', 'src', 'add.ts'), 'utf8')).toContain(FIXED_LINE)
    // L2 harness 认得这个格式（task.yaml + check.ts）
    const [task] = loadL2Tasks(join(out, 'tasks'))
    expect(task).toMatchObject({ id: kept?.id, source: { commit: sha.fixAdd } })
  })
})

describe('PRD-M7-008 AC-2 · 只收「父提交上失败、该提交上通过」的题，其余写明原因', () => {
  test('三个候选：收一个、丢两个，丢的各有原因，并写进报告', () => {
    const by = Object.fromEntries(results.map((r) => [r.commit, r]))
    expect(by[sha.fixAdd]?.kept).toBe(true)
    expect(by[sha.subAlready]).toMatchObject({ kept: false })
    expect(by[sha.subAlready]?.reason).toContain('父提交上测试已经通过')
    expect(by[sha.needsEnv]).toMatchObject({ kept: false })
    expect(by[sha.needsEnv]?.reason).toContain('放入参考答案后测试仍不通过')
    // 丢掉的题不留目录
    expect(readdirSync(join(out, 'tasks'))).toEqual([by[sha.fixAdd]?.id as string])
    const report = readFileSync(join(out, 'mine-report.md'), 'utf8')
    expect(report).toContain('收下 1 题')
    expect(report).toContain('判别不了')
    expect(report).toContain('多半依赖提交外的环境')
  })
})

describe('PRD-M7-008 AC-3 · 题面只有说明与失败测试名，不含 diff 的任何片段', () => {
  test('去掉署名等元数据行、去掉与改动逐字相同的行；列出要通过的测试', () => {
    const [task] = loadL2Tasks(join(out, 'tasks'))
    const prompt = task?.prompt ?? ''
    expect(prompt).toContain('fix: 加法写成了减法')
    expect(prompt).toContain('1 + 2 算出来是 -1')
    expect(prompt).toContain('test/add.test.ts')
    expect(prompt).not.toMatch(/co-authored-by|signed-off-by/i)
    expect(prompt).not.toContain(FIXED_LINE)
    // diff 的任何一行（加的、删的）都不在题面里
    const diff = execSync(`git diff ${sha.fixAdd}^ ${sha.fixAdd}`, { cwd: repo }).toString()
    for (const l of diff.split('\n')) {
      if (!/^[+-]/.test(l) || /^(\+\+\+|---)/.test(l)) continue
      const line = l.slice(1).trim()
      if (line.length >= 12) expect(prompt).not.toContain(line)
    }
  })

  test('buildPrompt：标题本身就是一行代码时换成通用标题', () => {
    const p = buildPrompt(
      { subject: 'return a + b // x', body: '', tests: ['t.test.ts'] },
      new Set(['return a + b // x']),
    )
    expect(p.split('\n')[0]).toBe('按下面的测试完成改动')
  })
})

describe('PRD-M7-008 AC-4 · 不进 CI；运行复用 L2 harness', () => {
  test('CI 工作流里没有 eval mine 与 eval l2', () => {
    const ci = readFileSync(join(import.meta.dir, '../../../.github/workflows/ci.yml'), 'utf8')
    expect(ci).not.toMatch(/eval\s+mine/)
    expect(ci).not.toMatch(/eval\s+l2/)
  })

  test('出的题直接交给 runOne：什么都不做 → 不通过；照抄参考答案 → 通过', async () => {
    const [task] = loadL2Tasks(join(out, 'tasks'))
    if (!task) throw new Error('应该有一题')
    const fixtureDir = tmp('domi-mine-fx-')
    const idle = await runOne(task, 1, { model: 'none', fixtureDir, run: async () => [] })
    expect(idle.pass).toBe(false)
    const cheat = await runOne(task, 1, {
      model: 'none',
      fixtureDir,
      run: async ({ workspace }) => {
        execSync(`cp -R ${JSON.stringify(join(task.dir, 'solution'))}/. ${JSON.stringify(workspace)}`)
        return []
      },
    })
    expect(cheat.pass).toBe(true)
  }, 60_000)
})
