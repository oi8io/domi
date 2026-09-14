/**
 * PRD-M1-007 AC-3 · 指标是纯投影
 *
 * AC 的断言方式写得很具体：**删除状态栏模块后 kernel 全部测试仍绿**。
 * 这里就照字面做——把 StatusBar 移走，跑一遍 kernel 的测试，再放回去。
 *
 * 为什么值得这么测：如果哪天有人为了图省事，让状态栏那边自己埋点、
 * kernel 去读它，这个测试会立刻红。光靠 code review 看不出这种耦合。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, renameSync } from 'node:fs'

const STATUSBAR = 'apps/tui/src/components/StatusBar.tsx'
const MOVED = 'apps/tui/src/components/StatusBar.tsx.moved'

afterEach(() => {
  if (existsSync(MOVED)) renameSync(MOVED, STATUSBAR)
})

describe('AC-3 · kernel 不依赖状态栏', () => {
  test('把 StatusBar 移走，packages/kernel 的测试仍然全绿', async () => {
    expect(existsSync(STATUSBAR)).toBe(true)
    renameSync(STATUSBAR, MOVED)

    const p = Bun.spawn(['bun', 'test', 'packages/kernel/test/metrics.spec.ts', 'packages/kernel/test/loop.spec.ts'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
    const code = await p.exited

    renameSync(MOVED, STATUSBAR)
    expect(code).toBe(0)
    expect(out).toContain('0 fail')
  }, 60_000)
})
