/**
 * TUI 连 daemon —— PRD-M3-002 AC-1 / AC-4 · M3 DoD 的前一半
 *
 * TUI 不再在进程内跑 DomiSession：拉起（或复用）domid，经 Domi Protocol 连上去。
 * 于是关掉终端只是断开一个客户端，任务在 domid 里照常跑完，浏览器里能看到结果。
 *
 * 单独成文件是为了能测：Ink 的按键在无 TTY 环境里验不了（docs/adr/001），
 * 但「连上、建会话、订阅」这一段不需要 TTY。
 */

import { authProtocols, createSessionStore, DomiClient, type SessionStore, type WireSocket } from '@domi/client-core'
import { type DaemonEndpoint, ensureDaemon } from '@domi/daemon'
import { tr } from '@domi/i18n'

export interface ChatConnection {
  client: DomiClient
  store: SessionStore
  sessionId: string
  daemon: DaemonEndpoint
}

/**
 * 拉起 domid 用的命令：就是「再跑一次自己」，由环境变量切到 daemon 角色。
 * 单二进制里 Bun.main 是虚拟路径（/$bunfs/…），可执行文件本身就是入口；
 * 源码运行时是 [bun, main.tsx]。
 */
export function selfCommand(): string[] {
  const entry = Bun.main
  const compiled = entry.startsWith('/$bunfs/') || entry.includes('~BUN')
  return compiled ? [process.execPath] : [process.execPath, entry]
}

export interface ConnectOptions {
  home: string
  cwd: string
  model: { provider: string; name: string }
  command?: string[]
  env?: Record<string, string | undefined>
  /** `domi --connect <url>`：连这个地址，不拉起本地 domid（PRD-M3-006 AC-1） */
  connect?: string
  /** 连接时带的 token（DOMI_TOKEN / 配置 / 本机 domid 生成的文件） */
  token?: string
  /** `domi --isolate`：在隔离工作区（git worktree）里开会话（PRD-M7-006） */
  isolate?: boolean
  /** `domi --chat`（PRD-M8-017） */
  chat?: boolean
  /** `domi -p <项目名或路径>`（PRD-M8-017） */
  inProject?: string
}

/** 远程连不上。说清楚是哪一步，别让人对着「一直在重连」猜 */
export class RemoteConnectError extends Error {
  constructor(url: string, why: 'auth' | 'unreachable', detail = '') {
    super(
      why === 'auth'
        ? tr('tui.connect.badToken', { url })
        : tr('tui.connect.unreachable', { url, v: detail ? tr('tui.connect.detail', { detail }) : '' }),
    )
    this.name = 'RemoteConnectError'
  }
}

/**
 * 升级之前先敲一下门：浏览器式的 WebSocket 拿不到 401 这个状态码，只会看到「连接失败」，
 * 分不清是 token 不对还是对面没开。普通 HTTP 请求能分清——认证没过是 401，过了是 426（只收 WebSocket）
 */
async function probe(url: string, token: string | undefined): Promise<void> {
  const http = url.replace(/^ws/, 'http')
  let res: Response
  try {
    res = await fetch(http, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  } catch (e) {
    throw new RemoteConnectError(url, 'unreachable', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 401) throw new RemoteConnectError(url, 'auth')
}

/** 只连 daemon，不建会话（`domi task …`、桥接用） */
export async function connectDaemon(
  opts: ConnectOptions & { clientName?: string; reconnectMs?: number },
): Promise<{ client: DomiClient; daemon: DaemonEndpoint }> {
  let daemon: DaemonEndpoint
  if (opts.connect !== undefined) {
    await probe(opts.connect, opts.token)
    daemon = { url: opts.connect, pid: 0, spawned: false }
  } else {
    daemon = await ensureDaemon({
      home: opts.home,
      command: opts.command ?? selfCommand(),
      cwd: opts.cwd,
      ...(opts.env === undefined ? {} : { env: opts.env }),
    })
  }
  const protocols = authProtocols(opts.token)
  const client = new DomiClient({
    clientName: opts.clientName ?? 'domi-cli',
    reconnectMs: opts.reconnectMs ?? 0,
    connect: () => new WebSocket(daemon.url, protocols) as unknown as WireSocket,
  })
  await client.start()
  return { client, daemon }
}

/** 编辑距离（相近项目名提示用） */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] as number
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j] as number
      dp[j] = Math.min((dp[j] as number) + 1, (dp[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return dp[b.length] as number
}

export class ProjectArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectArgError'
  }
}

