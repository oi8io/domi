/**
 * PRD-M3-001 AC-4 · 协议文档由 schema 生成，CI 断言无 diff
 *
 * 守卫本身是 `scripts/gen-protocol-docs.ts --check`，由 `pnpm guard:protocol` 接进 `pnpm check`。
 * 这里先造违规证明它**会红**，再证明真实仓库是绿的，最后钉住接线——
 * 一道没接进 check 的守卫和没有守卫是一回事。
 *
 * 造违规不碰仓库里的文件：脚本按 cwd 找 `docs/`，所以把文档拷到临时目录里改，
 * 在那里跑同一个脚本。这样测试中途崩了也不会把工作树留脏。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const SCRIPT = join(ROOT, 'scripts/gen-protocol-docs.ts')
const DOC = 'docs/protocol.md'
const SCHEMA = 'docs/protocol.schema.json'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      // 只删自己建的那一层——绝不往上删（TMPDIR 本身不归测试管）
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载没有删除权限时不该把一个本身是好的测试报成失败
    }
  }
})

/** 在临时目录里放一份仓库文档的拷贝，交给 mutate 改坏 */
function sandbox(mutate: (dir: string) => void): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-protodoc-'))
  dirs.push(d)
  mkdirSync(join(d, 'docs'))
  copyFileSync(join(ROOT, DOC), join(d, DOC))
  copyFileSync(join(ROOT, SCHEMA), join(d, SCHEMA))
  mutate(d)
  return d
}

async function check(cwd: string): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(['bun', 'run', SCRIPT, '--check'], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const err = await new Response(p.stderr).text()
  return { code: await p.exited, err }
}

describe('守卫会红', () => {
  test('有人手改了 docs/protocol.md', async () => {
    const d = sandbox((dir) => {
      const p = join(dir, DOC)
      writeFileSync(p, `${readFileSync(p, 'utf8')}\n## 手写补充\n\n这段不是从 schema 来的。\n`, 'utf8')
    })
    const r = await check(d)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(DOC)
  })

  test('schema 变了但 JSON Schema 没重新生成', async () => {
    const d = sandbox((dir) => {
      const p = join(dir, SCHEMA)
      const json = JSON.parse(readFileSync(p, 'utf8')) as { protocolVersion: number }
      json.protocolVersion += 1
      writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    })
    const r = await check(d)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(SCHEMA)
    // 文档本身没动，不该被误报
    expect(r.err).not.toContain(`${DOC} 与`)
  })

  test('生成产物根本不在仓库里', async () => {
    const d = sandbox((dir) => rmSync(join(dir, DOC)))
    const r = await check(d)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(DOC)
  })
})

describe('真实仓库是绿的', () => {
  test('docs/protocol.md 与 docs/protocol.schema.json 都与 rpc.ts 一致', async () => {
    const r = await check(ROOT)
    if (r.code !== 0) {
      throw new Error(`协议文档过期了。跑 \`bun run scripts/gen-protocol-docs.ts\` 并把结果一起提交。\n${r.err}`)
    }
    expect(r.code).toBe(0)
  })
})

describe('接线', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  test('guard:protocol 跑的是 --check，不是写入', () => {
    expect(pkg.scripts['guard:protocol']).toBe('bun run scripts/gen-protocol-docs.ts --check')
  })

  test('guard 链里有 guard:protocol —— 否则 pnpm check 根本不跑它', () => {
    expect(pkg.scripts.guard?.split('&&').map((s) => s.trim())).toContain('pnpm guard:protocol')
  })
})
