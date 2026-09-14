/**
 * PRD-M1-010 AC-4 · 写入路径守卫也要先红一次（INV-11）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'cli', 'src', '__write_fixture.ts')
afterEach(() => {
  if (existsSync(FIXTURE)) rmSync(FIXTURE)
})

async function run(): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-write-paths.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  return { code: await p.exited, out }
}

describe('守卫会红', () => {
  test('写到绝对路径字面量被拦', async () => {
    mkdirSync(join('packages', 'cli', 'src'), { recursive: true })
    writeFileSync(FIXTURE, "import { writeFileSync } from 'node:fs'\nwriteFileSync('/etc/evil', 'x')\n", 'utf8')
    const { code, out } = await run()
    expect(code).not.toBe(0)
    expect(out).toContain('/etc/evil')
  }, 60_000)

  test('join 的第一段是绝对路径字面量也被拦（拼接绕不过去）', async () => {
    writeFileSync(
      FIXTURE,
      "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nexport const f = (n: string) => writeFileSync(join('/var/lib', n), 'x')\n",
      'utf8',
    )
    expect((await run()).code).not.toBe(0)
  }, 60_000)

  test('从参数算出来的路径不算违规 —— 那是能追溯的', async () => {
    writeFileSync(
      FIXTURE,
      "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nexport const f = (dir: string) => writeFileSync(join(dir, 'a.txt'), 'x')\n",
      'utf8',
    )
    expect((await run()).code).toBe(0)
  }, 60_000)
})

describe('真实仓库是绿的', () => {
  test('packages + apps 无绝对路径字面量写入', async () => {
    expect((await run()).code).toBe(0)
  }, 60_000)
})
