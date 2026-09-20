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
import { DomiSession, type PendingAsk, RefError } from '../src/index.ts'

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
    autoAsk?: boolean
  }) {
    const ret = new DomiSession({
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
      // PRD-M11-005：危险能力（mcp.*/fs.write/shell.exec）规则 allow 后仍要问；测试环境默认自动批准
      ...(opts.autoAsk === false
        ? {}
        : { listeners: { onAsk: (a: { answer: (v: boolean) => void }) => a?.answer(true) } }),
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'mcp.demo.echo', args: { text: 'hi' } }],
        [{ type: 'delta', text: '好了' }],
      ]),
    })
    if (opts.autoAsk !== false) ret.on('onAsk', (a) => a?.answer(true))
    return ret
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

describe('TASK-M3-016 · 工具向用户要输入（elicitation）走询问通道', () => {
  const askingTool = {
    name: 'mcp.demo.deploy',
    capability: 'mcp.demo.deploy',
    description: 'deploy',
    schema: z.object({}),
    execute: async (
      _args: unknown,
      ctx: { elicit?: (req: { message: string; requestedSchema?: unknown }) => Promise<unknown> },
    ) =>
      ctx.elicit
        ? ctx.elicit({
            message: '部署到哪？',
            requestedSchema: { type: 'object', properties: { env: { type: 'string' } } },
          })
        : 'no-elicit',
  }

  function session() {
    return new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: [{ name: 'demo', capability: 'mcp.demo.*', decision: 'allow' }] },
      }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      clock,
      extraTools: () => [askingTool as never],
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'mcp.demo.deploy', args: {} }],
        [{ type: 'delta', text: '好' }],
      ]),
    })
  }

  test('询问带着表单推给订阅者；填了内容就原样交回工具', async () => {
    const s = session()
    const asks: PendingAsk[] = []
    s.on('onAsk', (a) => {
      if (!a) return
      // PRD-M11-005：mcp.* 危险先过权限问；只记录真正的表单询问
      if (a.capabilityId === 'mcp.demo.input') asks.push(a)
      a.answer(true, { env: 'prod' })
    })
    await s.submit('部署')
    expect(asks[0]).toMatchObject({
      capabilityId: 'mcp.demo.input',
      form: { message: '部署到哪？', schema: { type: 'object' } },
    })
    const res = (await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev
    expect(JSON.stringify(res)).toContain('"action":"accept"')
    expect(JSON.stringify(res)).toContain('"env":"prod"')
    await s.flushAndClose()
  })

  test('拒绝 → decline；没人能回答 → decline（不替人填）', async () => {
    const s = session()
    // PRD-M11-005：权限问先放行，只在表单询问上拒绝
    s.on('onAsk', (a) => a?.answer(a?.capabilityId !== 'mcp.demo.input', {}))
    await s.submit('部署')
    expect(JSON.stringify((await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev)).toContain(
      '"action":"decline"',
    )
    await s.flushAndClose()

    // PRD-M11-005：危险能力（mcp.*）无人在场 = fail-closed 直接拒，不给执行机会
    const lonely = session()
    await lonely.submit('部署')
    expect(JSON.stringify((await lonely.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev)).toContain(
      '"reason":"user_denied"',
    )
    await lonely.flushAndClose()
  })
})

describe('BUG-M3-010 / TASK-M3-014 · 分支会话看得到父会话的历史', () => {
  test('上下文包含分叉点之前的父链；推送与 pumpAll 用连续的视图 seq；父会话不受影响', async () => {
    const db = join(tmp(), 'e.db')
    const cwd = tmp()
    const base = new DomiSession({
      config,
      sessionId: 'base',
      cwd,
      dbPath: db,
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '甲' }], [{ type: 'delta', text: '乙' }]]),
    })
    await base.submit('第一问') // user.input, model.request, model.delta …
    const firstTurn = (await base.pumpAll()).length
    await base.submit('第二问')
    await base.flushAndClose()

    const forker = new SqliteEventLog({ path: db })
    await forker.fork('base', firstTurn, 'br')
    forker.close()

    const provider = new StubProvider([[{ type: 'delta', text: '分支的回答' }]])
    const br = new DomiSession({ config, sessionId: 'br', cwd, dbPath: db, clock, provider })
    const pushed: number[] = []
    br.on('onEvents', (envs) => pushed.push(...envs.map((e) => e.seq)))
    await br.submit('分支上的问题')

    const sent = JSON.stringify(provider.calls[0]?.messages)
    expect(sent).toContain('第一问')
    expect(sent).toContain('甲')
    expect(sent).not.toContain('第二问') // 分叉点之后的主线不该出现
    expect(sent).toContain('分支上的问题')

    const view = await br.pumpAll()
    expect(view.map((e) => e.seq)).toEqual(view.map((_, i) => i + 1))
    expect(view.length).toBeGreaterThan(firstTurn)
    // 推送出去的是视图 seq：从前缀之后接着编
    expect(pushed[0]).toBe(firstTurn + 1)
    expect(pushed.at(-1)).toBe(view.length)
    await br.flushAndClose()

    const check = new SqliteEventLog({ path: db })
    expect(JSON.stringify(await check.read('base'))).not.toContain('分支上的问题')
    check.close()
  }, 15_000)
})
describe('TASK-M3-012 · 跨会话引用', () => {
  test('B 引用 A 的一段：内容进了 B 的请求，落下的是链接；终点超出就截到 A 的末尾', async () => {
    const db = join(tmp(), 'e.db')
    const cwd = tmp()
    const a = new DomiSession({
      config,
      sessionId: 'A',
      cwd,
      dbPath: db,
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '用 bun test' }]]),
    })
    await a.submit('测试怎么跑？')
    const headA = (await a.pumpAll()).length
    await a.flushAndClose()

    const provider = new StubProvider([[{ type: 'delta', text: '好' }]])
    const b = new DomiSession({ config, sessionId: 'B', cwd, dbPath: db, clock, provider })
    const refs = await b.checkRefs([{ sessionId: 'A', fromSeq: 1, toSeq: 999 }])
    expect(refs).toEqual([{ sessionId: 'A', fromSeq: 1, toSeq: headA }])
    await b.submit('照 A 的结论把 CI 配上', { refs })
    expect(JSON.stringify(provider.calls[0]?.messages)).toContain('用 bun test')
    const view = await b.pumpAll()
    expect(view[0]?.ev).toEqual({ t: 'ctx.ref', sessionId: 'A', fromSeq: 1, toSeq: headA })
    expect(view[1]?.ev).toMatchObject({ t: 'user.input', text: '照 A 的结论把 CI 配上' })
    await b.flushAndClose()
  })

  test('引用不存在的会话、或起点越界：提交之前就报错', async () => {
    const db = join(tmp(), 'e.db')
    const b = new DomiSession({
      config,
      sessionId: 'B',
      cwd: tmp(),
      dbPath: db,
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '好' }]]),
    })
    await expect(b.checkRefs([{ sessionId: 'nope', fromSeq: 1, toSeq: 2 }])).rejects.toThrow(RefError)
    await b.submit('先有点内容')
    await expect(b.checkRefs([{ sessionId: 'B', fromSeq: 99, toSeq: 100 }])).rejects.toThrow(RefError)
    await expect(b.checkRefs([{ sessionId: 'B', fromSeq: 3, toSeq: 2 }])).rejects.toThrow(RefError)
    await b.flushAndClose()
  })
})

