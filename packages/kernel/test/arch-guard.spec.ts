/**
 * INV-02 · 架构边界的守卫本身必须先红一次
 *
 * PROCESS.md 缺口四：判官是机器，不是自觉。
 * 但**没被证伪过的机器判官等于没有判官**——规则写错了、路径没匹配上，
 * 你只会看到一个安心的绿勾。所以这里先造违规再看它红。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'kernel', 'src', '__arch_fixture.ts')

async function depcruise(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['npx', 'depcruise', 'packages', '--config', '.dependency-cruiser.cjs'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  const code = await p.exited
  return { code, out }
}

afterEach(() => {
  if (existsSync(FIXTURE)) rmSync(FIXTURE)
})

describe('守卫会红', () => {
  test('kernel 里 import node:fs 被 no-io-in-kernel 拦下', async () => {
    writeFileSync(FIXTURE, "import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n", 'utf8')
    const { code, out } = await depcruise()
    expect(code).not.toBe(0)
    expect(out).toContain('no-io-in-kernel')
  }, 60_000)

  test('kernel 里 import AI SDK 被 no-model-sdk-outside-model 拦下（ADR-004 的边界）', async () => {
    writeFileSync(FIXTURE, "import { generateText } from 'ai'\nexport const x = generateText\n", 'utf8')
    const { code, out } = await depcruise()
    expect(code).not.toBe(0)
    expect(out).toMatch(/no-model-sdk-outside-model|no-io-in-kernel/)
  }, 60_000)
})

describe('真实仓库是绿的', () => {
  test('packages 下无架构违规', async () => {
    const { code } = await depcruise()
    expect(code).toBe(0)
  }, 60_000)
})

describe('INV-02 · kernel 的运行时依赖面', () => {
  test('kernel 的 dependencies 只有 @domi/protocol', async () => {
    const pkg = JSON.parse(await Bun.file('packages/kernel/package.json').text()) as {
      dependencies?: Record<string, string>
    }
    // 端口（ports.ts）存在的理由就是这一条：kernel 不 import store/model 的任何实现，
    // 它们在测试里作为 devDependencies 出现是可以的，运行时依赖面必须是空的。
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@domi/protocol'])
  })
})
