/**
 * PRD-M7-001 · 编码工具集（AC-1 / AC-2 / AC-3 / AC-4 / AC-6）· SPEC-M7-001 · ADR-024
 *
 * 都经 ToolRegistry 跑（不直接调 execute）：过期写保护的记录本、权限、事件都挂在 registry 上，
 * 绕过它测出来的是「工具函数」而不是「模型实际用到的工具」。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent } from '@domi/protocol'
import {
  fsEdit,
  fsGlob,
  fsGrep,
  fsRead,
  fsWrite,
  GLOB_DEFAULT_LIMIT,
  JobTable,
  keyLines,
  makeShellKillTool,
  makeShellOutputTool,
  PermissionEngine,
  SHELL_MAX_OUTPUT_BYTES,
  shellExec,
  ToolRegistry,
  truncateOutput,
} from '../src/index.ts'

const dirs: string[] = []
const tables: JobTable[] = []
afterEach(() => {
  for (const t of tables.splice(0)) t.killAll()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(prefix = 'domi-code-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
function gitRepo(): string {
  const d = tmp('domi-code-repo-')
  spawnSync('git', ['init', '-q'], { cwd: d })
  return d
}

type Rule = { name: string; capability: string; decision: 'allow' | 'deny' | 'ask' }
const ALLOW_ALL: Rule[] = ['fs.read', 'fs.write', 'shell.exec'].map((c) => ({
  name: `allow-${c}`,
  capability: c,
  decision: 'allow',
}))

function registry(cwd: string, rules: Rule[] = ALLOW_ALL) {
  const jobs = new JobTable({ outputDir: join(cwd, '.out') })
  tables.push(jobs)
  const reg = new ToolRegistry({
    cwd,
    permissions: new PermissionEngine({ rules: rules as never }),
    jobs,
    outputDir: join(cwd, '.out'),
  })
    .register(fsRead)
    .register(fsWrite)
    .register(fsEdit)
    .register(fsGlob)
    .register(fsGrep)
    .register(shellExec)
    .register(makeShellOutputTool(jobs))
    .register(makeShellKillTool(jobs))
  let n = 0
  const run = (name: string, args: Record<string, unknown>) =>
    reg.run({ id: `c${++n}`, name, args }, new AbortController().signal)
  return { reg, run, jobs }
}

const payload = <T>(o: { payload: unknown }): T => o.payload as T
const events = (o: { events?: DomiEvent[] }): DomiEvent[] => o.events ?? []

describe('PRD-M7-001 AC-1 · fs.edit 精确替换', () => {
  test('恰好一处：只改那一处，前后各一条 fs.snapshot（与 fs.write 同一种快照）', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.ts'), 'const a = 1\nconst b = 2\nconst c = 3\n')
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    const r = await run('fs.edit', { path: 'a.ts', old: 'const b = 2', new: 'const b = 20' })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('const a = 1\nconst b = 20\nconst c = 3\n')
    const snaps = events(r).filter((e) => e.t === 'fs.snapshot') as Array<{ phase: string; sha256: string }>
    expect(snaps.map((s) => s.phase)).toEqual(['before', 'after'])
    expect(snaps[0]?.sha256).not.toBe(snaps[1]?.sha256)
    // fs.write 产生的是同一种事件、同样的两条
    const w = await run('fs.write', { path: 'b.ts', content: 'x' })
    expect(events(w).filter((e) => e.t === 'fs.snapshot').length).toBeGreaterThanOrEqual(1)
  })

  test('出现 0 次：拒绝，给出最像的候选行号，文件不动', async () => {
    const d = tmp()
    const text = 'function foo() {\n    return 1\n}\n'
    writeFileSync(join(d, 'a.ts'), text)
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    const r = await run('fs.edit', { path: 'a.ts', old: 'return  1', new: 'return 2' })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r.payload)).toContain('第 2 行')
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe(text)
  })

  test('出现多次：拒绝并列出每一处的行号，文件不动；replaceAll 才全换', async () => {
    const d = tmp()
    const text = 'x = 1\ny = 2\nx = 1\n'
    writeFileSync(join(d, 'a.ts'), text)
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    const r = await run('fs.edit', { path: 'a.ts', old: 'x = 1', new: 'x = 9' })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r.payload)).toContain('第 1、3 行')
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe(text)
    const all = await run('fs.edit', { path: 'a.ts', old: 'x = 1', new: 'x = 9', replaceAll: true })
    expect(all.ok).toBe(true)
    expect(payload<{ replaced: number }>(all).replaced).toBe(2)
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('x = 9\ny = 2\nx = 9\n')
  })

  test('本会话没读过的文件不能 edit（先读再改）', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.ts'), 'a\n')
    const { run } = registry(d)
    const r = await run('fs.edit', { path: 'a.ts', old: 'a', new: 'b' })
    expect(r.ok).toBe(false)
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('a\n')
  })
})

describe('PRD-M7-001 AC-2 · 过期写保护', () => {
  test('读 → 外部改 → fs.edit = 拒绝，文件保持外部改过的内容', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.ts'), 'v1\n')
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    writeFileSync(join(d, 'a.ts'), 'v1\nuser edit\n')
    const r = await run('fs.edit', { path: 'a.ts', old: 'v1', new: 'v2' })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r.payload)).toContain('重新读')
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('v1\nuser edit\n')
    // 重读之后就能改
    await run('fs.read', { path: 'a.ts' })
    expect((await run('fs.edit', { path: 'a.ts', old: 'v1', new: 'v2' })).ok).toBe(true)
  })

  test('读 → 外部改 → fs.write 覆盖 = 拒绝，文件内容不变', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.ts'), 'v1\n')
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    writeFileSync(join(d, 'a.ts'), 'external\n')
    const r = await run('fs.write', { path: 'a.ts', content: 'model\n' })
    expect(r.ok).toBe(false)
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('external\n')
  })

  test('自己写出的内容算「已知」：连着两次 edit 不需要中间重读', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.ts'), 'a\nb\n')
    const { run } = registry(d)
    await run('fs.read', { path: 'a.ts' })
    expect((await run('fs.edit', { path: 'a.ts', old: 'a', new: 'A' })).ok).toBe(true)
    expect((await run('fs.edit', { path: 'a.ts', old: 'b', new: 'B' })).ok).toBe(true)
  })
})

describe('PRD-M7-001 AC-3 · fs.glob / fs.grep', () => {
  function seed(): string {
    const d = gitRepo()
    writeFileSync(join(d, '.gitignore'), 'ignored/\n*.log\n')
    mkdirSync(join(d, 'src'))
    mkdirSync(join(d, 'ignored'))
    writeFileSync(join(d, 'src', 'a.ts'), 'export const needle = 1\n')
    writeFileSync(join(d, 'src', 'b.ts'), 'export const other = 2\n')
    writeFileSync(join(d, 'ignored', 'c.ts'), 'export const needle = 3\n')
    writeFileSync(join(d, 'debug.log'), 'needle\n')
    return d
  }

  test('glob 遵守 .gitignore', async () => {
    const d = seed()
    const { run } = registry(d)
    const r = payload<{ files: string[] }>(await run('fs.glob', { pattern: '**/*.ts' }))
    expect(r.files.sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  for (const backend of ['rg', 'builtin'] as const) {
    test(`grep（${backend}）遵守 .gitignore`, async () => {
      if (backend === 'rg' && !Bun.which('rg')) return
      const prev = process.env.DOMI_GREP_BACKEND
      if (backend === 'builtin') process.env.DOMI_GREP_BACKEND = 'builtin'
      try {
        const d = seed()
        const { run } = registry(d)
        const r = payload<{ matches: Array<{ path: string; line: number }>; backend: string }>(
          await run('fs.grep', { pattern: 'needle' }),
        )
        expect(r.backend).toBe(backend)
        expect(r.matches.map((m) => m.path)).toEqual(['src/a.ts'])
        expect(r.matches[0]?.line).toBe(1)
      } finally {
        if (prev === undefined) delete process.env.DOMI_GREP_BACKEND
        else process.env.DOMI_GREP_BACKEND = prev
      }
    })
  }

  test('超过上限：结果里标「已截断」与总数', async () => {
    const d = gitRepo()
    const n = GLOB_DEFAULT_LIMIT + 5
    for (let i = 0; i < n; i++) writeFileSync(join(d, `f${i}.txt`), 'hit\n')
    const { run } = registry(d)
    const g = payload<{ files: string[]; total: number; truncated?: { total: number } }>(
      await run('fs.glob', { pattern: '*.txt' }),
    )
    expect(g.files.length).toBe(GLOB_DEFAULT_LIMIT)
    expect(g.truncated?.total).toBe(n)
    const r = payload<{ matches: unknown[]; total: number; truncated?: { shown: number; total: number } }>(
      await run('fs.grep', { pattern: 'hit', limit: 10 }),
    )
    expect(r.matches.length).toBe(10)
    expect(r.truncated).toMatchObject({ shown: 10, total: n })
  })

  test('路径不越出工作目录（同 fs.read 的路径判定）', async () => {
    const d = seed()
    const { run } = registry(d)
    for (const [name, args] of [
      ['fs.glob', { pattern: '*', path: '..' }],
      ['fs.grep', { pattern: 'root', path: '../..' }],
      ['fs.read', { path: '../x' }],
    ] as const) {
      const r = await run(name, args)
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r.payload)).toContain('越界')
    }
  })
})

