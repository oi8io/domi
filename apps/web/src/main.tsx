/**
 * Web 端入口 —— PRD-M3-003（骨架）
 *
 * 这里只做一件事：建一个 DomiClient，交给 App 渲染。
 * 连接、握手、续订、去重全在 @domi/client-core 里（INV-04：三端零业务逻辑）。
 */
import { authProtocols, DomiClient, type WireSocket } from '@domi/client-core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

export const DEFAULT_DAEMON_URL = 'ws://127.0.0.1:7437'

const url = new URLSearchParams(location.search).get('daemon') ?? DEFAULT_DAEMON_URL

/**
 * 远程 domid 的 token 放在地址的 # 后面（`#token=…`，PRD-M3-006）：
 * # 后面的部分浏览器不会发给任何服务器，也就不会进访问日志。
 * 读出来之后从地址栏抹掉，免得被截图、被复制链接带走
 */
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? undefined
if (token !== undefined) history.replaceState(null, '', location.pathname + location.search)

const client = new DomiClient({
  clientName: 'domi-web',
  reconnectMs: 1000,
  connect: () => new WebSocket(url, authProtocols(token)) as unknown as WireSocket,
})

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里缺 #root')
createRoot(root).render(
  <StrictMode>
    <App client={client} daemonUrl={url} />
  </StrictMode>,
)