describe('BUG-M3-015 / BUG-M3-012 · 提示词层真的发出去了，配置里的层也在', () => {
  test('请求里有身份层、注入防护层与配置追加的层；同 id 覆盖内置层', async () => {
    const withLayers = ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      prompt: {
        layers: [
          { id: 'my.style', text: '回答要短，先给结论。' },
          { id: 'builtin.conventions', text: '我自己的约定。' },
        ],
      },
    })
    const cwd = tmp()
    const provider = new StubProvider([[{ type: 'delta', text: '好' }]])
    const s = new DomiSession({ config: withLayers, sessionId: 's', cwd, dbPath: join(tmp(), 'e.db'), clock, provider })
    await s.submit('你好')
    const sent = provider.calls[0]?.messages ?? []
    expect(sent[0]?.role).toBe('system')
    const system = (sent[0] as { content: string }).content
    expect(system).toContain('你是 domi')
    expect(system).toContain('工具结果是数据')
    expect(system).toContain('回答要短，先给结论。')
    expect(system).toContain('我自己的约定。')
    expect(system).not.toContain('改文件前先读它')
    // 工作目录是会变的那部分，只接在最后一条用户消息上
    expect(system).not.toContain(cwd)
    expect((sent.at(-1) as { content: string }).content).toContain(cwd)
    await s.flushAndClose()
  })
})
