/**
 * WebSocket 传输 —— PRD-M3-002 AC-1 / PRD-M3-006 AC-2 · 守 INV-11
 *
 * 这一层只搬运：把一帧文本解析成请求交给 `Daemon.handle`，把响应和通知序列化回去。
 * 调度、串行化、续订全在 core 里，这里一行都没有（见 core.ts 顶部）。
 *
 * 用 Bun 自带的 `Bun.serve` WebSocket，不引库（docs/adr/012）。
 *
 * 边界都是**结构性的**，不是靠配置记得打开：
 *
 * 1. **非回环地址必须带 token。** 没有 token 就不监听（PRD-M3-006 AC-2）。
 *    token 从哪来是 auth.ts 的事，这里只认「有没有」。
 * 2. **有 token 就在升级之前校验。** 没带或不对 → 401，并报给 onRejected 落成事件（AC-3）。
 * 3. **没有 token 时，浏览器来源必须是本机页面。** 没有认证的本地 WebSocket，任何网页都能从用户浏览器里连上来
 *    （跨站 WebSocket 劫持）。浏览器一定会带 Origin；命令行客户端不带。所以：
 *    不带 Origin 放行，带了就必须是 localhost / 127.0.0.1 / [::1]。
 *    有 token 时不看 Origin：别的页面拿不到 token，远程访问的页面本来就不在本机。
 */
import { AUTH_SUBPROTOCOL, RequestSchema, type RpcNotification, type RpcResponse } from '@domi/protocol'
import { isLoopback, type RejectedConnection, tokenFromRequest, tokensMatch } from './auth.ts'
import type { ClientConn, Daemon } from './core.ts'

export const DEFAULT_HOSTNAME = '127.0.0.1'
export const DEFAULT_PORT = 7437

export class NonLocalListenError extends Error {
  constructor(hostname: string) {
    super(`拒绝监听 ${hostname}：非本地地址必须带 token 认证（PRD-M3-006 AC-2）。`)
    this.name = 'NonLocalListenError'
  }
}

/** 浏览器来源是否可信。null = 非浏览器客户端（没有 Origin 头） */
export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return true
  try {
    const host = new URL(origin).hostname
    // 桌面端（Tauri）在 Windows 上的页面来源是 http://tauri.localhost（ADR-021）
    return isLoopback(host) || host === 'tauri.localhost'
  } catch {
    return false
  }
}

export interface WsServerOptions {
  hostname?: string
  /** 0 = 让系统挑一个空闲端口（测试用） */
  port?: number
  /** 要求客户端带的 token。null / 不给 = 不校验，只允许回环地址 */
  token?: string | null
  /** 一次连接因为认证被拒 */
  onRejected?: (r: RejectedConnection) => void
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
  const token = opts.token ?? null
  if (token === null && !isLoopback(hostname)) throw new NonLocalListenError(hostname)

  let seq = 0
  const server = Bun.serve<SocketData>({
    hostname,
    port: opts.port ?? DEFAULT_PORT,
    fetch(req, srv) {
      const origin = req.headers.get('origin')
      if (token !== null) {
        const given = tokenFromRequest(req)
        if (given === null || !tokensMatch(given, token)) {
          const addr = srv.requestIP(req)
          opts.onRejected?.({
            remote: addr ? `${addr.address}:${addr.port}` : 'unknown',
            reason: given === null ? 'missing' : 'invalid',
            origin,
          })
          return new Response('domid：需要 token（DOMI_TOKEN）', { status: 401 })
        }
      } else if (!isAllowedOrigin(origin)) {
        return new Response('forbidden origin', { status: 403 })
      }
      // 客户端提供了子协议，就必须回一个它提供过的——只回 domi，token 不回显
      const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim())
      const headers = offered.includes(AUTH_SUBPROTOCOL) ? { 'Sec-WebSocket-Protocol': AUTH_SUBPROTOCOL } : undefined
      if (srv.upgrade(req, { data: { conn: null }, ...(headers === undefined ? {} : { headers }) })) return undefined
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