describe('PRD-M7-001 AC-4 · 后台命令与输出上限', () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  test('background 返回 job id；shell.output 取增量；shell.kill 回收整个进程组', async () => {
    const d = tmp()
    const { run } = registry(d)
    // 子 shell 再起一个孙进程并把它的 pid 写出来：杀组要连孙子一起杀掉
    const start = await run('shell.exec', {
      cmd: 'sleep 30 & echo "child $!"; echo first; while true; do sleep 0.05; done',
      background: true,
    })
    expect(start.ok).toBe(true)
    const { jobId } = payload<{ jobId: string }>(start)
    expect(jobId).toMatch(/^job-/)

    let out = payload<{ output: string; running: boolean }>(await run('shell.output', { jobId, wait: 500 }))
    for (let i = 0; i < 20 && !out.output.includes('first'); i++) {
      const more = payload<{ output: string; running: boolean }>(await run('shell.output', { jobId, wait: 200 }))
      out = { ...more, output: out.output + more.output }
    }
    expect(out.running).toBe(true)
    expect(out.output).toContain('first')
    const grandchild = Number(out.output.match(/child (\d+)/)?.[1])
    expect(alive(grandchild)).toBe(true)
    // 增量：第二次读不再重复已经给过的输出
    const again = payload<{ output: string }>(await run('shell.output', { jobId }))
    expect(again.output).not.toContain('first')

    const k = payload<{ killed: boolean }>(await run('shell.kill', { jobId }))
    expect(k.killed).toBe(true)
    const after = payload<{ running: boolean }>(await run('shell.output', { jobId }))
    expect(after.running).toBe(false)
    // 进程组已回收：孙进程也没了
    for (let i = 0; i < 20 && alive(grandchild); i++) await Bun.sleep(50)
    expect(alive(grandchild)).toBe(false)
  }, 20_000)

  test('前台输出超过上限：截断，全文落到文件并在结果里给出路径', async () => {
    const d = tmp()
    const { run } = registry(d)
    const bytes = SHELL_MAX_OUTPUT_BYTES + 50_000
    const r = payload<{ stdout?: string; fullOutput?: string; truncated?: unknown }>(
      await run('shell.exec', { cmd: `head -c ${bytes} /dev/zero | tr '\\0' 'x'` }),
    )
    expect(r.fullOutput).toBeDefined()
    expect(existsSync(r.fullOutput as string)).toBe(true)
    // 日志文件除了输出本身还带一小段抬头（命令、流名）
    expect(readFileSync(r.fullOutput as string, 'utf8')).toContain(`--- stdout ---\n${'x'.repeat(bytes)}\n`)
    expect(JSON.stringify(r).length).toBeLessThan(bytes)
  }, 20_000)

  test('后台输出超过上限：同样截断，全文在 job 日志里', async () => {
    const d = tmp()
    const { run } = registry(d)
    const bytes = SHELL_MAX_OUTPUT_BYTES + 50_000
    const { jobId } = payload<{ jobId: string }>(
      await run('shell.exec', { cmd: `head -c ${bytes} /dev/zero | tr '\\0' 'y'`, background: true }),
    )
    const out = payload<{ running: boolean; output: string; fullOutput?: string; truncated?: { totalBytes: number } }>(
      await run('shell.output', { jobId, wait: 10_000 }),
    )
    expect(out.running).toBe(false)
    expect(out.truncated?.totalBytes).toBe(bytes)
    expect(out.output.length).toBeLessThan(bytes)
    expect(readFileSync(out.fullOutput as string, 'utf8').length).toBe(bytes)
  }, 20_000)
})

