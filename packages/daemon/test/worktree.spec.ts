/**
 * PRD-M7-006 · 工作区隔离与改动审阅（AC-1 ~ AC-5）· SPEC-M7-006 · ADR-026
 *
 * 经 Daemon 的方法表走（和客户端同一条路），真 git、StubProvider 替身。
 * 「原仓库一个字节不变」用整棵树的指纹（HEAD + status + 每个文件的内容哈希）来断言，而不是只看某一个文件。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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

function tmp(prefix = 'domi-wt-'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
const GIT = '-c user.email=a@b -c user.name=a'
function repo(): string {
  const d = tmp('domi-wt-repo-')
  execSync('git init -q', { cwd: d })
  mkdirSync(join(d, 'sub'))
  writeFileSync(join(d, 'a.txt'), '原来的 a\n')
  writeFileSync(join(d, 'sub', 'keep.txt'), 'keep\n')
  execSync(`git add -A && git ${GIT} commit -q -m init`, { cwd: d })
  return d
}

/** 原仓库的指纹：HEAD、status、工作区每个文件（含 .git 外的全部）的内容哈希 */
function fingerprint(root: string): string {
  const h = createHash('sha256')
  h.update(execSync('git rev-parse HEAD', { cwd: root }).toString())
  h.update(execSync('git status --porcelain', { cwd: root }).toString())
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      if (name === '.git') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(`${relative(root, p)}:${createHash('sha256').update(readFileSync(p)).digest('hex')}\n`)
    }
  }
  walk(root)
  return h.digest('hex')
}

let n = 0
function setup(script: Array<Array<Record<string, unknown>>> = [[{ type: 'delta', text: '好的' }]]) {
  const home = tmp('domi-wt-home-')
  let k = 0
  const host = createRuntimeHost({
    config: ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      permissions: { rules: [{ name: 'w', capability: 'fs.write', decision: 'allow' }] },
      verify: { enabled: false },
    }),
    dbPath: join(home, 'events.db'),
    defaultCwd: home,
    provider: new StubProvider(script as never, { onExhausted: 'repeat-last' }),
    newId: () => `wt${++k}`,
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

const WRITES = [
  // 任务里动手前先写计划（PRD-M12-004 AC-8）
  [
    {
      type: 'tool-call',
      id: 'p0',
      name: 'plan.update',
      args: { steps: [{ id: 's1', text: '写文件', status: 'in_progress' }] },
    },
  ],
  [
    { type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'b.txt', content: '新文件 b\n' } },
    { type: 'tool-call', id: 'w2', name: 'fs.write', args: { path: 'keep.txt', content: '改过的 keep\n' } },
  ],
  [{ type: 'delta', text: '改好了' }],
]

type Ctx = Pick<ReturnType<typeof setup>, 'daemon'>

/** 用一条新连接从头订阅：补发的全部事件 + 此刻忙不忙 */
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

async function events(ctx: Ctx, sessionId: string) {
  return (await snapshot(ctx, sessionId)).evs
}

/** 等这一轮跑完：有过模型请求、且现在不忙 */
async function idle(ctx: Ctx, sessionId: string) {
  for (let i = 0; i < 250; i++) {
    const s = await snapshot(ctx, sessionId)
    if (!s.busy && s.evs.some((e) => e.t === 'model.request')) return s.evs
    await Bun.sleep(20)
  }
  throw new Error('这一轮没结束')
}

async function isolated(script = WRITES) {
  const ctx = setup(script)
  await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
  const r = repo()
  const before = fingerprint(r)
  const created = (await ctx.call('session.create', { cwd: join(r, 'sub'), isolate: true })) as {
    sessionId: string
    worktree: { path: string; branch: string }
  }
  return { ...ctx, repo: r, before, id: created.sessionId, tree: created.worktree }
}

