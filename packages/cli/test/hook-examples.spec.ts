/**
 * PRD-M7-003 AC-6 · `domi init` 模板附的两个示例钩子：提交信息规则与暂存区密钥扫描
 *
 * 每个都**先造违规、证明会拦**，再证干净的放行。最后一条走真实路径：
 * 按模板里的写法 `domi hook …` 当成钩子命令跑（HookRunner 同一个 runHookCommand），看退出码与理由。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHookCommand } from '@domi/runtime'
import { checkCommitMessage, scanStaged } from '../src/hook.ts'
import { CONFIG_TEMPLATE, parseCli, runCommand } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function repo(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-hookex-')))
  dirs.push(d)
  spawnSync('git', ['init', '-q'], { cwd: d })
  return d
}
// 拼出来的假凭据：源码里不出现完整的样子，免得被别的扫描器当真
const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8) + 'FAKEFAKEFAKEFAKE1234'].join('-')

describe('PRD-M7-003 AC-6 · 模板里有两个示例钩子', () => {
  test('init 模板的 hooks 段引用 domi hook commit-msg 与 domi hook secrets', () => {
    expect(CONFIG_TEMPLATE).toContain('run: domi hook commit-msg')
    expect(CONFIG_TEMPLATE).toContain('run: domi hook secrets')
  })
})

describe('PRD-M7-003 AC-6 · commit-msg：拦截指定的行', () => {
  test('造违规：提交信息里带协作者署名 → 拦下并指出是哪一行', () => {
    const r = checkCommitMessage('git commit -m "feat: x" -m "Co-Authored-By: Someone <a@b.c>"', '/tmp')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('Co-Authored-By')
  })

  test('BUG-M7-002 · 署名单独成一段 -m（行首在引号里、不在命令的行首）：各种引号与写法都拦', () => {
    for (const cmd of [
      `git commit -m "feat: x" -m "Co-Authored-By: A <a@b.c>"`,
      `git commit -m 'feat: x' -m 'Co-Authored-By: A <a@b.c>'`,
      `git commit --message="feat: x" --message="Claude-Session: https://x.invalid"`,
      `git commit -am "feat: "quoted"" -m "Co-authored-by: lower case"`,
    ]) {
      expect(checkCommitMessage(cmd, '/tmp').ok).toBe(false)
    }
    // 只是在正文中间提到这个词，不算署名行
    expect(checkCommitMessage(`git commit -m "docs: 解释 Co-Authored-By: 为什么不许用"`, '/tmp').ok).toBe(true)
  })

  test('造违规：署名写在 -F 指向的文件里也拦', () => {
    const d = repo()
    writeFileSync(join(d, 'msg.txt'), 'feat: x\n\nClaude-Session: https://example.invalid/s\n')
    expect(checkCommitMessage('git -c core.x=y commit -F msg.txt', d).ok).toBe(false)
  })

  test('额外的正则参数也生效；干净的提交与非 commit 命令放行', () => {
    expect(checkCommitMessage('git commit -m "WIP: x"', '/tmp', [/^WIP:/im]).ok).toBe(false)
    expect(checkCommitMessage('git commit -m "feat: 正常的提交"', '/tmp').ok).toBe(true)
    expect(checkCommitMessage('echo "Co-Authored-By: x"', '/tmp').ok).toBe(true)
  })
})

describe('PRD-M7-003 AC-6 · secrets：暂存区密钥扫描', () => {
  test('造违规：暂存了带凭据的文件 → 拦下，理由里只给前几个字符', () => {
    const d = repo()
    writeFileSync(join(d, 'config.ts'), `export const key = '${FAKE_KEY}'\n`)
    spawnSync('git', ['add', 'config.ts'], { cwd: d })
    const r = scanStaged(d)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('config.ts')
    expect(!r.ok && r.reason).not.toContain(FAKE_KEY)
  })

  test('干净的暂存区放行；只在工作区、没暂存的不算', () => {
    const d = repo()
    writeFileSync(join(d, 'ok.ts'), 'export const x = 1\n')
    spawnSync('git', ['add', 'ok.ts'], { cwd: d })
    writeFileSync(join(d, 'local.ts'), `const k = '${FAKE_KEY}'\n`)
    expect(scanStaged(d).ok).toBe(true)
  })
})

describe('PRD-M7-003 AC-6 · 当成钩子跑：退出码非 0 = 拦，输出就是理由', () => {
  async function hook(name: string, cmd: string, cwd: string): Promise<{ code: number; err: string }> {
    const err: string[] = []
    const prev = { cmd: process.env.DOMI_CMD, cwd: process.env.DOMI_CWD }
    process.env.DOMI_CMD = cmd
    process.env.DOMI_CWD = cwd
    try {
      const code = await runCommand(parseCli(['hook', name]), { out: () => {}, err: (s) => err.push(s) })
      return { code, err: err.join('\n') }
    } finally {
      for (const [k, v] of [
        ['DOMI_CMD', prev.cmd],
        ['DOMI_CWD', prev.cwd],
      ] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  test('domi hook commit-msg / secrets 的退出码与理由', async () => {
    const d = repo()
    expect((await hook('commit-msg', 'git commit -m "x" -m "Co-Authored-By: y"', d)).code).toBe(1)
    expect((await hook('commit-msg', 'git commit -m "x"', d)).code).toBe(0)
    writeFileSync(join(d, 'k.ts'), `const k = '${FAKE_KEY}'\n`)
    spawnSync('git', ['add', 'k.ts'], { cwd: d })
    const bad = await hook('secrets', 'git commit -m "x"', d)
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('疑似凭据')
    // 不是提交命令就不扫
    expect((await hook('secrets', 'ls', d)).code).toBe(0)
  })

  test('经 runHookCommand（HookRunner 用的那一个）以子进程跑 `domi hook commit-msg`：拦下并带回理由', async () => {
    const d = repo()
    const main = join(import.meta.dir, '../../../apps/tui/src/main.tsx')
    const r = await runHookCommand(
      { run: `bun ${main} hook commit-msg`, timeoutMs: 30_000 },
      { cwd: d, env: { DOMI_CMD: 'git commit -m "x" -m "Co-Authored-By: y"', DOMI_CWD: d }, stdin: '{}' },
    )
    expect(r.exitCode).toBe(1)
    expect(r.output).toContain('Co-Authored-By')
  }, 40_000)
})