describe('PRD-M7-001 AC-6 · 新工具不新增能力类别', () => {
  test('能力归属：edit → fs.write；glob / grep / 输出查询 → fs.read；终止 → shell.exec', () => {
    expect(fsEdit.capability).toBe('fs.write')
    expect(fsGlob.capability).toBe('fs.read')
    expect(fsGrep.capability).toBe('fs.read')
    const jobs = new JobTable()
    expect(makeShellOutputTool(jobs).capability).toBe('fs.read')
    expect(makeShellKillTool(jobs).capability).toBe('shell.exec')
  })

  test('现有规则不改一行即生效：只放行 fs.read 时，读类新工具能用，edit / kill 被同一条规则拒', async () => {
    const d = gitRepo()
    writeFileSync(join(d, 'a.ts'), 'a\n')
    const readOnly: Rule[] = [{ name: 'allow-read', capability: 'fs.read', decision: 'allow' }]
    const { run } = registry(d, readOnly)
    expect((await run('fs.glob', { pattern: '*.ts' })).ok).toBe(true)
    expect((await run('fs.grep', { pattern: 'a' })).ok).toBe(true)
    await run('fs.read', { path: 'a.ts' })
    const edit = await run('fs.edit', { path: 'a.ts', old: 'a', new: 'b' })
    expect(edit.ok).toBe(false)
    expect(events(edit).find((e) => e.t === 'permission')).toMatchObject({ capabilityId: 'fs.write', decision: 'deny' })
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('a\n')
    const kill = await run('shell.kill', { jobId: 'job-1' })
    expect(events(kill).find((e) => e.t === 'permission')).toMatchObject({
      capabilityId: 'shell.exec',
      decision: 'deny',
    })
  })

  test('deny fs.read 的规则同样挡住 glob / grep / 输出查询（没有绕过的新类别）', async () => {
    const d = gitRepo()
    const rules: Rule[] = [
      { name: 'no-read', capability: 'fs.read', decision: 'deny' },
      { name: 'allow-shell', capability: 'shell.exec', decision: 'allow' },
    ]
    const { run } = registry(d, rules)
    const { jobId } = payload<{ jobId: string }>(await run('shell.exec', { cmd: 'echo hi', background: true }))
    for (const [name, args] of [
      ['fs.glob', { pattern: '*' }],
      ['fs.grep', { pattern: 'x' }],
      ['shell.output', { jobId }],
    ] as const) {
      const r = await run(name, args)
      expect(r.ok).toBe(false)
      expect(events(r).find((e) => e.t === 'permission')).toMatchObject({
        capabilityId: 'fs.read',
        matchedRule: 'no-read',
      })
    }
  })
})

