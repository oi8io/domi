/**
 * PRD-M2-001 AC-4 · 源码中不存在对已弃用的 sampling / roots / logging 的调用（AST 扫描）
 * 守卫：scripts/check-deprecated-mcp.ts（pnpm guard:mcp）。先造违规证明它会红。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join('packages', 'mcp', 'src', '__deprecated_fixture.ts')

afterEach(() => {
  if (!existsSync(FIXTURE)) return
  try {
    rmSync(FIXTURE)
  } catch {
    // 没有删除权限的挂载：换成不违规的空模块（文件在 .gitignore 里）
    writeFileSync(FIXTURE, 'export {}\n', 'utf8')
  }
})

async function guard(): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-deprecated-mcp.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const err = await new Response(p.stderr).text()
  return { code: await p.exited, err }
}

const VIOLATIONS: Array<[string, string]> = [
  ['调 setLoggingLevel', "declare const c: any\nexport const x = c.setLoggingLevel('info')\n"],
  ['注册 sampling 处理器', "declare const c: any\nc.setRequestHandler('sampling/createMessage', () => ({}))\n"],
  ['注册 roots 处理器', "declare const c: any\nc.setRequestHandler('roots/list', () => ({ roots: [] }))\n"],
  ['发 roots 变更通知', 'declare const c: any\nexport const x = c.sendRootsListChanged()\n'],
  ['声明 sampling 能力', 'export const caps = { sampling: {} }\n'],
  ['声明 roots 能力', 'export const caps = { roots: { listChanged: true } }\n'],
]

describe('守卫会红', () => {
  for (const [name, code] of VIOLATIONS) {
    test(name, async () => {
      writeFileSync(FIXTURE, code, 'utf8')
      const r = await guard()
      expect(r.code).not.toBe(0)
      expect(r.err).toContain('__deprecated_fixture.ts')
    })
  }

  test('注释和普通字符串里提到这些词不算', async () => {
    writeFileSync(
      FIXTURE,
      "// 不调用 setLoggingLevel、sampling、roots\nexport const note = '见 sampling 文档'\n",
      'utf8',
    )
    expect((await guard()).code).toBe(0)
  })
})

describe('真实源码是干净的', () => {
  test('packages/mcp/src 不碰已弃用的 API', async () => {
    const r = await guard()
    if (r.code !== 0) throw new Error(r.err)
    expect(r.code).toBe(0)
  })

  test('接线：guard 链里有 guard:mcp', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['guard:mcp']).toBe('bun run scripts/check-deprecated-mcp.ts')
    expect(pkg.scripts.guard?.split('&&').map((s) => s.trim())).toContain('pnpm guard:mcp')
  })
})
