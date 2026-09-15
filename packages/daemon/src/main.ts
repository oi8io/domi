#!/usr/bin/env bun
/**
 * domid —— daemon 独立进程入口（PRD-M3-002 AC-1 / AC-4）
 *
 *   bun packages/daemon/src/main.ts            # 默认 ws://127.0.0.1:7437
 *   DOMI_PORT=0 bun packages/daemon/src/main.ts
 *   DOMI_HOST=0.0.0.0 bun packages/daemon/src/main.ts   # 远程可连，强制 token（PRD-M3-006）
 *
 * 启动顺序是**先抢锁、再监听**：反过来的话，两个同时启动的进程里输的那个
 * 可能已经占了端口才发现自己不该起。
 * 第一行 stdout 是 `domid listening <url>`——拉起它的客户端读这一行拿地址。
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfigOrThrow } from '@domi/config'
import { McpHub } from '@domi/mcp'
import { type RejectedConnection, resolveServerSettings } from './auth.ts'
import { Daemon } from './core.ts'
import { acquireLock, LockHeldError, rewriteLock } from './lock.ts'
import { createRuntimeHost } from './runtime-host.ts'
import { serveWs } from './transport-ws.ts'

export const EXIT_LOCK_HELD = 3

/**
 * 起 domid 并一直跑下去（直到 SIGINT / SIGTERM）。返回非 0 表示没起来。
 * 单二进制里由 `DOMI_INTERNAL_ROLE=daemon domi` 调到这里（launcher.ts）。
 */
export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  const home = join(env.HOME ?? homedir(), '.domi')
  mkdirSync(home, { recursive: true })
  const config = loadConfigOrThrow({ env, home: env.HOME ?? homedir() })
  const server = resolveServerSettings({ config, env, home: env.HOME ?? homedir() })
  const requestedPort = server.port

  let release: () => void
  const lockPath = join(home, 'domid.lock')
  try {
    // 端口先记请求值；拿到真实端口后原地改写（DOMI_PORT=0 时两者不同）
    release = acquireLock(lockPath, { pid: process.pid, port: requestedPort, host: server.hostname })
  } catch (e) {
    if (e instanceof LockHeldError) {
      process.stderr.write(`${e.message}\n`)
      return EXIT_LOCK_HELD
    }
    throw e
  }

  // MCP：先开门再连 server。连接可能要好几秒（每个 server 各自超时），
  // 不能让拉起 domid 的客户端一直等；会话每轮现取工具，连上之后自然就有了
  const hub = new McpHub({
    servers: config.mcp.servers,
    allowedHosts: config.mcp.allowedHosts,
    timeoutMs: config.mcp.timeoutMs,
    blobDir: join(home, 'blobs'),
  })
  const host = createRuntimeHost({
    config,
    dbPath: join(home, 'events.db'),
    defaultCwd: process.cwd(),
    extraTools: () => hub.tools(),
    notices: () => hub.notices().map((n) => n.message),
  })
  const daemon = new Daemon(host)
  const ws = serveWs(daemon, {
    hostname: server.hostname,
    port: requestedPort,
    token: server.token,
    onRejected: (r) => void recordRejection(r),
  })
  if (ws.port !== requestedPort) {
    rewriteLock(lockPath, { pid: process.pid, port: ws.port, host: server.hostname })
  }
  // 地址和 token 的去处一次写出去（拉起方读第一行拿地址）。token 本身不打印：这些输出会进日志
  const notes = [`domid listening ${ws.url}`]
  if (server.token !== null) {
    notes.push(
      server.tokenFile
        ? `domid 要求 token；token 在 ${server.tokenFile}（远程客户端设 DOMI_TOKEN）`
        : 'domid 要求 token（来自 DOMI_TOKEN 或 config.yaml 的 server.token）',
    )
  }
  process.stdout.write(`${notes.join('\n')}\n`)

  /**
   * 被拒的连接落成事件（AC-3）。同一来源、同一原因一分钟只记一条：
   * 扫端口的人一秒能敲几百次门，审计会话不该被刷爆
   */
  const lastRecorded = new Map<string, number>()
  async function recordRejection(r: RejectedConnection): Promise<void> {
    const key = `${r.remote.replace(/:\d+$/, '')}|${r.reason}`
    const now = Date.now()
    if ((lastRecorded.get(key) ?? 0) > now - 60_000) return
    lastRecorded.set(key, now)
    process.stdout.write(
      `domid 拒绝了来自 ${r.remote} 的连接：${r.reason === 'missing' ? '没带 token' : 'token 不对'}\n`,
    )
    await host.audit({
      t: 'permission',
      capabilityId: 'daemon.connect',
      decision: 'deny',
      source: 'config',
      matchedRule: 'server.token',
      remote: r.remote,
      reason: r.reason,
      ...(r.origin === null ? {} : { origin: r.origin }),
    })
  }
  if (config.mcp.servers.length > 0) {
    void hub.start().then((statuses) => {
      for (const s of statuses) {
        const detail = s.state === 'connected' ? `${s.tools.length} 个工具（${s.era}）` : (s.error ?? '')
        process.stdout.write(`mcp ${s.name}: ${s.state} ${detail}\n`)
      }
    })
  }

  const shutdown = async (): Promise<void> => {
    await ws.stop()
    await daemon.close()
    await hub.close()
    host.close()
    release()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  return 0
}

if (import.meta.main) {
  main().then(
    (code) => {
      if (code !== 0) process.exit(code)
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    },
  )
}
