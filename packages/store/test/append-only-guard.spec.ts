/**
 * PRD-M0-001 AC-3 · 守卫本身必须先红一次
 *
 * PROCESS.md 缺口四：判官是机器。但没被证伪过的机器判官等于没有判官——
 * 所以本文件先造一个违规 fixture，断言脚本确实会红，再断言真实仓库是绿的。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = 'scripts/check-append-only.ts'
const tmps: string[] = []

function fixtureDir(code: string): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-guard-'))
  tmps.push(d)
  mkdirSync(join(d, 'pkg', 'src'), { recursive: true })
  writeFileSync(join(d, 'pkg', 'src', 'evil.ts'), code, 'utf8')
  return d
}

async function run(...args: string[]): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(['bun', 'run', SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const err = await new Response(p.stderr).text()
  const code = await p.exited
  return { code, err }
}

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
})

describe('守卫会红', () => {
  test('UPDATE events 被拦', async () => {
    const d = fixtureDir(`export const q = "UPDATE events SET payload = '{}' WHERE seq = 1"\n`)
    const { code, err } = await run(d)
    expect(code).not.toBe(0)
    expect(err).toContain('UPDATE events')
  })

  test('DELETE FROM events 被拦', async () => {
    const d = fixtureDir('export const q = `DELETE FROM events WHERE session_id = ?`\n')
    const { code, err } = await run(d)
    expect(code).not.toBe(0)
    expect(err).toContain('DELETE FROM events')
  })

  test('模板串插值也被拦（不能靠拼接绕过）', async () => {
    const d = fixtureDir('const t = "events"\nexport const q = `UPDATE ${t} SET ts = 0`\n')
    const { code } = await run(d)
    expect(code).not.toBe(0)
  })

  test('注释里的 UPDATE events 不算违规（AST 扫描，不是 grep）', async () => {
    const d = fixtureDir('// 历史上这里曾经是 UPDATE events SET ...，现在不许了\nexport const q = "SELECT 1"\n')
    const { code } = await run(d)
    expect(code).toBe(0)
  })
})

describe('真实仓库是绿的', () => {
  test('packages 下无违规', async () => {
    const { code } = await run('packages')
    expect(code).toBe(0)
  })
})
