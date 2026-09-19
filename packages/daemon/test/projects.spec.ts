/**
 * 项目、目标驱动的任务、未读 —— PRD-M8-003 AC-1…AC-4 · PRD-M8-005 AC-1 / AC-2 / AC-3 · PRD-M8-009 AC-1 / AC-2
 *
 * 都经 Daemon 的方法表走一遍（和客户端调的是同一条路），StubProvider 替身，不联网。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { tr } from '@domi/i18n'
import { StubProvider, type StubTurn } from '@domi/model'
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
  notifications(method: string): unknown[] {
    return this.got.filter((m) => 'method' in m && m.method === method).map((m) => (m as RpcNotification).params)
  }
}

function tmp(prefix = 'domi-pj-'): string {
  // realpath：macOS 上 /var 是 /private/var 的符号链接，而生产代码会规范化路径，测试得用同一口径
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}

function repo(dirty = false): string {
  const d = tmp('domi-repo-')
  execSync('git init -q', { cwd: d })
  execSync('git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init', { cwd: d })
  if (dirty) writeFileSync(join(d, 'dirty.txt'), 'x')
  return d
}

let n = 0
function setup(script?: Array<Array<Record<string, unknown>>>, titleScript?: StubTurn[]) {
  const home = tmp('domi-home-')
  let k = 0
  const provider = new StubProvider((script ?? [[{ type: 'delta', text: '好的' }]]) as never, {
    onExhausted: 'repeat-last',
    ...(titleScript === undefined ? {} : { titleScript }),
  })
  const host = createRuntimeHost({
    config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
    dbPath: join(home, 'events.db'),
    defaultCwd: home,
    provider,
    newId: () => `s${++k}`,
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
  return { home, host, daemon, conn, call, provider }
}

async function handshake(call: (m: string, p?: unknown) => Promise<Record<string, unknown>>): Promise<void> {
  await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
}

describe('PRD-M8-003 AC-1 / AC-2 · 项目表与 project.*', () => {
  test('登记项目：路径规范化后唯一，名字默认取目录名', async () => {
    const { call } = setup()
    await handshake(call)
    const dir = repo()
    const a = (await call('project.create', { path: dir })) as { project: { id: string; name: string; path: string } }
    const b = (await call('project.create', { path: `${dir}/` })) as { project: { id: string } }
    expect(b.project.id).toBe(a.project.id)
    expect(a.project.name).toBe(dir.split('/').pop() ?? '')
    expect(a.project.path).toBe(dir)
  })

  test('路径必须是已经存在的目录，否则如实拒绝', async () => {
    const { call } = setup()
    await handshake(call)
    await expect(call('project.create', { path: '/nope/really' })).rejects.toThrow()
  })

  test('改名与项目设置存得下来', async () => {
    const { call } = setup()
    await handshake(call)
    const { project } = (await call('project.create', { path: repo(), name: '我的项目' })) as {
      project: { id: string; name: string }
    }
    expect(project.name).toBe('我的项目')
    const updated = (await call('project.update', {
      id: project.id,
      name: '改过的',
      settings: { isolation: 'always', planReview: 'never' },
    })) as { project: { name: string; settings: Record<string, string> } }
    expect(updated.project.name).toBe('改过的')
    expect(updated.project.settings).toEqual({ isolation: 'always', planReview: 'never' })
  })
})

describe('PRD-M8-003 AC-3 / AC-4 · 自动建项目、任务数与归档', () => {
  test('在没登记过的仓库里建任务 → 自动建项目；列表带任务数与最近活动', async () => {
    const { call } = setup()
    await handshake(call)
    const dir = repo()
    const { sessionId } = (await call('session.create', { cwd: dir })) as { sessionId: string }
    const { projects } = (await call('project.list', {})) as {
      projects: Array<{ id: string; path: string; taskCount: number; lastActivity: number | null }>
    }
    expect(projects).toHaveLength(1)
    expect(projects[0]?.path).toBe(dir)
    expect(projects[0]?.taskCount).toBe(1)
    expect(projects[0]?.lastActivity).not.toBeNull()
    const { sessions } = (await call('session.list', {})) as {
      sessions: Array<{ id: string; kind: string; projectId?: string; cwd?: string }>
    }
    expect(sessions.find((s) => s.id === sessionId)).toMatchObject({
      kind: 'task',
      projectId: projects[0]?.id,
      cwd: dir,
    })
  })

  test('普通目录（不是仓库、没有 AGENT.md）里建的是自由会话，工作目录在沙盒里', async () => {
    const { call, home } = setup()
    await handshake(call)
    const { sessionId } = (await call('session.create', {})) as { sessionId: string }
    const { sessions } = (await call('session.list', {})) as {
      sessions: Array<{ id: string; kind: string; cwd?: string }>
    }
    const row = sessions.find((s) => s.id === sessionId)
    expect(row?.kind).toBe('chat')
    expect(row?.cwd).toBe(join(home, 'scratch', sessionId))
  })

  test('归档的项目不在默认列表里，也不能往里建任务；取消归档后又回来', async () => {
    const { call } = setup()
    await handshake(call)
    const { project } = (await call('project.create', { path: repo() })) as { project: { id: string } }
    await call('project.archive', { id: project.id, archived: true })
    expect(((await call('project.list', {})) as { projects: unknown[] }).projects).toHaveLength(0)
    expect(((await call('project.list', { includeArchived: true })) as { projects: unknown[] }).projects).toHaveLength(
      1,
    )
    await expect(call('task.create', { projectId: project.id, goal: '干点什么' })).rejects.toThrow(/归档/)
    await call('project.archive', { id: project.id, archived: false })
    expect(((await call('project.list', {})) as { projects: unknown[] }).projects).toHaveLength(1)
  })
})

describe('PRD-M8-005 AC-1 / AC-2 / AC-3 · 按目标建任务', () => {
  test('短目标直接开干；长目标先进计划模式；目标作为第一句话发出去', async () => {
    const { call } = setup()
    await handshake(call)
    const { project } = (await call('project.create', { path: repo() })) as { project: { id: string } }
    const short = (await call('task.create', { projectId: project.id, goal: '修个错字' })) as {
      sessionId: string
      planned: boolean
      isolation: { isolate: boolean; reason: string }
    }
    expect(short.planned).toBe(false)
    expect(short.isolation).toEqual({ isolate: false, reason: 'clean' })
    const long = (await call('task.create', {
      projectId: project.id,
      goal: '先读一遍现有实现，再把设置页的通用标签拆成两个组件，并补上对应的单元测试，然后更新文档',
    })) as { sessionId: string; planned: boolean }
    expect(long.planned).toBe(true)
    await Bun.sleep(200)
    const events = (await call('session.subscribe', { sessionId: short.sessionId, fromSeq: 0 })) as { head: number }
    expect(events.head).toBeGreaterThan(0)
  })

  test('脏工作区的任务自动隔离（PRD-M8-006 AC-1），事件里记着原因', async () => {
    const { call, conn } = setup()
    await handshake(call)
    const { project } = (await call('project.create', { path: repo(true) })) as { project: { id: string } }
    const r = (await call('task.create', { projectId: project.id, goal: '修个错字' })) as {
      sessionId: string
      isolation: { isolate: boolean; reason: string }
    }
    expect(r.isolation).toEqual({ isolate: true, reason: 'dirty-worktree' })
    await call('session.subscribe', { sessionId: r.sessionId, fromSeq: 0 })
    const evs = conn
      .notifications('session.events')
      .flatMap((p) => (p as { events: Array<{ ev: { t: string } }> }).events.map((e) => e.ev))
    expect(evs.find((e) => e.t === 'session.kind')).toMatchObject({
      kind: 'task',
      isolation: { isolate: true, reason: 'dirty-worktree' },
    })
    expect(evs.some((e) => e.t === 'worktree.create')).toBe(true)
  })
})

describe('PRD-M8-009 AC-1 / AC-2 · 未读与 sessions.changed', () => {
  test('回复到了就是未读；在任一端看过之后就不是了；变化推给所有连接', async () => {
    const { call, conn, daemon } = setup()
    await handshake(call)
    const { sessionId } = (await call('session.create', { kind: 'task' })) as { sessionId: string }
    const list = async (): Promise<Array<{ id: string; unread?: boolean; busy?: boolean }>> =>
      ((await call('session.list', {})) as { sessions: Array<{ id: string; unread?: boolean }> }).sessions
    expect((await list()).find((s) => s.id === sessionId)?.unread).toBeUndefined()

    await call('session.submit', { sessionId, text: '你好' })
    for (let i = 0; i < 100 && (await list()).find((s) => s.id === sessionId)?.unread !== true; i++) await Bun.sleep(10)
    expect((await list()).find((s) => s.id === sessionId)?.unread).toBe(true)

    // 另一条连接报已读（AC-2：任一客户端看过就算）
    const other = new Conn('other')
    await daemon.handle(other, {
      jsonrpc: '2.0',
      id: 9001,
      method: 'handshake',
      params: { protocolVersion: PROTOCOL_VERSION, client: 'tui' },
    })
    const head = ((await call('session.subscribe', { sessionId, fromSeq: 0 })) as { head: number }).head
    const read = await daemon.handle(other, {
      jsonrpc: '2.0',
      id: 9002,
      method: 'session.read',
      params: { sessionId, seq: head },
    })
    expect(read.result).toEqual({ changed: true })
    expect((await list()).find((s) => s.id === sessionId)?.unread).toBeUndefined()

    // 已读只往前推
    const again = await daemon.handle(other, {
      jsonrpc: '2.0',
      id: 9003,
      method: 'session.read',
      params: { sessionId, seq: 1 },
    })
    expect(again.result).toEqual({ changed: false })

    // AC-1：列表变化是推过来的，不是轮询出来的
    await Bun.sleep(700)
    expect(conn.notifications('sessions.changed').length).toBeGreaterThan(0)
    expect(other.got.some((m) => 'method' in m && m.method === 'sessions.changed')).toBe(true)
  })
})

describe('PRD-M10-001 AC-2 · 项目展开列表（recentTasks）空标题 fallback first_input', () => {
  const LONG = '帮我把这个项目里所有用到旧版配置格式的地方都找出来并且逐个迁移到新格式上去，注意保持向后兼容'

  test('新会话（还没有任何输入）标题回退到默认「新会话」，不空着', async () => {
    const { call } = setup(undefined, [])
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const dir = repo()
    const created = (await call('session.create', { cwd: dir })) as { sessionId: string }

    // 不 submit：没有 user.input，first_input 派生列为 NULL
    const listed = (await call('session.list')) as { sessions: Array<{ id: string; title: string }> }
    expect(listed.sessions.find((x) => x.id === created.sessionId)?.title).toBe(tr('daemon.sessions.untitled'))
    const plist = (await call('project.list')) as {
      projects: Array<{ recentTasks: Array<{ id: string; title: string }> }>
    }
    expect(plist.projects[0]?.recentTasks[0]?.title).toBe(tr('daemon.sessions.untitled'))
  })

  test('空标题任务在 project.list 的 recentTasks 里回退首条输入前 40 字', async () => {
    const { call } = setup(undefined, []) // titleScript=[]：标题生成不产出，标题保持空
    await call('handshake', { protocolVersion: PROTOCOL_VERSION, client: 't' })
    const dir = repo()
    const created = (await call('session.create', { cwd: dir })) as { sessionId: string }
    const sessionId = created.sessionId
    await call('session.submit', { sessionId, text: LONG })

    // user.input 落库后 first_input 即可派生；标题生成 fire-and-forget 且不产出，title 由 daemon 回退为首条输入前 40 字
    let seen: { title: string; firstInput?: string } | undefined
    for (let i = 0; i < 200 && seen === undefined; i++) {
      await Bun.sleep(10)
      const listed = (await call('project.list')) as {
        projects: Array<{ recentTasks: Array<{ title: string; firstInput?: string }> }>
      }
      seen = listed.projects[0]?.recentTasks[0]
    }
    expect(seen?.title).toBe(LONG.slice(0, 40))
    expect(seen?.firstInput).toBe(LONG.slice(0, 40))
  }, 15_000)
})
