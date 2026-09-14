/**
 * PRD-M3-003 AC-2 · client-core 要能在浏览器里跑
 *
 * **为什么 M0 就测这个**：这条约束只会越来越难守。
 * 等 M3 做 Web 端才发现 client-core 里混进了 node:fs，
 * 要往回扒的是几个月的代码；现在守成本为零。
 * （PROCESS.md 缺口五：决策必须落盘成机器可读的约束，而不是只写在文档里）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'client-core', 'src', '__arch_fixture.ts')

async function depcruise(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['npx', 'depcruise', 'packages', 'apps', '--config', '.dependency-cruiser.cjs'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

/**
 * 清理临时 fixture。
 *
 * **不能只靠 rm**：这个仓库可能挂在没有删除权限的环境里（容器挂载、只读 bind、
 * 沙箱重连后权限失效），那时 rm 会抛 EPERM/EFAULT，把一个**守卫本身是好的**测试
 * 报成失败——错误信号指向了完全无关的地方。
 * 删不掉就退而求其次：把内容换成一个不违反任何规则的空模块。
 */
function cleanupFixture(path: string): void {
  if (!existsSync(path)) return
  try {
    rmSync(path)
  } catch {
    writeFileSync(path, 'export {}\n', 'utf8')
  }
}

afterEach(() => {
  cleanupFixture(FIXTURE)
})

describe('守卫会红', () => {
  test('client-core 里 import node:fs 被拦下', async () => {
    writeFileSync(FIXTURE, "export { readFileSync } from 'node:fs'\n", 'utf8')
    const { code, out } = await depcruise()
    expect(code).not.toBe(0)
    expect(out).toContain('no-node-in-browser-packages')
  }, 60_000)

  test('client-core 里 import react 同样被拦（ADR-009）', async () => {
    writeFileSync(FIXTURE, "export { useState } from 'react'\n", 'utf8')
    expect((await depcruise()).code).not.toBe(0)
  }, 60_000)
})

describe('当前状态已经是浏览器安全的', () => {
  test('client-core + protocol 的依赖闭包只有 nanostores 与 zod', async () => {
    const { code } = await depcruise()
    expect(code).toBe(0)
  }, 60_000)
})
