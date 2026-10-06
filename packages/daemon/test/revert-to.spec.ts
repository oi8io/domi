/**
 * PRD-M14-010 AC-1…AC-4 · SPEC-M14-010 取舍-2/3
 *
 * 经 Daemon 的方法表走（和客户端同一条路）：真 git 仓库 + StubProvider 替身。
 * 覆盖 session.revertTo 三种 scope（files / conversation / both）、busy 拒绝（INV-03）、
 * 连续两次回滚回到初始（projectAfterReverts：后来的 revert 覆盖先前的）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deadRanges, liveEvents } from '@domi/checkpoint'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { PROTOCOL_VERSION, type RpcNotification, type RpcRequest, type RpcResponse } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载里删不掉就算了
    }
  }
})

class Conn implements ClientConn {
  readonly got: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(m: RpcNotification | RpcResponse): void {
    this.got.push(m)
  }
  notifications(method: string): Array<Record<string, unknown>> {
    return this.got
      .filter((m) => 'method' in m && m.method === method)
      .map((m) => (m as RpcNotification).params as Record<string, unknown>)
  }
}

function tmp(prefix = 'domi-rv-'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}

let n = 0
const TURN = [
  [
    {
      type: 'tool-call',
      id: 'p0',
      name: 'plan.update',
      args: { steps: [{ id: 's1', text: '写文件', status: 'in_progress' }] },
    },
  ],
  [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'b.txt', content: 'v1\n' } }],
  [{ type: 'tool-call', id: 'w2', name: 'fs.write', args: { path: 'b.txt', content: 'v2\n' } }],
  [{ type: 'delta', text: '改好了' }],
]

type Ctx = Pick<ReturnType<typeof setup>, 'daemon'>

async function snapshot(ctx: Ctx, sessionId: string) {
  const c = new Conn(`peek${++n}`)
  await ctx.daemon.handle(c, {
    jsonrpc: '2.0',
    id: ++n,
    method: 'handshake',
    params: { protocolVersion: PROTOCOL_VERSION, client: 'peek' },
  })
  const r = await ctx.daemon.handle(c, {
    jsonrpc: '2.0',
    id: ++n,
    method: 'session.subscribe',
    params: { sessionId, fromSeq: 0 },
  })
  if (r.error) throw new Error(r.error.message)
  const evs = c
    .notifications('session.events')
    .flatMap((x) => (x.events as Array<{ ev: Record<string, unknown> & { t: string } }>).map((e) => e.ev))
  const busy = c.notifications('session.busy').some((x) => x.busy === true)
  return { evs, busy }
}

async function idle(ctx: Ctx, sessionId: string) {
  for (let i = 0; i < 250; i++) {
    const s = await snapshot(ctx, sessionId)
    if (!s.busy && s.evs.some((e) => e.t === 'model.request')) return s.evs
    await Bun.sleep(20)
  }
  throw new Error('这一轮没结束')
}

async function repo(): Promise<string> {
  const d = tmp('domi-rv-repo-')
  execSync('git init -q --initial-branch main', { cwd: d })
  writeFileSync(join(d, 'keep.txt'), 'keep\n')
  execSync('git -c user.email=a@b -c user.name=a add -A && git -c user.email=a@b -c user.name=a commit -q -m init', {
    cwd: d,
  })
  return d
}

function setup(script: Array<Array<Record<string, unknown>>> = []) {
  const home = tmp('domi-rv-home-')
  let k = 0
  const host = createRuntimeHost({
    config: ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      permissions: {
        rules: [
          { name: 'w', capability: 'fs.write', decision: 'allow' },
          { name: 's', capability: 'shell.exec', decision: 'allow' },
        ],
      },
      verify: { enabled: false },
    }),
    dbPath: join(home, 'events.db'),
    defaultCwd: home,
    provider: new StubProvider(script as never, { onExhausted: 'repeat-last' }),
    newId: () => `rv${++k}`,
  })
  hosts.push(host)
  const daemon = new Daemon(host)
  const conn = new Conn(`c${++n}`)
  const call = async (method: string, params: unknown = {}): Promise<Record<string, unknown>> => {
    const req: RpcRequest = { jsonrpc: '2.0', id: ++n, method, params }
    const r = await daemon.handle(conn, req)
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, data: r.error.data })
    return r.result as Record<string, unknown>
  }
  return { home, host, daemon, conn, call }
}

async function runTurn(ctx: ReturnType<typeof setup>, r: string, script = TURN) {
  const created = (await ctx.call('session.create', { cwd: r, kind: 'task' })) as { sessionId: string }
  const id = created.sessionId
  await ctx.call('session.submit', { sessionId: id, text: '改' })
  const evs = await idle(ctx, id)
  return { id, evs, r }
}

describe('PRD-M14-010 AC-1/AC-3 · session.revertTo 三种 scope', () => {
  test('files：undo 快照 + 恢复文件 + revert 事件带 snapshotId / undoSnapshotId', async () => {
    const ctx = setup(TURN)
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const { id, evs, r } = await runTurn(ctx, await repo())
    // 第一轮后 b.txt = v2
    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('v2\n')
    // 回到第一轮 user.input 之前：toSeq = 第一条 user.input 的 seq
    const toSeq = evs.findIndex((e) => e.t === 'user.input') + 1
    const rv = (await ctx.call('session.revertTo', { sessionId: id, toSeq, scope: 'files' })) as {
      ok: boolean
      snapshotId: string | null
      undoSnapshotId: string | null
    }
    expect(rv.snapshotId).toBeString()
    expect(rv.undoSnapshotId).toBeString()
    // 文件回到步起点（w1 执行前的状态：b.txt 尚不存在）——目标快照 = 该轮第一个 checkpoint
    expect(existsSync(join(r, 'b.txt'))).toBe(false)
    const last = (await snapshot(ctx, id)).evs
    const revert = last.find((e) => e.t === 'revert') as Record<string, unknown> | undefined
    expect(revert).toBeDefined()
    expect(revert!.scope).toBe('files')
    expect(revert!.toSeq).toBe(toSeq)
    expect(revert!.snapshotId).toBe(rv.snapshotId)
    expect(revert!.undoSnapshotId).toBe(rv.undoSnapshotId)
    expect(revert!.snapshotId).not.toBeNull()
    expect(revert!.undoSnapshotId).not.toBeNull()
  })

  test('conversation：只落 revert，快照字段为 null，文件不动', async () => {
    const ctx = setup(TURN)
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const { id, evs, r } = await runTurn(ctx, await repo())
    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('v2\n')
    const toSeq = evs.findIndex((e) => e.t === 'user.input') + 1
    const rv = (await ctx.call('session.revertTo', { sessionId: id, toSeq, scope: 'conversation' })) as {
      ok: boolean
      snapshotId: string | null
      undoSnapshotId: string | null
    }
    expect(rv.snapshotId).toBeNull()
    expect(rv.undoSnapshotId).toBeNull()
    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('v2\n')
    const last = (await snapshot(ctx, id)).evs
    const revert = last.find((e) => e.t === 'revert') as Record<string, unknown> | undefined
    expect(revert).toBeDefined()
    expect(revert!.scope).toBe('conversation')
    expect(revert!.snapshotId).toBeNull()
    expect(revert!.undoSnapshotId).toBeNull()
  })

  test('both：文件恢复 + 对话作废', async () => {
    const ctx = setup(TURN)
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const { id, evs, r } = await runTurn(ctx, await repo())
    const toSeq = evs.findIndex((e) => e.t === 'user.input') + 1
    const rv = (await ctx.call('session.revertTo', { sessionId: id, toSeq, scope: 'both' })) as {
      ok: boolean
      snapshotId: string | null
      undoSnapshotId: string | null
    }
    expect(rv.snapshotId).not.toBeNull()
    expect(rv.undoSnapshotId).not.toBeNull()
    expect(existsSync(join(r, 'b.txt'))).toBe(false)
    const last = (await snapshot(ctx, id)).evs
    const revert = last.find((e) => e.t === 'revert') as Record<string, unknown> | undefined
    expect(revert!.scope).toBe('both')
  })
})

describe('PRD-M14-010 AC-4 · 连续两次回滚回到初始', () => {
  test('projectAfterReverts：后来的 revert 覆盖先前的（dead 区间只剩第二次）', async () => {
    const ctx = setup([
      ...TURN,
      // 第二轮剧本（第二次 submit 消费）
      [
        {
          type: 'tool-call',
          id: 'p1',
          name: 'plan.update',
          args: { steps: [{ id: 's1', text: '写文件', status: 'done' }] },
        },
      ],
      [{ type: 'tool-call', id: 'w3', name: 'fs.write', args: { path: 'b.txt', content: 'v3\n' } }],
      [{ type: 'delta', text: '又改了一版' }],
    ])
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const created = (await ctx.call('session.create', { cwd: await repo(), kind: 'task' })) as { sessionId: string }
    const id = created.sessionId
    // 第一轮
    await ctx.call('session.submit', { sessionId: id, text: '改' })
    await idle(ctx, id)
    // 第二轮
    await ctx.call('session.submit', { sessionId: id, text: '再改' })
    await idle(ctx, id)
    const repoDir = (await snapshot(ctx, id)).evs
    const sessionMeta = (await ctx.call('session.list', { includeDeleted: false })) as {
      sessions: Array<{ id: string; cwd: string }>
    }
    const rr = sessionMeta.sessions.find((s) => s.id === id)!
    expect(readFileSync(join(rr.cwd, 'b.txt'), 'utf8')).toBe('v3\n')
    const evsAll = (await snapshot(ctx, id)).evs
    const inputs = evsAll
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.t === 'user.input')
      .map((x) => x.i + 1)
    const firstTo = inputs[0]! // 第一轮起点
    const secondTo = inputs[1]! // 第二轮起点
    // 先回滚到第二轮起点（作废第二轮）
    await ctx.call('session.revertTo', { sessionId: id, toSeq: secondTo, scope: 'conversation' })
    // 再回滚到第一轮起点（作废第一 + 第二轮）——第二次覆盖第一次
    await ctx.call('session.revertTo', { sessionId: id, toSeq: firstTo, scope: 'conversation' })
    const after = (await snapshot(ctx, id)).evs.map((e) => e as Record<string, unknown> & { t: string })
    const envelopes = after.map((ev, i) => ({ ev, seq: i + 1 })) as unknown as Array<{
      ev: { t: string; toSeq?: number; scope?: string }
      seq: number
    }>
    const ranges = deadRanges(envelopes as never)
    // 两次 revert 的作废区间都在（INV-01 / INV-12：不删事件）
    expect(ranges).toHaveLength(2)
    // AC-4 连续两次回滚回到初始：更靠后的 revert 覆盖先前的——最晚一条的 fromSeq = 最早 user.input 之后
    const last = ranges[ranges.length - 1]!
    expect(last.fromSeq).toBe(firstTo + 1)
    // 回到初始：liveEvents 里只剩初始段（seq < firstTo+1）与两次 revert 之外的事件
    const live = liveEvents(envelopes as never)
    for (const e of live) expect(e.seq).toBeLessThan(firstTo + 1)
    // 两次 revert 事件本身还在（INV-01 / INV-12）
    expect(after.filter((e) => e.t === 'revert')).toHaveLength(2)
  })
})

describe('PRD-M14-010 AC-3 · busy 拒绝（INV-03）', () => {
  test('一轮进行到一半（询问挂起）时 session.revertTo → SESSION_BUSY', async () => {
    const home = tmp('domi-rv-busy-')
    let k = 0
    const host = createRuntimeHost({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
        verify: { enabled: false },
      }),
      dbPath: join(home, 'events.db'),
      defaultCwd: home,
      provider: new StubProvider(
        [
          [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'a.txt', content: 'x\n' } }],
          [{ type: 'delta', text: '好了' }],
        ] as never,
        { onExhausted: 'repeat-last' },
      ),
      newId: () => `rvb${++k}`,
    })
    hosts.push(host)
    const daemon = new Daemon(host)
    const conn = new Conn(`busy${++n}`)
    const call = async (method: string, params: unknown = {}): Promise<Record<string, unknown>> => {
      const req: RpcRequest = { jsonrpc: '2.0', id: ++n, method, params }
      const r = await daemon.handle(conn, req)
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, data: r.error.data })
      return r.result as Record<string, unknown>
    }
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const created = (await call('session.create', { cwd: home })) as { sessionId: string }
    const id = created.sessionId
    await call('session.submit', { sessionId: id, text: '写文件' })
    // 等询问挂起（busy = true）
    for (let i = 0; i < 200; i++) {
      const s = await snapshot({ daemon }, id)
      if (s.busy) break
      await Bun.sleep(20)
    }
    const req: RpcRequest = {
      jsonrpc: '2.0',
      id: ++n,
      method: 'session.revertTo',
      params: { sessionId: id, toSeq: 1, scope: 'files' },
    }
    const r = await daemon.handle(conn, req)
    expect(r.error).toBeDefined()
    expect(r.error?.code).toBe('SESSION_BUSY')
  })
})
