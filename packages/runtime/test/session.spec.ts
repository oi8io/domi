/**
 * PRD-M0-005 AC-3 · 退出前 flush，退出后重放不丢最后一轮
 * 以及 DomiSession 这层门面本身的行为（权限询问、事件推送）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { z } from 'zod'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-session-'))
  dirs.push(d)
  return d
}

const config = ConfigSchema.parse({
  model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
  permissions: { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
})

const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

describe('PRD-M0-005 AC-3 · 退出前 flush', () => {
  test('flushAndClose 之后重开数据库，最后一轮一条不少', async () => {
    const cwd = tmp()
    const db = join(tmp(), 'e.db')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: db,
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '最后一轮的回答' }]]),
    })
    const seen: EventEnvelope[] = []
    s.on('onEvents', (e) => seen.push(...e))

    await s.submit('最后一轮的提问')
    await s.flushAndClose()

    // 重开 —— 相当于进程被 Ctrl+C 之后再启动
    const reopened = new SqliteEventLog({ path: db })
    const replayed = await reopened.read('s1')
    reopened.close()

    const texts = JSON.stringify(replayed)
    expect(texts).toContain('最后一轮的提问')
    expect(texts).toContain('最后一轮的回答')
    expect(replayed.map((e) => e.seq)).toEqual(replayed.map((_, i) => i + 1))
    // 订阅者看到的和磁盘上的是同一批
    expect(seen.map((e) => e.seq)).toEqual(replayed.map((e) => e.seq))
  }, 15_000)
})

describe('DomiSession 的权限询问', () => {
  test('ask 会推给订阅者，回答 y 之后工具才真的执行', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), '旧', 'utf8')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: join(tmp(), 'e.db'),
      clock,
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: '新' } }],
        [{ type: 'delta', text: '写好了' }],
      ]),
    })

    const asks: Array<PendingAsk | null> = []
    s.on('onAsk', (a) => {
      asks.push(a)
      a?.answer(true)
    })

    await s.submit('改一下 a.txt')
    await s.flushAndClose()

    expect(asks.filter(Boolean)).toHaveLength(1)
    expect(asks.filter(Boolean)[0]?.capabilityId).toBe('fs.write')
    // 回答完要清掉，否则确认框会一直挂在屏幕上
    expect(asks.at(-1)).toBeNull()
    expect(await Bun.file(join(cwd, 'a.txt')).text()).toBe('新')
  }, 15_000)

  test('没有人订阅 onAsk 时直接拒绝，不是放行（非交互环境的立场）', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), '旧', 'utf8')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: join(tmp(), 'e.db'),
      clock,
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: '新' } }],
        [{ type: 'delta', text: '好的' }],
      ]),
    })
    await s.submit('改一下')
    await s.flushAndClose()
    expect(await Bun.file(join(cwd, 'a.txt')).text()).toBe('旧')
  }, 15_000)
})

describe('外部工具（MCP）接进会话 —— PRD-M2-001 · ADR-015', () => {
  const echoTool = {
    name: 'mcp.demo.echo',
    capability: 'mcp.demo.echo',
    description: '[MCP demo] echo',
    schema: z.object({ text: z.string() }),
    execute: async (args: { text: string }) => ({ content: [{ type: 'text', text: `echo:${args.text}` }] }),
  }

  function withTools(opts: {
    rules: Array<{ name: string; capability: string; decision: 'allow' | 'deny' | 'ask' }>
    tools: () => unknown[]
    notices?: () => string[]
  }) {
    return new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: opts.rules },
      }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      clock,
      extraTools: opts.tools as never,
      ...(opts.notices ? { notices: opts.notices } : {}),
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'mcp.demo.echo', args: { text: 'hi' } }],
        [{ type: 'delta', text: '好了' }],
      ]),
    })
  }

  test('外部工具走同一条权限路径：通配规则放行后才执行', async () => {
    const s = withTools({
      rules: [{ name: 'demo-all', capability: 'mcp.demo.*', decision: 'allow' }],
      tools: () => [echoTool],
    })
    await s.submit('调一下')
    const events = await s.pumpAll()
    const perm = events.find((e) => e.ev.t === 'permission')?.ev
    expect(perm).toMatchObject({ capabilityId: 'mcp.demo.echo', decision: 'allow', matchedRule: 'demo-all' })
    expect(JSON.stringify(events.find((e) => e.ev.t === 'tool.result')?.ev)).toContain('echo:hi')
    await s.flushAndClose()
  })

  test('没有规则就默认拒绝（INV-03）', async () => {
    const s = withTools({ rules: [], tools: () => [echoTool] })
    await s.submit('调一下')
    const res = (await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev as { ok: boolean; reason: string }
    expect(res).toMatchObject({ ok: false, reason: 'permission_denied' })
    await s.flushAndClose()
  })

  test('工具是每轮现取的：会话建好之后才连上的 server 也能用上', async () => {
    let ready: unknown[] = []
    const s = withTools({ rules: [{ name: 'a', capability: 'mcp.demo.*', decision: 'allow' }], tools: () => ready })
    ready = [echoTool]
    await s.submit('调一下')
    expect(JSON.stringify(await s.pumpAll())).toContain('echo:hi')
    await s.flushAndClose()
  })

  test('连不上的 server 在会话里留一条 error 事件，每条只留一次', async () => {
    const notices = ['MCP server gh 不可用：连接超时']
    const s = withTools({ rules: [], tools: () => [], notices: () => notices })
    await s.submit('第一轮')
    notices.push('MCP server web 不可用：主机不在白名单')
    await s.submit('第二轮')
    const errors = (await s.pumpAll()).filter((e) => e.ev.t === 'error' && (e.ev as { scope: string }).scope === 'mcp')
    expect(errors.map((e) => (e.ev as { message: string }).message)).toEqual([
      'MCP server gh 不可用：连接超时',
      'MCP server web 不可用：主机不在白名单',
    ])
    await s.flushAndClose()
  })
})