describe('BUG-M7-003 · 截断时把中段里的失败 / 报错行摘出来（PRD-M7-004 AC-4）', () => {
  test('常见测试框架的失败行与报错位置都认得，普通行不认', () => {
    const lines = [
      '(fail) 加法 > 进位 [3ms]',
      'FAIL src/a.test.ts > add',
      ' ✗ should work',
      '    at Object.<anonymous> (src/add.ts:12:5)',
      'src/add.ts:12:5 - error TS2322: Type',
      'error[E0308]: mismatched types',
      '  --> src/main.rs:4:9',
      '  File "app/x.py", line 3, in f',
      'E       AssertionError: 1 != 2',
      "thread 'main' panicked at src/lib.rs:2:5",
      'pass 这一行是普通输出',
      '✓ ok 1',
    ]
    expect(keyLines(lines.join('\n'))).toEqual(lines.slice(0, 10))
  })

  test('中段的失败行进结果；没有失败行时与原来一样只有头尾；超长单行不拖慢', () => {
    const pad = 'p'.repeat(SHELL_MAX_OUTPUT_BYTES)
    const r = truncateOutput(`${pad}\n(fail) 中间挂了\n    at src/x.ts:1:2\n${pad}`)
    expect(r.text).toContain('(fail) 中间挂了')
    expect(r.text).toContain('src/x.ts:1:2')
    expect(Buffer.byteLength(r.text)).toBeLessThan(SHELL_MAX_OUTPUT_BYTES)
    expect(truncateOutput(`${pad}${pad}`).text).not.toContain('像失败')
    const t0 = performance.now()
    truncateOutput('a'.repeat(SHELL_MAX_OUTPUT_BYTES * 5))
    expect(performance.now() - t0).toBeLessThan(500)
  })
})
