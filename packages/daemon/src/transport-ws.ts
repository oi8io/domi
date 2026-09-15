/**
 * WebSocket 传输 —— PRD-M3-002 AC-1 / PRD-M3-006 AC-2 · 守 INV-11
 *
 * 这一层只搬运：把一帧文本解析成请求交给 `Daemon.handle`，把响应和通知序列化回去。
 * 调度、串行化、续订全在 core 里，这里一行都没有（见 core.ts 顶部）。
 *
 * 用 Bun 自带的 `Bun.serve` WebSocket，不引库（docs/adr/012）。
 *
 * 两道本地边界，都是**结构性的**，不是靠配置记得打开：
 *
 * 1. **只监听回环地址。** M3-006 AC-2 要求「监听非本地地址必须显式配置且强制 token 认证」，
 *    认证这一轮还没做，所以非回环地址现在直接拒绝——而不是先放开、等认证做了再收紧。
 * 2. **浏览器来源必须是本机页面。** 没有认证的本地 WebSocket，任何网页都能从用户浏览器里连上来
 *    （跨站 WebSocket 劫持）。浏览器一定会带 Origin；命令行客户端不带。所以：
 *    不带 Origin 放行，带了就必须是 localhost / 127.0.0.1 / [::1]。
 */
import { RequestSchema, type RpcNotification, type RpcResponse } from '@domi/protocol'
import type { ClientConn, Daemon } from './core.ts'

export const DEFAULT_HOSTNAME = '127.0.0.1'
export const DEFAULT_PORT = 7437

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export class NonLocalListenError extends Error {
  constructor(hostname: string) {
    super(
      `拒绝监听 ${hostname}：非本地地址必须强制 token 认证（PRD-M3-006 AC-2），而认证还没实现。` +
        `现在只能监听 ${DEFAULT_HOSTNAME}。`,
    )
    this.name = 'NonLocalListenError'
  }
}

/** 浏览器来源是否可信。null = 非浏览器客户端（没有 Origin 头） */
export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return true
  try {
    return LOOPBACK.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

export interface WsServerOptions {
  hostname?: string
  /** 0 = 让系统挑一个空闲端口（测试用） */
  port?: number
}

export interface WsServer {
  readonly hostname: string
  readonly port: number
  readonly url: string
  stop(): Promise<void>
}

interface SocketData {
  conn: ClientConn | null
}

export function serveWs(daemon: Daemon, opts: WsServerOptions = {}): WsServer {
  const hostname = opts.hostname ?? DEFAULT_HOSTNAME
  if (!LOOPBACK.has(hostname)) throw new NonLocalListenError(hostname)

  let seq = 0
  const server = Bun.serve<SocketData>({
    hostname,
    port: opts.port ?? DEFAULT_PORT,
    fetch(req, srv) {
      if (!isAllowedOrigin(req.headers.get('origin'))) {
        return new Response('forbidden origin', { status: 403 })
      }
      if (srv.upgrade(req, { data: { conn: null } })) return undefined
      return new Response('domid：这里只接受 WebSocket（Domi Protocol）', { status: 426 })
    },
    websocket: {
      open(ws) {
        seq++
        ws.data.conn = {
          id: `ws-${seq}`,
          send(msg: RpcNotification | RpcResponse) {
            ws.send(JSON.stringify(msg))
          },
        }
      },
      message(ws, raw) {
        const conn = ws.data.conn
        if (!conn) return
        let parsed: unknown
        try {
          parsed = JSON.parse(String(raw))
        } catch {
          return // 连 JSON 都不是：没有 id 可回，丢掉
        }
        const req = RequestSchema.safeParse(parsed)
        if (!req.success) return // 不是请求（客户端不该发通知）：同上
        void daemon.handle(conn, req.data).then((res) => conn.send(res))
      },
      close(ws) {
        if (ws.data.conn) daemon.disconnect(ws.data.conn)
      },
    },
  })

  const port = server.port ?? opts.port ?? DEFAULT_PORT
  return {
    hostname,
    port,
    url: `ws://${hostname}:${port}`,
    async stop() {
      await server.stop(true)
    },
  }
}