/**
 * `-p` 的值 → 项目 id：先按名字精确匹配，再当路径（已登记就用，没登记但像项目就登记），
 * 都不行就报错并列出名字相近的（编辑距离 ≤ 3，最多 5 个）
 */
export async function findProject(
  client: Pick<DomiClient, 'listProjects' | 'createProject' | 'resolveProject'>,
  arg: string,
  cwd: string,
): Promise<string> {
  const projects = await client.listProjects({ includeArchived: false, recent: 0 })
  const byName = projects.filter((p) => p.name === arg)
  if (byName.length === 1) return (byName[0] as (typeof projects)[number]).id
  if (byName.length > 1) {
    throw new ProjectArgError(
      tr('tui.connect.ambiguous', {
        length: byName.length,
        arg,
        join: byName.map((p) => p.path).join(tr('common.listSep')),
      }),
    )
  }
  const looksLikePath = arg.includes('/') || arg.startsWith('.') || arg.startsWith('~')
  if (looksLikePath) {
    const abs = arg.startsWith('~') || arg.startsWith('/') ? arg : `${cwd}/${arg}`
    try {
      const r = await client.resolveProject(abs)
      if (r.project) return r.project.id
      return (await client.createProject(r.root)).id
    } catch (e) {
      throw new ProjectArgError(e instanceof Error ? e.message : String(e))
    }
  }
  const near = projects
    .map((p) => ({ p, d: editDistance(p.name.toLowerCase(), arg.toLowerCase()) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.p.name)
  throw new ProjectArgError(
    tr('tui.connect.noProject', {
      arg,
      v: near.length > 0 ? tr('tui.connect.didYouMean', { join: near.join(tr('common.listSep')) }) : '',
    }),
  )
}

export async function connectChat(opts: ConnectOptions): Promise<ChatConnection> {
  let daemon: DaemonEndpoint
  if (opts.connect !== undefined) {
    await probe(opts.connect, opts.token)
    daemon = { url: opts.connect, pid: 0, spawned: false }
  } else {
    daemon = await ensureDaemon({
      home: opts.home,
      command: opts.command ?? selfCommand(),
      cwd: opts.cwd,
      ...(opts.env === undefined ? {} : { env: opts.env }),
    })
  }
  const protocols = authProtocols(opts.token)
  const client = new DomiClient({
    clientName: 'domi-tui',
    reconnectMs: 1000,
    connect: () => new WebSocket(daemon.url, protocols) as unknown as WireSocket,
  })
  await client.start()
  let sessionId: string
  if (opts.isolate) sessionId = (await client.createIsolatedSession(opts.cwd)).sessionId
  else if (opts.chat) sessionId = await client.createSession(undefined, { kind: 'chat' })
  else if (opts.inProject !== undefined) {
    const projectId = await findProject(client, opts.inProject, opts.cwd)
    sessionId = await client.createSession(undefined, { kind: 'task', projectId })
  }
  // 不指定时由 daemon 按目录判断：项目 / git 仓库 / 有 AGENT.md → 任务，否则 → 会话（PRD-M8-017 AC-1）
  else sessionId = await client.createSession(opts.cwd)
  // 模型名先按本地配置显示；daemon 推来第一份 metrics 后以它为准
  const store = createSessionStore({ model: opts.model.name, provider: opts.model.provider })
  await client.watch(sessionId, store)
  return { client, store, sessionId, daemon }
}
