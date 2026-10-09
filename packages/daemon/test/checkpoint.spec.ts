/**
 * SPEC-M14-003 取舍-6/7 · PRD-M14-003 AC-3 / PRD-M14-005 AC-7
 *
 * 经 Daemon 的方法表走（和客户端同一条路）：真 git 仓库 + StubProvider 替身。
 * 覆盖 checkpoint.diff（区间选择）/ checkpoint.discard（丢弃 + fs.discard 事件）/
 * checkpoint.discard.undo（按 undoSnapshotId 恢复）/ busy 拒绝。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { PROTOCOL_VERSION, type RpcNotification, type RpcRequest, type RpcResponse } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(async () => {
  for (const h of hosts.splice(0)) h.close()
  // session 的 flushAndClose 是异步收尾，close 不等待；让事件循环落地一轮再删目录，
  // 否则 pending 写库会撞上已删除的 db 文件（SQLITE_IOERR_VNODE，全量并行下稳定复现）
  await new Promise((r) => setTimeout(r, 25))
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

function tmp(prefix = 'domi-ckpt-'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}

let n = 0
function setup(script: Array<Array<Record<string, unknown>>> = [[{ type: 'delta', text: '好的' }]]) {
  const home = tmp('domi-ckpt-home-')
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
    newId: () => `ck${++k}`,
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

const TURN = [
  // 任务里动手前先写计划（PRD-M12-004 AC-8）
  [
    {
      type: 'tool-call',
      id: 'p0',
      name: 'plan.update',
      args: { steps: [{ id: 's1', text: '写文件', status: 'in_progress' }] },
    },
  ],
  [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'b.txt', content: '新文件 b\n' } }],
  [{ type: 'tool-call', id: 'sh1', name: 'shell.exec', args: { cmd: 'printf "shell 改动\\n" >> b.txt' } }],
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
  const head = (r.result as { head?: number }).head ?? evs.length
  return { evs, busy, head }
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
  const d = tmp('domi-ckpt-repo-')
  execSync('git init -q --initial-branch main', { cwd: d })
  writeFileSync(join(d, 'keep.txt'), 'keep\n')
  execSync('git -c user.email=a@b -c user.name=a add -A && git -c user.email=a@b -c user.name=a commit -q -m init', {
    cwd: d,
  })
  return d
}

describe('PRD-M14-003 AC-3 · checkpoint.diff 三种范围与降级', () => {
  test('本轮 / 整个会话得到同一份文件改动；无快照范围 available:false', async () => {
    const ctx = setup(TURN)
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const r = await repo()
    const created = (await ctx.call('session.create', { cwd: r, kind: 'task' })) as { sessionId: string }
    const id = created.sessionId
    await ctx.call('session.submit', { sessionId: id, text: '改' })
    await idle(ctx, id)

    const evs = await snapshot(ctx, id)
    const ckpts = (evs.evs as Array<Record<string, unknown>>).filter((e) => e.t === 'fs.checkpoint')
    // baseline(w1) + after(w1) + after(sh1 改了文件) = 3
    expect(ckpts).toHaveLength(3)
    const base = ckpts.find((e) => e.phase === 'baseline')
    expect(base).toBeDefined()
    expect((base as { id?: string }).id).toBeTruthy()

    // 整个会话：from=1..head
    const head = (await snapshot(ctx, id)).head
    const whole = (await ctx.call('checkpoint.diff', { sessionId: id, fromSeq: 1, toSeq: head })) as {
      available: boolean
      files: Array<{ path: string; status: string; patch: string }>
    }
    expect(whole.available).toBe(true)
    expect(whole.files.map((f) => f.path)).toEqual(['b.txt'])
    expect(whole.files[0]?.patch).toContain('新文件 b')
    expect(whole.files[0]?.patch).toContain('shell 改动')

    // 本轮：fromSeq = 最后一个 user.input 的 seq
    const inputs = (evs.evs as Array<{ t: string }>).map((e, i) => (e.t === 'user.input' ? i + 1 : 0))
    const lastInput = Math.max(...inputs)
    const turn = (await ctx.call('checkpoint.diff', {
      sessionId: id,
      fromSeq: lastInput,
      toSeq: head,
    })) as { available: boolean; files: Array<{ path: string }> }
    expect(turn.available).toBe(true)
    expect(turn.files.map((f) => f.path)).toEqual(['b.txt'])

    // path 过滤
    const only = (await ctx.call('checkpoint.diff', {
      sessionId: id,
      fromSeq: 1,
      toSeq: head,
      path: 'b.txt',
    })) as { files: Array<{ path: string }> }
    expect(only.files.map((f) => f.path)).toEqual(['b.txt'])

    // 起点在 head：没有快照覆盖 → available:false + reason
    const none = (await ctx.call('checkpoint.diff', {
      sessionId: id,
      fromSeq: head,
      toSeq: head,
    })) as { available: boolean; reason?: string }
    expect(none.available).toBe(false)
    expect(typeof none.reason).toBe('string')
  })
})

describe('PRD-M14-005 AC-7 · checkpoint.discard 与 undo', () => {
  test('丢弃恢复 + fs.discard 事件 + undo 按 undoSnapshotId 回来', async () => {
    const ctx = setup(TURN)
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const r = await repo()
    const created = (await ctx.call('session.create', { cwd: r, kind: 'task' })) as { sessionId: string }
    const id = created.sessionId
    await ctx.call('session.submit', { sessionId: id, text: '改' })
    await idle(ctx, id)

    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('新文件 b\nshell 改动\n')

    const evs = await snapshot(ctx, id)
    const head = (evs.evs as Array<unknown>).length
    const inputs = (evs.evs as Array<{ t: string }>).map((e, i) => (e.t === 'user.input' ? i + 1 : 0))
    const lastInput = Math.max(...inputs)

    // 丢弃回本轮起点：b.txt 那时不存在 → 文件被移除
    const disc = (await ctx.call('checkpoint.discard', {
      sessionId: id,
      path: 'b.txt',
      fromSeq: lastInput,
      toSeq: head,
    })) as { eventSeq: number }
    expect(typeof disc.eventSeq).toBe('number')
    expect(existsSync(join(r, 'b.txt'))).toBe(false)

    // fs.discard 事件落盘
    const after = await snapshot(ctx, id)
    const discards = (after.evs as Array<Record<string, unknown>>).filter((e) => e.t === 'fs.discard')
    expect(discards).toHaveLength(1)
    expect(discards[0]).toMatchObject({ path: 'b.txt' })

    // undo：按事件 seq 恢复
    const und = (await ctx.call('checkpoint.discard.undo', {
      sessionId: id,
      eventSeq: disc.eventSeq,
    })) as { path: string }
    expect(und.path).toBe('b.txt')
    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('新文件 b\nshell 改动\n')

    // 不存在的丢弃记录 → INVALID_PARAMS
    const bad = await ctx.daemon.handle(ctx.conn, {
      jsonrpc: '2.0',
      id: ++n,
      method: 'checkpoint.discard.undo',
      params: { sessionId: id, eventSeq: 999_999 },
    })
    expect(bad.error?.code).toBe('INVALID_PARAMS')
  })
})

describe('PRD-M14-005 AC-7 · busy 时拒绝丢弃（INV-03）', () => {
  test('一轮进行到一半（询问挂起）时 checkpoint.discard → SESSION_BUSY', async () => {
    // 自由会话（chat）里 fs.write 默认 ask；计划不强制
    const home = tmp('domi-ckpt-busy-')
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
      newId: () => `ckb${++k}`,
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
    // 询问只推给订阅了这个会话的连接（worktree 测试同款）
    await call('session.subscribe', { sessionId: id, fromSeq: 0 })
    await call('session.submit', { sessionId: id, text: '改' })

    // 等询问真的挂起
    let ask: { askId: string } | undefined
    for (let i = 0; i < 100 && !ask; i++) {
      ask = conn.notifications('session.ask')[0] as { askId: string } | undefined
      await Bun.sleep(10)
    }
    expect(ask).toBeDefined()

    const r = await daemon.handle(conn, {
      jsonrpc: '2.0',
      id: ++n,
      method: 'checkpoint.discard',
      params: { sessionId: id, path: 'a.txt', fromSeq: 1, toSeq: 1 },
    })
    expect(r.error?.code).toBe('SESSION_BUSY')

    // 收尾：拒绝这次写入，让这一轮正常结束
    await call('session.answer', { askId: ask!.askId, allowed: false })
    await idle({ daemon } as Ctx, id)
  })
})
