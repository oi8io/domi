/**
 * PRD-M0-008 AC-2 · 扫描守卫也要先红一次
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function run(dir: string): Promise<number> {
  const p = Bun.spawn(['bun', 'run', 'scripts/scan-secrets.ts', dir], { stdout: 'pipe', stderr: 'pipe' })
  await new Response(p.stderr).text()
  return await p.exited
}

function plant(content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-secrets-'))
  dirs.push(d)
  writeFileSync(join(d, 'events.jsonl'), content, 'utf8')
  return d
}

describe('守卫会红', () => {
  test.each([
    ['OpenAI 风格', 'sk-proj-abcdefghijklmnopqrstuvwxyz012345'],
    ['Anthropic 风格', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz01'],
    ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
  ])('%s 被扫出来', async (_label, secret) => {
    expect(await run(plant(`{"t":"user.input","text":"key=${secret}"}\n`))).not.toBe(0)
  })

  test('干净的事件流是绿的', async () => {
    expect(await run(plant('{"t":"user.input","text":"没有秘密"}\n'))).toBe(0)
  })
})

describe('真实仓库是干净的', () => {
  test('fixtures 里扫不出凭据', async () => {
    expect(await run('fixtures')).toBe(0)
  })
})
