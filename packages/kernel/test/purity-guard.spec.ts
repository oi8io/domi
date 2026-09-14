/**
 * PRD-M0-006 AC-1 · 纯度守卫本身也要先红一次
 * depcruise 管 import，管不了 Date.now() —— 这个洞由本守卫补上。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmps: string[] = []
afterEach(() => {
  while (tmps.length) {
    const d = tmps.pop()!
    if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  }
})

async function run(dir: string): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-kernel-purity.ts', dir], { stdout: 'pipe', stderr: 'pipe' })
  const err = await new Response(p.stderr).text()
  return { code: await p.exited, err }
}

function fixture(code: string): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-purity-'))
  tmps.push(d)
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'src', 'x.ts'), code, 'utf8')
  return d
}

describe('守卫会红', () => {
  test.each([
    ['Date.now()', 'export const t = Date.now()\n'],
    ['Math.random()', 'export const r = Math.random()\n'],
    ['new Date()', 'export const d = new Date()\n'],
  ])('%s 被拦', async (_label, code) => {
    const { code: exit } = await run(fixture(code))
    expect(exit).not.toBe(0)
  })

  test('从入参拿时间不算违规', async () => {
    const { code } = await run(fixture('export const f = (now: number) => now + 1\n'))
    expect(code).toBe(0)
  })
})

describe('真实 kernel 是纯的', () => {
  test('packages/kernel/src 无非确定性调用', async () => {
    const { code } = await run('packages/kernel/src')
    expect(code).toBe(0)
  })
})
