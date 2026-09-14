/**
 * INV-08 · 真实 LLM 调用不进 CI 门禁 —— 守卫照例先红一次
 *
 * 这条不变量原来只靠「大家记得」。守卫把它变成机器判定：
 * 会花钱的脚本自报 `INV-08-LIVE`，CI 里既不许跑它们，也不许出现模型凭据。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WF = join('.github', 'workflows', '__guard_fixture.yml')

function cleanupFixture(path: string): void {
  if (!existsSync(path)) return
  try {
    rmSync(path)
  } catch {
    // 删不掉就写成一份不违规的空 workflow —— 挂载没有删除权限时，
    // rm 会把一个本身是好的守卫报成失败
    writeFileSync(
      path,
      'name: noop\non: workflow_dispatch\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps: []\n',
      'utf8',
    )
  }
}

afterEach(() => cleanupFixture(WF))

async function run(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-ci-no-live-calls.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

describe('守卫会红', () => {
  test('CI 里跑 measure-cache.ts 被拦下', async () => {
    writeFileSync(WF, 'jobs:\n  x:\n    steps:\n      - run: bun run scripts/measure-cache.ts --yes\n', 'utf8')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('measure-cache.ts')
  }, 60_000)

  test('CI 里注入模型凭据被拦下 —— 有 key 就等于给了开火权限', async () => {
    writeFileSync(
      WF,
      'jobs:\n  x:\n    steps:\n      - run: pnpm test\n        env:\n          ANTHROPIC_API_KEY: ${{ secrets.K }}\n',
      'utf8',
    )
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('ANTHROPIC_API_KEY')
  }, 60_000)

  test('注释里说明「这里不跑 measure-cache」不算违规', async () => {
    writeFileSync(
      WF,
      '# 不跑 scripts/measure-cache.ts，也不注入 ANTHROPIC_API_KEY\njobs:\n  x:\n    steps:\n      - run: pnpm test\n',
      'utf8',
    )
    expect((await run()).code).toBe(0)
  }, 60_000)
})

describe('真实仓库是绿的', () => {
  test('会花钱的脚本都自报了 INV-08-LIVE，且没进 CI', async () => {
    expect((await run()).code).toBe(0)
    // 反向确认标记确实在用 —— 不然守卫会「零个脚本，恒绿」
    expect(readFileSync(join('scripts', 'measure-cache.ts'), 'utf8')).toContain('INV-08-LIVE')
  }, 60_000)
})
