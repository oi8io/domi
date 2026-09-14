/**
 * PRD-M1-001 AC-4 · 新增 provider 只需实现接口 + 注册
 *
 * AC 的判据是「kernel 与 model 核心的 diff 为 0」。
 * 换句话说：**「有哪些 provider」这件知识只许存在于 factory.ts 一个地方。**
 * 一旦 kernel 里出现 `if (provider === 'anthropic')`，加第五个 provider 就要改内核，
 * AC-4 说的「只需实现接口 + 注册」就不成立了。
 *
 * 照例先造违规验证守卫会红——没被证伪过的守卫等于没有守卫。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'kernel', 'src', '__provider_fixture.ts')

/**
 * 清理临时 fixture。删不掉就换成不违反任何规则的空模块——
 * 挂载没有删除权限时，rm 会把一个本身是好的守卫报成失败。
 */
function cleanupFixture(path: string): void {
  if (!existsSync(path)) return
  try {
    rmSync(path)
  } catch {
    writeFileSync(path, 'export {}\n', 'utf8')
  }
}

afterEach(() => cleanupFixture(FIXTURE))

async function run(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-provider-isolation.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

describe('守卫会红', () => {
  test('kernel 里硬编码 provider 名被拦下', async () => {
    writeFileSync(FIXTURE, "export const isClaude = (p: string) => p === 'anthropic'\n", 'utf8')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('anthropic')
    expect(out).toContain('只需实现接口 + 注册')
  }, 60_000)

  test('注释里提 provider 名不算违规 —— 写文档要用', async () => {
    writeFileSync(FIXTURE, '// 这里将来要支持 anthropic 与 openai\nexport const x = 1\n', 'utf8')
    expect((await run()).code).toBe(0)
  }, 60_000)
})

describe('真实仓库是绿的', () => {
  test('AC-4：provider 名只出现在 factory 与能力矩阵里', async () => {
    expect((await run()).code).toBe(0)
  }, 60_000)
})