describe('PRD-M7-006 AC-1 · 隔离启动：~/.domi/worktrees 下的 worktree 与 domi/<会话> 分支', () => {
  test('建出 worktree 与分支，落 worktree.create；会话工作目录指向 worktree 里的同一子目录；原仓库不动', async () => {
    const ctx = await isolated()
    const { call, home, repo: r, before, id, tree } = ctx
    expect(tree.branch).toBe(`domi/${id}`)
    expect(tree.path.startsWith(join(home, 'worktrees'))).toBe(true)
    expect(execSync(`git branch --list ${tree.branch}`, { cwd: r }).toString()).toContain(tree.branch)
    await call('session.submit', { sessionId: id, text: '改' })
    const evs = await idle(ctx, id)
    expect(evs.find((e) => e.t === 'worktree.create')).toMatchObject({ repo: r, path: tree.path, branch: tree.branch })
    // 模型写的 b.txt 落在 worktree 的 sub/ 里
    expect(readFileSync(join(tree.path, 'sub', 'b.txt'), 'utf8')).toBe('新文件 b\n')
    expect(existsSync(join(r, 'sub', 'b.txt'))).toBe(false)
    expect(fingerprint(r)).toBe(before)
  })
})

describe('PRD-M7-006 AC-2 · 改动清单，逐文件丢弃且可撤销', () => {
  test('worktree.diff 列出相对起点的每个文件；discard 丢掉一个，restore 撤销回来', async () => {
    const ctx = await isolated()
    const { call, id, tree } = ctx
    await call('session.submit', { sessionId: id, text: '改' })
    await idle(ctx, id)
    const diff = (await call('worktree.diff', { sessionId: id })) as {
      files: Array<{ path: string; status: string; diff?: string }>
    }
    const paths = diff.files.map((f) => f.path).sort()
    expect(paths).toEqual(['sub/b.txt', 'sub/keep.txt'])
    expect(JSON.stringify(diff.files.find((f) => f.path === 'sub/keep.txt'))).toContain('改过的 keep')

    const { trash } = (await call('worktree.discard', { sessionId: id, path: 'sub/keep.txt' })) as { trash: string }
    expect(readFileSync(join(tree.path, 'sub', 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(
      ((await call('worktree.diff', { sessionId: id })) as { files: Array<{ path: string }> }).files.map((f) => f.path),
    ).toEqual(['sub/b.txt'])
    await call('worktree.restore', { sessionId: id, trash })
    expect(readFileSync(join(tree.path, 'sub', 'keep.txt'), 'utf8')).toBe('改过的 keep\n')
    const evs = await events(ctx, id)
    expect(evs.some((e) => e.t === 'worktree.discard')).toBe(true)
    expect(evs.some((e) => e.t === 'worktree.restore')).toBe(true)
  })

  test('丢弃不能越出 worktree', async () => {
    const { call, id } = await isolated()
    await expect(call('worktree.discard', { sessionId: id, path: '../../etc/passwd' })).rejects.toThrow()
  })
})

describe('PRD-M7-006 AC-3 · 带回原仓库是 human-approval 动作', () => {
  async function applyAnswering(ctx: Awaited<ReturnType<typeof isolated>>, allowed: boolean, mode = 'squash') {
    // 询问只推给订阅了这个会话的连接（和客户端一样：先订阅，才看得到确认框）
    await ctx.call('session.subscribe', { sessionId: ctx.id, fromSeq: 0 })
    const pending = ctx.call('worktree.apply', { sessionId: ctx.id, mode })
    let ask: Record<string, unknown> | undefined
    for (let i = 0; i < 200 && !ask; i++) {
      ask = ctx.conn.notifications('session.ask').find((a) => a.capabilityId === 'worktree.apply')
      if (!ask) await Bun.sleep(10)
    }
    expect(ask).toBeDefined()
    ctx.conn.got.length = 0
    await ctx.call('session.answer', { askId: ask?.askId, allowed })
    return (await pending) as { ok: boolean; commit?: string; message: string }
  }

  test('不批准：原仓库一个字节不变（整棵树指纹相同），并落一条 ok:false 的 worktree.apply', async () => {
    const ctx = await isolated()
    await ctx.call('session.submit', { sessionId: ctx.id, text: '改' })
    await idle(ctx, ctx.id)
    const r = await applyAnswering(ctx, false)
    expect(r.ok).toBe(false)
    expect(fingerprint(ctx.repo)).toBe(ctx.before)
    expect((await events(ctx, ctx.id)).find((e) => e.t === 'worktree.apply')).toMatchObject({ ok: false })
  })

  test('批准 squash：原仓库多一个提交，内容就是隔离工作区里的改动', async () => {
    const ctx = await isolated()
    await ctx.call('session.submit', { sessionId: ctx.id, text: '改' })
    await idle(ctx, ctx.id)
    const r = await applyAnswering(ctx, true)
    expect(r.ok).toBe(true)
    expect(execSync('git rev-list --count HEAD', { cwd: ctx.repo }).toString().trim()).toBe('2')
    expect(readFileSync(join(ctx.repo, 'sub', 'keep.txt'), 'utf8')).toBe('改过的 keep\n')
    expect(readFileSync(join(ctx.repo, 'sub', 'b.txt'), 'utf8')).toBe('新文件 b\n')
    expect(execSync('git status --porcelain', { cwd: ctx.repo }).toString()).toBe('')
  })

  test('批准但原仓库相关文件有未提交修改：拒绝并列出文件，原仓库不动', async () => {
    const ctx = await isolated()
    await ctx.call('session.submit', { sessionId: ctx.id, text: '改' })
    await idle(ctx, ctx.id)
    writeFileSync(join(ctx.repo, 'sub', 'keep.txt'), '用户自己在改\n')
    const mine = fingerprint(ctx.repo)
    const r = await applyAnswering(ctx, true)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('sub/keep.txt')
    expect(fingerprint(ctx.repo)).toBe(mine)
  })
})

describe('PRD-M7-006 AC-4 · 删会话时的清理', () => {
  test('worktree 里有未提交改动：拒绝删除并提示，目录还在', async () => {
    const ctx = await isolated()
    await ctx.call('session.submit', { sessionId: ctx.id, text: '改' })
    await idle(ctx, ctx.id)
    await expect(ctx.call('session.delete', { sessionId: ctx.id })).rejects.toThrow(/没提交的改动/)
    expect(existsSync(ctx.tree.path)).toBe(true)
  })

  test('干净的隔离会话：删目录，分支还在（除非用户显式删）', async () => {
    const ctx = await isolated([[{ type: 'delta', text: '没改' }]])
    await ctx.call('session.delete', { sessionId: ctx.id })
    expect(existsSync(ctx.tree.path)).toBe(false)
    expect(execSync(`git branch --list ${ctx.tree.branch}`, { cwd: ctx.repo }).toString()).toContain(ctx.tree.branch)
  })
})

describe('PRD-M7-006 AC-5 · 非 git 目录不能隔离', () => {
  test('如实拒绝，并指出改动仍有步级快照保护；不隔离地开会话，写入照常留快照', async () => {
    const ctx = setup([
      [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'x.txt', content: 'x' } }],
      [{ type: 'delta', text: '好' }],
    ])
    await ctx.call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
    const plain = tmp('domi-wt-plain-')
    const err = await ctx.call('session.create', { cwd: plain, isolate: true }).then(
      () => null,
      (e: Error & { code?: string }) => e,
    )
    expect(err?.code).toBe('INVALID_PARAMS')
    expect(err?.message).toContain('不在 git 仓库里')
    expect(err?.message).toContain('步级快照')
    const { sessionId } = (await ctx.call('session.create', { cwd: plain })) as { sessionId: string }
    await ctx.call('session.submit', { sessionId, text: '写' })
    const evs = await idle(ctx, sessionId)
    expect(evs.filter((e) => e.t === 'fs.snapshot').map((e) => e.phase)).toContain('after')
    expect(evs.some((e) => e.t === 'worktree.create')).toBe(false)
  })
})
