/**
 * PRD-M2-008 AC-5 · 删掉 packages/eval，kernel 与 store 的测试仍全绿
 *
 * 让删除会失败的唯一原因，是有人从外面引用了它。
 * 所以守卫查的是引用方向：评估可以认识内核，内核不许认识评估。
 *
 * 照例先造违规验证守卫会红——没被证伪过的守卫等于没有守卫。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'kernel', 'src', '__eval_fixture.ts')

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
  const p = Bun.spawn(['bun', 'run', 'scripts/check-eval-isolation.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

describe('守卫会红', () => {
  test('kernel 反向 import @domi/eval 被拦下', async () => {
    writeFileSync(FIXTURE, "import { replay } from '@domi/eval'\nexport const x = replay\n", 'utf8')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('@domi/eval')
    expect(out).toContain('单向依赖')
  }, 60_000)

  test('相对路径绕进 packages/eval 也算', async () => {
    writeFileSync(
      FIXTURE,
      "import { normalize } from '../../eval/src/normalize.ts'\nexport const x = normalize\n",
      'utf8',
    )
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('相对路径')
  }, 60_000)

  test('注释里提 @domi/eval 不算违规 —— 写文档要用', async () => {
    writeFileSync(FIXTURE, '// 回放见 @domi/eval\nexport const x = 1\n', 'utf8')
    expect((await run()).code).toBe(0)
  }, 60_000)
})

describe('接线点只许动态 import', () => {
  const WIRING = join('packages', 'cli', 'src', '__eval_fixture.ts')
  afterEach(() => cleanupFixture(WIRING))

  test('packages/cli 静态 import @domi/eval 被拦下 —— 那会让删掉 eval 把整个 domi 打死', async () => {
    writeFileSync(WIRING, "import { runEval } from '@domi/eval'\nexport const x = runEval\n", 'utf8')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('只许动态 import')
  }, 60_000)

  test('动态 import 是允许的 —— 它能退化成一句提示', async () => {
    writeFileSync(WIRING, "export const load = () => import('@domi/eval')\n", 'utf8')
    expect((await run()).code).toBe(0)
  }, 60_000)
})

describe('真实仓库是绿的', () => {
  test('AC-5：没有任何人从外面引用评估层', async () => {
    expect((await run()).code).toBe(0)
  }, 60_000)
})
