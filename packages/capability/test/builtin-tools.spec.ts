/**
 * PRD-M0-004 · 三个内置工具（AC-1~4）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent } from '@domi/protocol'
import {
  FS_READ_MAX_BYTES,
  fsRead,
  fsWrite,
  SHELL_MAX_OUTPUT_BYTES,
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

  test('超过 1MB 不返回全文，给出总行数与已返回范围', async () => {
    const c = ctx()
    const line = 'x'.repeat(100)
    const lines = Math.ceil((FS_READ_MAX_BYTES + 1000) / (line.length + 1))
    writeFileSync(join(c.cwd, 'big.txt'), Array.from({ length: lines }, () => line).join('\n'))

    const r = await fsRead.execute({ path: 'big.txt' }, c)
    expect(r.truncated).toBeDefined()
    expect(r.truncated?.reason).toBe('file_too_large')
    expect(r.truncated?.totalBytes).toBeGreaterThan(FS_READ_MAX_BYTES)
    expect(r.totalLines).toBe(lines)
    expect(r.returnedRange.to).toBeLessThan(lines)
    expect(Buffer.byteLength(r.content)).toBeLessThan(FS_READ_MAX_BYTES)
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

describe('PRD-M0-004 AC-4 · 输出超 100KB 头尾截断', () => {
  test('保留头 20KB + 尾 20KB，标记含被省略字节数', () => {
    const total = SHELL_MAX_OUTPUT_BYTES * 3
    const s = 'a'.repeat(total)
    const r = truncateOutput(s)
    expect(r.total).toBe(total)
    expect(r.omitted).toBe(total - 40 * 1024)
    expect(r.text).toContain(`已省略 ${r.omitted} 字节`)
    expect(Buffer.byteLength(r.text)).toBeLessThan(SHELL_MAX_OUTPUT_BYTES)
  })

  test('不超阈值时原样返回', () => {
    const r = truncateOutput('短输出')
    expect(r.omitted).toBe(0)
    expect(r.text).toBe('短输出')
  })

  test('真实命令的大输出会被标记 truncated', async () => {
    const c = ctx()
    const r = await shellExec.execute({ cmd: `head -c ${SHELL_MAX_OUTPUT_BYTES * 2} /dev/zero | tr '\\0' 'a'` }, c)
    expect(r.truncated).toBeDefined()
    expect(r.truncated?.omittedBytes).toBeGreaterThan(0)
  }, 10_000)
})
