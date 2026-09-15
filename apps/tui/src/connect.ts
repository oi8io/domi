/**
 * TUI 连 daemon —— PRD-M3-002 AC-1 / AC-4 · M3 DoD 的前一半
 *
 * TUI 不再在进程内跑 DomiSession：拉起（或复用）domid，经 Domi Protocol 连上去。
 * 于是关掉终端只是断开一个客户端，任务在 domid 里照常跑完，浏览器里能看到结果。
 *
 * 单独成文件是为了能测：Ink 的按键在无 TTY 环境里验不了（docs/adr/001），
 * 但「连上、建会话、订阅」这一段不需要 TTY。
 */
import { createSessionStore, DomiClient, type SessionStore, type WireSocket } from '@domi/client-core'
import { type DaemonEndpoint, ensureDaemon } from '@domi/daemon'

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
}

export async function connectChat(opts: ConnectOptions): Promise<ChatConnection> {
  const daemon = await ensureDaemon({
    home: opts.home,
    command: opts.command ?? selfCommand(),
    cwd: opts.cwd,
    ...(opts.env === undefined ? {} : { env: opts.env }),
  })
  const client = new DomiClient({
    clientName: 'domi-tui',
    reconnectMs: 1000,
    connect: () => new WebSocket(daemon.url) as unknown as WireSocket,
  })
  await client.start()
  const sessionId = await client.createSession(opts.cwd)
  // 模型名先按本地配置显示；daemon 推来第一份 metrics 后以它为准
  const store = createSessionStore({ model: opts.model.name, provider: opts.model.provider })
  await client.watch(sessionId, store)
  return { client, store, sessionId, daemon }
}
