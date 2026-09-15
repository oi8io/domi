/**
 * PRD-M3-004 AC-1 · daemon 是事件流的唯一写入者
 *
 * 客户端只提交意图，不能直接写库。机器可读的形状就是：**client-core 不依赖 store**。
 * `package.json` 里不声明 `@domi/store`，pnpm 的物理隔离挡住按包名 import；
 * 这里守的是另一条路——相对路径直接摸进 `packages/store/src`，那条 pnpm 管不到。
 * 规则：`.dependency-cruiser.cjs` 的 `client-core-no-store`（`docs/prd/M3.md` §4.3）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

afterEach(() => {
  if (!existsSync(FIXTURE)) return
  try {
    rmSync(FIXTURE)
  } catch {
    // 没有删除权限的挂载：换成不违反任何规则的空模块（文件本身在 .gitignore 里）
    writeFileSync(FIXTURE, 'export {}\n', 'utf8')
  }
})

describe('守卫会红', () => {
  test('client-core 里相对路径 import store 被 client-core-no-store 拦下', async () => {
    writeFileSync(FIXTURE, "export * from '../../store/src/index.ts'\n", 'utf8')
    const { code, out } = await depcruise()
    expect(code).not.toBe(0)
    expect(out).toContain('client-core-no-store')
  }, 60_000)
})

describe('当前状态满足唯一写入者', () => {
  test('client-core 的 package.json 不声明 @domi/store', () => {
    const pkg = JSON.parse(readFileSync('packages/client-core/package.json', 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@domi/store')
  })
})
