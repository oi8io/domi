/**
 * PRD-M1-008 AC-3 · 首次运行是一份固定的四步清单
 *
 * 第一次运行几乎必然走到「没有凭据」这条分支。
 * 原来那里只丢一句 `error.missing_credential` —— 把新用户扔在门口。
 * 这条测试把「报错时必须带上四步清单」钉死，它是 `scripts/smoke-binary.sh` 的单测版本：
 * 冒烟跑的是二进制，这里跑的是源码，改坏了不用等 CI 出产物就红。
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const ENTRY = join('apps', 'tui', 'src', 'main.tsx')

/** 干净环境：不给任何凭据。INV-08——冒烟与测试都绝不发真实请求 */
async function runFirstTime(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', ENTRY], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: join(process.cwd(), 'node_modules', '.cache', 'domi-first-run') },
  })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

describe('第一次运行', () => {
  test('没有凭据时，除了报错还要给出四步清单', async () => {
    const { code, out } = await runFirstTime()
    expect(code).toBe(2)
    expect(out).toContain('没有找到模型凭据')
    for (const n of [1, 2, 3, 4]) expect(out).toContain(`第 ${n} 步 / 共 4 步`)
  }, 60_000)

  test('第一步就告诉你本地模型怎么走 —— 拿不到官方 key 的人不该卡在这里', async () => {
    const { out } = await runFirstTime()
    expect(out).toContain('openai-compatible')
  }, 60_000)
})
