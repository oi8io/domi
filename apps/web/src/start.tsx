/**
 * Web 端界面（由 main.tsx 在定好语言之后加载）—— PRD-M3-003（骨架）· PRD-M8-001 / 002
 *
 * 建一个 DomiClient，启动主题与路由，交给 App 渲染。
 * 连接、握手、续订、去重全在 @domi/client-core 里（INV-04：三端零业务逻辑）。
 */

import { authProtocols, DomiClient, type WireSocket } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { startRouter } from './router.ts'
import { startTheme } from './theme/store.ts'
import './globals.css'

// https 页面里明文 ws 会被浏览器当 mixed content 拦掉，所以走同源 wss（nginx 把 /ws 反代到 daemon）；
// 非 https（本地 vite 直连）才用默认地址
export const DEFAULT_DAEMON_URL = location.protocol === 'https:' ? `wss://${location.host}/ws` : 'ws://127.0.0.1:7437'

const url = new URLSearchParams(location.search).get('daemon') ?? DEFAULT_DAEMON_URL

/**
 * 远程 domid 的 token 放在地址的 # 后面（`#token=…`，PRD-M3-006）：
 * # 后面的部分浏览器不会发给任何服务器，也就不会进访问日志。
 * 读出来之后从地址栏抹掉，免得被截图、被复制链接带走。hash 同时也用作路由，所以只在带 token 时抹。
 */
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? undefined
if (token !== undefined) history.replaceState(null, '', `${location.pathname}${location.search}#/`)

startTheme()
startRouter()

const client = new DomiClient({
  clientName: 'domi-web',
  reconnectMs: 1000,
  connect: () => new WebSocket(url, authProtocols(token)) as unknown as WireSocket,
})

const root = document.getElementById('root')
if (!root) throw new Error(tr('web.main.missingRoot'))
createRoot(root).render(
  <StrictMode>
    <App client={client} daemonUrl={url} />
  </StrictMode>,
)
