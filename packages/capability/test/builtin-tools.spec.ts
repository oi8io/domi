/**
 * PRD-M0-004 · 三个内置工具（AC-1~4）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DomiEvent, estimateTextTokens } from '@domi/protocol'
import {
  FS_READ_DEFAULT_MAX_LINES,
  fsRead,
  fsWrite,
  SHELL_MAX_INLINE_TOKENS,
  shellExec,
  type ToolCtx,
  truncateOutput,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function ctx(): ToolCtx & { events: DomiEvent[] } {
  const d = mkdtempSync(join(tmpdir(), 'domi-tools-'))
  dirs.push(d)
  const events: DomiEvent[] = []
  return {
    cwd: d,
    signal: new AbortController().signal,
    events,
    outputDir: join(d, 'out'),
    emit: (e) => {
      events.push(e)
    },
  }
}

describe('PRD-M0-004 AC-1 · fs.read', () => {
  test('支持行范围', async () => {
    const c = ctx()
    writeFileSync(join(c.cwd, 'a.txt'), ['一', '二', '三', '四', '五'].join('\n'))
    const r = await fsRead.execute({ path: 'a.txt', fromLine: 2, toLine: 4 }, c)
    expect(r.content).toBe('二\n三\n四')
    expect(r.totalLines).toBe(5)
    expect(r.returnedRange).toEqual({ from: 2, to: 4 })
    expect(r.truncated).toBeUndefined()
  })

  test('M15-009 AC-2 · 不带行范围时默认最多 2000 行，给「共几行 / fromLine/toLine 继续」', async () => {
    const c = ctx()
    const lines = 2500
    writeFileSync(join(c.cwd, 'big.txt'), Array.from({ length: lines }, () => 'x').join('\n'))

    const r = await fsRead.execute({ path: 'big.txt' }, c)
    expect(r.truncated).toBeDefined()
    expect(r.truncated?.reason).toBe('line_limit')
    expect(r.totalLines).toBe(lines)
    expect(r.returnedRange.to).toBe(FS_READ_DEFAULT_MAX_LINES)
    expect(r.content.split('\n').length).toBe(FS_READ_DEFAULT_MAX_LINES)
    expect(r.truncated?.hint).toContain('fromLine/toLine 继续')
  })

  test('M15-009 AC-2 · 带行范围时按范围精确返回，不再整篇 1MB', async () => {
    const c = ctx()
    const lines = 2500
    writeFileSync(join(c.cwd, 'big.txt'), Array.from({ length: lines }, (_, i) => `行${i + 1}`).join('\n'))

    const r = await fsRead.execute({ path: 'big.txt', fromLine: 2000, toLine: 2500 }, c)
    expect(r.truncated).toBeUndefined()
    expect(r.content.split('\n').length).toBe(501)
    expect(r.returnedRange).toEqual({ from: 2000, to: 2500 })
  })

  test('M15-009 AC-2 · 小文件不带范围仍返回全文，无 truncated', async () => {
    const c = ctx()
    writeFileSync(join(c.cwd, 'small.txt'), '一\n二\n三')
    const r = await fsRead.execute({ path: 'small.txt' }, c)
    expect(r.truncated).toBeUndefined()
    expect(r.content).toBe('一\n二\n三')
  })

  test('越界路径被拒（走的是同一个 resolveWithinRoot）', async () => {
    const c = ctx()
    await expect(fsRead.execute({ path: '../../etc/passwd' }, c)).rejects.toThrow(/路径越界/)
  })
})

describe('PRD-M0-004 AC-2 · fs.write 前后各一条含 SHA-256 的事件', () => {
  test('新建文件：before 的 sha256 为 null', async () => {
    const c = ctx()
    const r = await fsWrite.execute({ path: 'new.txt', content: '你好' }, c)
    expect(r.created).toBe(true)
    expect(readFileSync(join(c.cwd, 'new.txt'), 'utf8')).toBe('你好')

    expect(c.events).toHaveLength(2)
    const [before, after] = c.events as Array<Record<string, unknown>>
    expect(before).toEqual({ t: 'fs.snapshot', path: 'new.txt', phase: 'before', sha256: null, bytes: 0 })
    expect(after?.phase).toBe('after')
    expect(after?.sha256).toBe(r.sha256)
    expect(after?.bytes).toBe(Buffer.byteLength('你好', 'utf8'))
  })

  test('覆盖已有文件：两条指纹不同，据此可重建 diff', async () => {
    const c = ctx()
    writeFileSync(join(c.cwd, 'a.txt'), '旧内容')
    await fsWrite.execute({ path: 'a.txt', content: '新内容' }, c)
    const [before, after] = c.events as Array<Record<string, unknown>>
    expect(before?.sha256).not.toBeNull()
    expect(before?.sha256).not.toBe(after?.sha256)
  })

  test('自动建父目录，但仍不得越界', async () => {
    const c = ctx()
    await fsWrite.execute({ path: 'deep/nested/x.txt', content: 'ok' }, c)
    expect(existsSync(join(c.cwd, 'deep/nested/x.txt'))).toBe(true)
    await expect(fsWrite.execute({ path: '../escape.txt', content: 'no' }, c)).rejects.toThrow(/路径越界/)
  })
})

describe('PRD-M0-004 AC-3 · shell.exec 超时杀掉整个进程组', () => {
  test('正常命令返回退出码与输出', async () => {
    const c = ctx()
    const r = await shellExec.execute({ cmd: 'echo hello && echo oops >&2' }, c)
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('hello')
    expect(r.stderr.trim()).toBe('oops')
    expect(r.timedOut).toBe(false)
  })

  test('非零退出码如实返回，不当成异常', async () => {
    const c = ctx()
    expect((await shellExec.execute({ cmd: 'exit 3' }, c)).exitCode).toBe(3)
  })

  test('超时后子进程确实不存在了', async () => {
    const c = ctx()
    const pidFile = join(c.cwd, 'pid')
    const r = await shellExec.execute({ cmd: `echo $$ > ${pidFile}; sleep 30`, timeoutMs: 300 }, c)
    expect(r.timedOut).toBe(true)

    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(Number.isFinite(pid)).toBe(true)
    await new Promise((res) => setTimeout(res, 100))
    // kill(pid, 0) 只探测存在性；进程还在就不会抛
    expect(() => process.kill(pid, 0)).toThrow()
  }, 10_000)
})

describe('PRD-M0-004 AC-4 · 输出截断（M15-009 AC-1：内联上限按 token，默认 8k）', () => {
  test('超过 8k token 保留头尾，标记省略量与总量（token 口径）', () => {
    const s = 'a'.repeat(SHELL_MAX_INLINE_TOKENS * 20)
    const r = truncateOutput(s)
    expect(r.totalTokens).toBeGreaterThan(SHELL_MAX_INLINE_TOKENS)
    expect(r.omitted).toBeGreaterThan(0)
    expect(r.text).toContain('已省略')
    expect(estimateTextTokens(r.text)).toBeLessThan(SHELL_MAX_INLINE_TOKENS)
  })

  test('不超阈值时原样返回', () => {
    const r = truncateOutput('短输出')
    expect(r.omitted).toBe(0)
    expect(r.text).toBe('短输出')
  })

  test('真实命令的大输出会被标记 truncated', async () => {
    const c = ctx()
    const r = await shellExec.execute({ cmd: `head -c 200000 /dev/zero | tr '\\0' 'a'` }, c)
    expect(r.truncated).toBeDefined()
    expect(r.truncated?.omittedBytes).toBeGreaterThan(0)
    expect(r.fullOutput).toBeDefined()
  }, 10_000)
})

describe('Tool 可以直接给出 JSON Schema（MCP 工具的 schema 本来就是 JSON Schema）', () => {
  test('给了 inputJsonSchema 时，发给模型的就是它，原样不动', async () => {
    const { ToolRegistry, PermissionEngine } = await import('../src/index.ts')
    const { z } = await import('zod')
    const original = {
      type: 'object',
      properties: { q: { type: 'string', description: '查询词', 'x-vendor': 1 } },
      required: ['q'],
    }
    const reg = new ToolRegistry({ cwd: '/tmp', permissions: new PermissionEngine() }).register({
      name: 'mcp.demo.search',
      capability: 'mcp.demo.search',
      description: 'demo',
      schema: z.object({ q: z.string() }),
      inputJsonSchema: original,
      execute: async () => null,
    })
    expect(reg.schemas()[0]?.inputSchema).toEqual(original)
  })
})
