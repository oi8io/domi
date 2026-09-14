/**
 * INV-02 · 三端零业务逻辑 —— 守卫照例先红一次
 *
 * apps/tui 只许看到 runtime（门面）/ client-core（投影）/ config / protocol。
 * 直接 import kernel、store、capability 就是把业务逻辑搬到端上，
 * M3 拆 daemon 时要一个个抠出来。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('apps', 'tui', 'src', '__arch_fixture.ts')

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
  /**
   * fixture 用**相对路径**而不是 `@domi/kernel`，因为按包名 import 根本走不通——
   * kernel 不在 apps/tui 的 dependencies 里，pnpm 没有链过去。
   * 那是 ENGINEERING.md 说的第一道防线（物理隔离 > CI 规则），它先一步挡住了。
   *
   * 但正因为如此，如果只按包名测，depcruise 这条规则永远不会被触发，
   * 也就永远没被验证过。相对路径正是人真的想绕过隔离时会写的东西——
   * 所以它才是这条规则该拦的场景。
   */
  test('apps/tui 里用相对路径 import kernel 被 no-logic-in-apps 拦下', async () => {
    writeFileSync(FIXTURE, "export { runTurn } from '../../../packages/kernel/src/index.ts'\n", 'utf8')
    const { code, out } = await depcruise()
    expect(code).not.toBe(0)
    expect(out).toContain('no-logic-in-apps')
  }, 60_000)

  test('相对路径 import store 同样被拦', async () => {
    writeFileSync(FIXTURE, "export { SqliteEventLog } from '../../../packages/store/src/index.ts'\n", 'utf8')
    expect((await depcruise()).code).not.toBe(0)
  }, 60_000)

  test('按包名 import 则被 pnpm 的物理隔离挡住 —— 第一道防线', async () => {
    const p = Bun.spawn(['node', '-e', "require.resolve('@domi/kernel', { paths: ['apps/tui'] })"], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await new Response(p.stderr).text()
    expect(await p.exited).not.toBe(0)
  }, 30_000)
})

describe('真实仓库是绿的', () => {
  test('packages + apps 全部无架构违规', async () => {
    expect((await depcruise()).code).toBe(0)
  }, 60_000)
})
