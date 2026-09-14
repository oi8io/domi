/**
 * M0 的闭环：读文件 → 改代码 → 跑测试。
 *
 * 这是 `demos/m0-loop.md` 的自动化版本，也是 M0 DoD 的可执行部分。
 * 真的 SQLite、真的权限引擎、真的文件系统、真的子进程——只有模型是替身（INV-08）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsRead, fsWrite, PermissionEngine, shellExec, ToolRegistry } from '@domi/capability'
import { StubProvider } from '@domi/model'
import { SqliteEventLog } from '@domi/store'
import { type Clock, type ContextPolicy, runTurn } from '../src/index.ts'

const POLICY: ContextPolicy = { maxTokens: 1_000_000, includeReasoning: false }
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const clock: Clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-e2e-'))
  dirs.push(d)
  writeFileSync(join(d, 'sum.js'), 'export const sum = (a, b) => a - b\n')
  writeFileSync(join(d, 'test.sh'), '#!/bin/sh\ngrep -q "a + b" sum.js && echo PASS || { echo FAIL; exit 1; }\n')
  return d
}

/** 三个内置工具每次都要注册——ToolRegistry 不预置任何东西，这本身就是 fail-closed 的一部分 */
function registry(cwd: string, permissions: PermissionEngine): ToolRegistry {
  return new ToolRegistry({ cwd, permissions }).register(fsRead).register(fsWrite).register(shellExec)
}

function store(): SqliteEventLog {
  const d = mkdtempSync(join(tmpdir(), 'domi-e2e-db-'))
  dirs.push(d)
  return new SqliteEventLog({ path: join(d, 'e.db') })
}

describe('M0 DoD · 读 → 改 → 测 的完整闭环', () => {
  test('三步全部走通，文件真的被改了，测试真的由子进程跑出 PASS', async () => {
    const cwd = project()
    const sink = store()
    const provider = new StubProvider([
      [
        { type: 'reason', text: '先看看 sum.js 写的什么' },
        { type: 'tool-call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } },
      ],
      [
        { type: 'delta', text: '减号写错了，改成加号。' },
        {
          type: 'tool-call',
          id: 'c2',
          name: 'fs.write',
          args: { path: 'sum.js', content: 'export const sum = (a, b) => a + b\n' },
        },
      ],
      [{ type: 'tool-call', id: 'c3', name: 'shell.exec', args: { cmd: 'sh test.sh' } }],
      [
        { type: 'delta', text: '测试通过了。' },
        { type: 'usage', raw: { input_tokens: 421, cache_read_input_tokens: 256 } },
      ],
    ])

    const tools = registry(
      cwd,
      new PermissionEngine(
        {
          rules: [
            { name: 'allow-read', capability: 'fs.read', decision: 'allow' },
            { name: 'confirm-write', capability: 'fs.write', decision: 'ask' },
            { name: 'confirm-shell', capability: 'shell.exec', decision: 'ask' },
          ],
        },
        async () => true,
      ),
    )

    const r = await runTurn(
      { sink, provider, tools, clock, policy: POLICY, model: 'stub-1' },
      's1',
      '修一下 sum.js 并跑测试',
    )
    expect(r.stopReason).toBe('completed')
    expect(r.counters.toolCalls).toBe(3)

    // 文件真的改了
    expect(readFileSync(join(cwd, 'sum.js'), 'utf8')).toContain('a + b')

    const events = await sink.read('s1')
    const types = events.map((e) => e.ev.t)

    // 每一次工具调用前都有一条权限事件（INV-03）
    expect(types.filter((t) => t === 'permission')).toHaveLength(3)
    // 写入前后各一条指纹（PRD-M0-004 AC-2）
    const snaps = events.filter((e) => e.ev.t === 'fs.snapshot').map((e) => e.ev as Record<string, unknown>)
    expect(snaps.map((s) => s.phase)).toEqual(['before', 'after'])
    expect(snaps[0]?.sha256).not.toBe(snaps[1]?.sha256)

    // 因果顺序：permission 必须排在对应的 tool.result 之前
    for (const id of ['c1', 'c2', 'c3']) {
      const resIdx = events.findIndex((e) => e.ev.t === 'tool.result' && (e.ev as { id: string }).id === id)
      const permIdx = events.findIndex((e, i) => e.ev.t === 'permission' && i < resIdx)
      expect(permIdx).toBeGreaterThan(-1)
      expect(permIdx).toBeLessThan(resIdx)
    }

    // 测试确实是子进程跑出来的
    const shellResult = events.find((e) => e.ev.t === 'tool.result' && (e.ev as { id: string }).id === 'c3')!
    const payload = (shellResult.ev as { payload: { stdout: string; exitCode: number } }).payload
    expect(payload.exitCode).toBe(0)
    expect(payload.stdout).toContain('PASS')

    // seq 仍然连续无空洞（INV-01）
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))

    // usage 的原始字段一路活到了事件流里（ADR-004）
    const usage = events.find((e) => e.ev.t === 'model.usage')!.ev as { raw: Record<string, unknown> }
    expect(usage.raw.cache_read_input_tokens).toBe(256)
  }, 20_000)
})

