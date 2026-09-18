/**
 * PRD-M7-007 · 代码结构理解（AC-1 ~ AC-3）
 *
 * AC-2 的「第二次明显快于第一次」是基准断言：第一次要建 LanguageService、解析全部依赖，
 * 第二次只重查变了的那个文件。两者差一个数量级，断言取 1/2 留足余量（CI 机器慢也不会误报）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionEngine, ToolRegistry } from '@domi/capability'
import {
  DiagnosticsService,
  makeDiagnosticsTool,
  makeOutlineTool,
  OUTLINE_MAX_CHARS,
  OUTLINE_MAX_FILES,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function project(files: Record<string, string>): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-ci-')))
  dirs.push(d)
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(d, p, '..'), { recursive: true })
    writeFileSync(join(d, p), text)
  }
  return d
}

function registry(cwd: string, rules = [{ name: 'r', capability: 'fs.read', decision: 'allow' as const }]) {
  const reg = new ToolRegistry({ cwd, permissions: new PermissionEngine({ rules }) })
    .register(makeOutlineTool())
    .register(makeDiagnosticsTool(new DiagnosticsService()))
  let n = 0
  return (name: string, args: Record<string, unknown>) =>
    reg.run({ id: `c${++n}`, name, args }, new AbortController().signal)
}

const SRC = `
import { helper } from './util.ts'
/** 两数相加 */
export function add(a: number, b: number): number {
  const secret = 'BODY_SHOULD_NOT_APPEAR'
  return helper(a) + b
}
export class Counter {
  count = 0
  inc(by = 1): number { return (this.count += by) }
  private hidden(): void {}
}
export interface Point { x: number; y: number }
export type Id = string | number
export const VERSION = '1.0'
function internal(): void {}
`

describe('PRD-M7-007 AC-1 · code.outline', () => {
  test('文件：导出符号与签名，不带函数体、不列未导出的', async () => {
    const d = project({ 'src/a.ts': SRC, 'src/util.ts': 'export const helper = (n: number) => n\n' })
    const r = await registry(d)('code.outline', { path: 'src/a.ts' })
    expect(r.ok).toBe(true)
    const { outline } = r.payload as { outline: string }
    for (const s of ['add(a: number, b: number): number', 'Counter', 'inc(', 'Point', 'Id', 'VERSION']) {
      expect(outline).toContain(s)
    }
    expect(outline).not.toContain('BODY_SHOULD_NOT_APPEAR')
    expect(outline).not.toContain('internal')
  })

  test('目录：逐个文件出提纲；文件多了按上限截断并标注', async () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < OUTLINE_MAX_FILES + 10; i++) {
      many[`lib/m${String(i).padStart(3, '0')}.ts`] =
        `export function fn${i}(a: string, b: number): Promise<string> { return Promise.resolve(a) }\n`
    }
    const d = project(many)
    const r = (await registry(d)('code.outline', { path: 'lib' })).payload as {
      outline: string
      files: number
      truncated?: string
    }
    expect(r.files).toBeLessThanOrEqual(OUTLINE_MAX_FILES)
    expect(r.truncated).toBeDefined()
    expect(r.outline.length).toBeLessThanOrEqual(OUTLINE_MAX_CHARS)
    expect(r.outline).toContain('fn0(')
  })

  test('读取归 fs.read：只放行 fs.read 就能用；fs.read 被拒时一起被拒', async () => {
    const d = project({ 'a.ts': 'export const a = 1\n' })
    expect((await registry(d)('code.outline', { path: 'a.ts' })).ok).toBe(true)
    const denied = await registry(d, [{ name: 'no', capability: 'fs.read', decision: 'deny' as never }])(
      'code.outline',
      {
        path: 'a.ts',
      },
    )
    expect(denied.ok).toBe(false)
    expect(denied.events?.find((e) => e.t === 'permission')).toMatchObject({
      capabilityId: 'fs.read',
      decision: 'deny',
    })
  })
})

describe('PRD-M7-007 AC-2 · code.diagnostics', () => {
  test('给出文件、行、消息；改好之后增量重查，第二次明显快于第一次（基准）', async () => {
    const d = project({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true } }),
      'src/a.ts': 'export const n: number = "不是数字"\n',
      'src/b.ts': 'export const ok = 1\n',
    })
    const run = registry(d)
    const first = (await run('code.diagnostics', { path: 'src/a.ts' })).payload as {
      diagnostics: Array<{ file: string; line: number; message: string; category: string }>
      ms: number
      tsconfig: string | null
    }
    expect(first.tsconfig).toBe('tsconfig.json')
    expect(first.diagnostics).toHaveLength(1)
    expect(first.diagnostics[0]).toMatchObject({ file: 'src/a.ts', line: 1, category: 'error' })
    expect(first.diagnostics[0]?.message).toContain('number')

    writeFileSync(join(d, 'src/a.ts'), 'export const n: number = 42\n')
    // mtime 是版本号：同一毫秒里改两次看不出来，显式往后拨
    const later = new Date(Date.now() + 5_000)
    utimesSync(join(d, 'src/a.ts'), later, later)
    const second = (await run('code.diagnostics', { path: 'src/a.ts' })).payload as {
      diagnostics: unknown[]
      ms: number
    }
    expect(second.diagnostics).toEqual([])
    expect(second.ms).toBeLessThan(first.ms / 2)
  }, 60_000)

  test('没有 tsconfig 也能查（用宽松的默认选项）', async () => {
    const d = project({ 'x.ts': 'const s: string = 1\nexport {}\n' })
    const r = (await registry(d)('code.diagnostics', { path: 'x.ts' })).payload as {
      diagnostics: unknown[]
      tsconfig: string | null
    }
    expect(r.tsconfig).toBeNull()
    expect(r.diagnostics.length).toBeGreaterThan(0)
  }, 60_000)
})

describe('PRD-M7-007 AC-3 · 非 TS/JS 返回「不支持」而不是空结果', () => {
  test('outline 与 diagnostics 对 .py / .md / 没有 TS 文件的目录都如实说不支持', async () => {
    const d = project({ 'a.py': 'def f(): pass\n', 'README.md': '# x\n', 'docs/x.md': '# y\n' })
    const run = registry(d)
    for (const [name, path] of [
      ['code.outline', 'a.py'],
      ['code.outline', 'docs'],
      ['code.diagnostics', 'README.md'],
    ] as const) {
      const r = await run(name, { path })
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('unsupported')
      expect(JSON.stringify(r.payload)).toContain('不是 TS / JS 文件')
    }
  })
})
