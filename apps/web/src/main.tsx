/**
 * Web 端入口 —— PRD-M3-003（骨架）
 *
 * 这里只做一件事：建一个 DomiClient，交给 App 渲染。
 * 连接、握手、续订、去重全在 @domi/client-core 里（INV-04：三端零业务逻辑）。
 */
import { DomiClient, type WireSocket } from '@domi/client-core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

export const DEFAULT_DAEMON_URL = 'ws://127.0.0.1:7437'

const url = new URLSearchParams(location.search).get('daemon') ?? DEFAULT_DAEMON_URL
const client = new DomiClient({
  clientName: 'domi-web',
  reconnectMs: 1000,
  connect: () => new WebSocket(url) as unknown as WireSocket,
})

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里缺 #root')
createRoot(root).render(
  <StrictMode>
    <App client={client} daemonUrl={url} />
  </StrictMode>,
)