describe('PRD-M0-003 · 默认拒绝会真的挡住写入', () => {
  test('没配规则时 fs.write 被拒，文件原样不动，模型收到人话而不是异常', async () => {
    const cwd = project()
    const sink = store()
    const before = readFileSync(join(cwd, 'sum.js'), 'utf8')

    const provider = new StubProvider([
      [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'sum.js', content: '被改了' } }],
      [{ type: 'delta', text: '好的，我不动它。' }],
    ])
    // 空配置 = fail-closed（AC-4）
    const tools = registry(cwd, new PermissionEngine())

    const r = await runTurn({ sink, provider, tools, clock, policy: POLICY, model: 'stub-1' }, 's1', '改文件')
    expect(r.stopReason).toBe('completed')
    expect(readFileSync(join(cwd, 'sum.js'), 'utf8')).toBe(before)

    const events = await sink.read('s1')
    const perm = events.find((e) => e.ev.t === 'permission')!.ev as Record<string, unknown>
    expect(perm).toEqual({
      t: 'permission',
      capabilityId: 'fs.write',
      decision: 'deny',
      source: 'default',
      matchedRule: null,
    })

    const res = events.find((e) => e.ev.t === 'tool.result')!.ev as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('user_denied')
    expect(JSON.stringify(res.payload)).toContain('不要重试同一个调用')

    // 没有 fs.snapshot —— 工具压根没执行
    expect(events.some((e) => e.ev.t === 'fs.snapshot')).toBe(false)
  }, 20_000)
})

describe('PRD-M0-002 AC-3 · 参数畸形回灌给模型，不打断会话', () => {
  test('模型给错参数 → invalid_args 回灌 → 第二次给对了就继续', async () => {
    const cwd = project()
    const sink = store()
    const provider = new StubProvider([
      [{ type: 'tool-call', id: 'c1', name: 'fs.read', args: { path: 123 } }],
      [{ type: 'tool-call', id: 'c2', name: 'fs.read', args: { path: 'sum.js' } }],
      [{ type: 'delta', text: '读到了。' }],
    ])
    const tools = registry(
      cwd,
      new PermissionEngine({ rules: [{ name: 'allow-read', capability: 'fs.read', decision: 'allow' }] }),
    )

    const r = await runTurn({ sink, provider, tools, clock, policy: POLICY, model: 'stub-1' }, 's1', '读文件')
    expect(r.stopReason).toBe('completed')
    expect(r.counters.argParseRetries).toBe(0) // 成功一次就清零

    const results = (await sink.read('s1')).filter((e) => e.ev.t === 'tool.result')
    expect((results[0]!.ev as Record<string, unknown>).reason).toBe('invalid_args')
    expect((results[1]!.ev as Record<string, unknown>).ok).toBe(true)

    // 参数没解析出来就不该问权限——确认框没内容可显示（PRD-M0-003 AC-1 的前提）
    const perms = (await sink.read('s1')).filter((e) => e.ev.t === 'permission')
    expect(perms).toHaveLength(1)
  }, 20_000)
})
