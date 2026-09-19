/**
 * PRD-M3-002 AC-1 · 生产宿主把 DomiSession 接到 core 上
 *
 * 用 StubProvider 替身，不联网（INV-08）。断言的是接线：
 * 建的会话能列出来、提交后事件经 core 推给订阅者、历史从同一个 SQLite 里读得回来。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope, RpcNotification, RpcResponse } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  }
})

function setup(
  provider = new StubProvider([[{ type: 'delta', text: '好的' }]], { onExhausted: 'repeat-last' }),
  newId: () => string = () => 'sess-1',
) {
  const d = mkdtempSync(join(tmpdir(), 'domi-host-'))
  dirs.push(d)
  const host = createRuntimeHost({
    config: ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      permissions: { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
    }),
    dbPath: join(d, 'events.db'),
    defaultCwd: d,
    provider,
    newId,
  })
  hosts.push(host)
  return { host, daemon: new Daemon(host), dir: d }
}

class Conn implements ClientConn {
  readonly got: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(m: RpcNotification | RpcResponse): void {
    this.got.push(m)
  }
  events(): EventEnvelope[] {
    return this.got
      .filter((m): m is RpcNotification => 'method' in m && m.method === 'session.events')
      .flatMap((m) => (m.params as { events: EventEnvelope[] }).events)
  }
}

let n = 0
const call = (d: Daemon, c: Conn, method: string, params: unknown = {}) =>
  d.handle(c, { jsonrpc: '2.0', id: ++n, method, params })

describe('RuntimeHost', () => {
  test('建会话 → 列得出来', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const created = await call(daemon, c, 'session.create')
    expect(created.result).toEqual({ sessionId: 'sess-1' })
    const listed = await call(daemon, c, 'session.list')
    expect((listed.result as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id)).toEqual(['sess-1'])
  })

  test('提交之后，事件经 core 推给订阅者，seq 连续', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.subscribe', { sessionId: 'sess-1', fromSeq: 0 })
    const r = await call(daemon, c, 'session.submit', { sessionId: 'sess-1', text: '你好' })
    expect(r.result).toEqual({ accepted: true })

    for (let i = 0; i < 100 && !c.events().some((e) => e.ev.t === 'model.delta'); i++) await Bun.sleep(10)
    const seqs = c.events().map((e) => e.seq)
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    expect(c.events().find((e) => e.ev.t === 'user.input')?.ev).toMatchObject({ text: '你好' })
    // 忙闲也推了
    const busy = c.got.filter((m) => 'method' in m && m.method === 'session.busy')
    expect(busy.length).toBeGreaterThan(0)
  })

  test('不存在的会话 → SESSION_NOT_FOUND', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const r = await call(daemon, c, 'session.subscribe', { sessionId: 'nope', fromSeq: 0 })
    expect(r.error?.code).toBe('SESSION_NOT_FOUND')
  })

  test('需要确认的工具：询问推到客户端，允许之后文件才真的写下去', async () => {
    const { daemon, dir } = setup(
      new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'out.txt', content: '来自 Web' } }],
        [{ type: 'delta', text: '写好了' }],
      ]),
    )
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    // 任务的工作目录是 defaultCwd；不给 kind 的空参数是自由会话，在沙盒里写（PRD-M8-004）
    await call(daemon, c, 'session.create', { kind: 'task' })
    await call(daemon, c, 'session.subscribe', { sessionId: 'sess-1', fromSeq: 0 })
    await call(daemon, c, 'session.submit', { sessionId: 'sess-1', text: '写个文件' })

    const asks = () =>
      c.got
        .filter((m): m is RpcNotification => 'method' in m && m.method === 'session.ask')
        .map((m) => m.params as { askId: string; capabilityId: string; detail: string })
    for (let i = 0; i < 100 && asks().length === 0; i++) await Bun.sleep(10)
    const [ask] = asks()
    expect(ask?.capabilityId).toBe('fs.write')
    // 完整内容，不是 80 字符的摘要
    expect(ask?.detail).toContain('来自 Web')
    expect(existsSync(join(dir, 'out.txt'))).toBe(false) // 没答之前什么都没发生

    const r = await call(daemon, c, 'session.answer', { askId: ask?.askId ?? '', allowed: true })
    expect(r.result).toEqual({ ok: true })
    for (let i = 0; i < 100 && !c.events().some((e) => e.ev.t === 'model.delta'); i++) await Bun.sleep(10)
    expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('来自 Web')
  })

  test('指标带着 provider/model 推给订阅者', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.subscribe', { sessionId: 'sess-1', fromSeq: 0 })
    await call(daemon, c, 'session.submit', { sessionId: 'sess-1', text: '你好' })
    const metrics = () => c.got.filter((m): m is RpcNotification => 'method' in m && m.method === 'session.metrics')
    for (let i = 0; i < 100 && metrics().length === 0; i++) await Bun.sleep(10)
    const last = metrics().at(-1)?.params as { metrics: { provider: string; model: string; cost: string } }
    expect(last.metrics.provider).toBe('stub')
    expect(last.metrics.model).toBe('stub-1')
    expect(typeof last.metrics.cost).toBe('string')
  })

  test('删除 / 恢复落到 sessions 表；切换模型追加 model.switch 事件', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.subscribe', { sessionId: 'sess-1', fromSeq: 0 })

    // 端从 model.list 选中的条目带上 provider（PRD-M9-003 AC-5）；只给名字而清单里没有它 → 归属不了
    const unknown = await call(daemon, c, 'session.switchModel', { sessionId: 'sess-1', model: 'stub-2' })
    expect(unknown.error).toMatchObject({ code: 'INVALID_PARAMS', data: { reason: 'MODEL_UNRESOLVED' } })
    const sw = await call(daemon, c, 'session.switchModel', { sessionId: 'sess-1', model: 'stub-2', provider: 'stub' })
    expect(sw.result).toEqual({ lost: [] })
    for (let i = 0; i < 50 && !c.events().some((e) => e.ev.t === 'model.switch'); i++) await Bun.sleep(10)
    expect(c.events().find((e) => e.ev.t === 'model.switch')?.ev).toMatchObject({ from: 'stub-1', to: 'stub-2' })

    await call(daemon, c, 'session.delete', { sessionId: 'sess-1' })
    const listed = await call(daemon, c, 'session.list', { includeDeleted: true })
    expect(listed.result).toMatchObject({ sessions: [{ id: 'sess-1', deleted: true, model: 'stub-2' }] })
    await call(daemon, c, 'session.restore', { sessionId: 'sess-1' })
    expect((await call(daemon, c, 'session.list')).result).toMatchObject({
      sessions: [{ id: 'sess-1', deleted: false }],
    })
  })

  test('TASK-M3-014 · session.branch：新会话带着父链历史，续订与推送的 seq 连续，父会话不变', async () => {
    const ids = ['base', 'br']
    const { daemon } = setup(
      new StubProvider([[{ type: 'delta', text: '回答' }]], { onExhausted: 'repeat-last' }),
      () => ids.shift() as string,
    )
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const created = await call(daemon, c, 'session.create')
    const baseId = (created.result as { sessionId: string }).sessionId
    await call(daemon, c, 'session.subscribe', { sessionId: baseId, fromSeq: 0 })
    await call(daemon, c, 'session.submit', { sessionId: baseId, text: '主线第一问' })
    for (let i = 0; i < 100 && !c.events().some((e) => e.ev.t === 'model.delta'); i++) await Bun.sleep(10)
    await Bun.sleep(50)
    const at = c.events().length

    const r = await call(daemon, c, 'session.branch', { sessionId: baseId, atSeq: at })
    const branchId = (r.result as { sessionId: string }).sessionId
    expect(branchId).not.toBe(baseId)

    const b = new Conn('b')
    await call(daemon, b, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const sub = await call(daemon, b, 'session.subscribe', { sessionId: branchId, fromSeq: 0 })
    expect(sub.result).toEqual({ head: at })
    expect(b.events().map((e) => e.seq)).toEqual(Array.from({ length: at }, (_, i) => i + 1))
    expect(JSON.stringify(b.events())).toContain('主线第一问')

    await call(daemon, b, 'session.submit', { sessionId: branchId, text: '分支第一问' })
    for (let i = 0; i < 100 && !JSON.stringify(b.events()).includes('分支第一问'); i++) await Bun.sleep(10)
    await Bun.sleep(50)
    const seqs = b.events().map((e) => e.seq)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    expect(JSON.stringify(c.events())).not.toContain('分支第一问')

    const listed = await call(daemon, c, 'session.list')
    expect((listed.result as { sessions: Array<{ id: string; parentId?: string }> }).sessions).toContainEqual(
      expect.objectContaining({ id: branchId, parentId: baseId }),
    )
  })

  test('session.branch 的分叉点越界 → INVALID_PARAMS', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    const r = await call(daemon, c, 'session.branch', { sessionId: 'sess-1', atSeq: 5 })
    expect(r.error?.code).toBe('INVALID_PARAMS')
    expect((await call(daemon, c, 'session.branch', { sessionId: 'nope', atSeq: 1 })).error?.code).toBe(
      'SESSION_NOT_FOUND',
    )
  })

  test('TASK-M3-012 · session.submit 带 refs：内容进上下文；坏引用在接受之前就 INVALID_PARAMS', async () => {
    const ids = ['A', 'B']
    const provider = new StubProvider([[{ type: 'delta', text: 'A 的结论' }]], { onExhausted: 'repeat-last' })
    const { daemon } = setup(provider, () => ids.shift() as string)
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.create')
    await call(daemon, c, 'session.subscribe', { sessionId: 'A', fromSeq: 0 })
    await call(daemon, c, 'session.submit', { sessionId: 'A', text: 'A 的问题' })
    for (let i = 0; i < 100 && !c.events().some((e) => e.ev.t === 'model.delta'); i++) await Bun.sleep(10)
    await Bun.sleep(50)

    const bad = await call(daemon, c, 'session.submit', {
      sessionId: 'B',
      text: 'x',
      refs: [{ sessionId: 'nope', fromSeq: 1, toSeq: 2 }],
    })
    expect(bad.error?.code).toBe('INVALID_PARAMS')

    await call(daemon, c, 'session.subscribe', { sessionId: 'B', fromSeq: 0 })
    const r = await call(daemon, c, 'session.submit', {
      sessionId: 'B',
      text: '接着 A 做',
      refs: [{ sessionId: 'A', fromSeq: 1, toSeq: 50 }],
    })
    expect(r.result).toEqual({ accepted: true })
    // 建会话时落的 session.kind（PRD-M8-004）不算这一轮的内容
    const inB = () => c.events().filter((e) => e.sessionId === 'B' && e.ev.t !== 'session.kind')
    for (let i = 0; i < 100 && inB().filter((e) => e.ev.t === 'model.delta').length === 0; i++) await Bun.sleep(10)
    expect(inB()[0]?.ev).toMatchObject({ t: 'ctx.ref', sessionId: 'A', fromSeq: 1 })
    // M10-001 起第一轮结束后会多一次标题生成调用（LLM 替身），所以不能断言「最后一次调用」：
    // 断言「存在一次调用把 refs 内容送进了上下文」即可
    expect(provider.calls.some((c) => JSON.stringify(c.messages).includes('A 的结论'))).toBe(true)
  })
})

describe('PRD-M10-001 · 会话标题接入运行时（daemon 侧）', () => {
  test('提交第一轮后 session.list 的标题自动生成（非空、不再是会话 id）', async () => {
    const { daemon } = setup()
    const c = new Conn('c')
    await call(daemon, c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    await call(daemon, c, 'session.create')
    const r = await call(daemon, c, 'session.submit', { sessionId: 'sess-1', text: '你好' })
    expect(r.result).toEqual({ accepted: true })

    // 标题生成是 fire-and-forget（LLM 调用不阻塞 submit 返回），轮询等它落库
    let title = ''
    for (let i = 0; i < 200 && title === ''; i++) {
      await Bun.sleep(10)
      const listed = await call(daemon, c, 'session.list')
      title = (listed.result as { sessions: Array<{ title: string }> }).sessions[0]?.title ?? ''
    }
    expect(title).not.toBe('')
    expect(title).not.toBe('sess-1') // AC-2：侧栏不再显示会话 id
  }, 15_000)
})
