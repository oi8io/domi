#!/usr/bin/env bun
/**
 * domid —— daemon 独立进程入口（PRD-M3-002 AC-1 / AC-4）
 *
 *   bun packages/daemon/src/main.ts            # 默认 ws://127.0.0.1:7437
 *   DOMI_PORT=0 bun packages/daemon/src/main.ts
 *
 * 启动顺序是**先抢锁、再监听**：反过来的话，两个同时启动的进程里输的那个
 * 可能已经占了端口才发现自己不该起。
 * 第一行 stdout 是 `domid listening <url>`——拉起它的客户端读这一行拿地址。
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfigOrThrow } from '@domi/config'
import { Daemon } from './core.ts'
import { acquireLock, LockHeldError, rewriteLock } from './lock.ts'
import { createRuntimeHost } from './runtime-host.ts'
import { DEFAULT_PORT, serveWs } from './transport-ws.ts'

export const EXIT_LOCK_HELD = 3

/**
 * 起 domid 并一直跑下去（直到 SIGINT / SIGTERM）。返回非 0 表示没起来。
 * 单二进制里由 `DOMI_INTERNAL_ROLE=daemon domi` 调到这里（launcher.ts）。
 */
export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  const home = join(env.HOME ?? homedir(), '.domi')
  mkdirSync(home, { recursive: true })
  const config = loadConfigOrThrow({ env, home: env.HOME ?? homedir() })
  const requestedPort = env.DOMI_PORT === undefined ? DEFAULT_PORT : Number(env.DOMI_PORT)

  let release: () => void
  const lockPath = join(home, 'domid.lock')
  try {
    // 端口先记请求值；拿到真实端口后原地改写（DOMI_PORT=0 时两者不同）
    release = acquireLock(lockPath, { pid: process.pid, port: requestedPort })
  } catch (e) {
    if (e instanceof LockHeldError) {
      process.stderr.write(`${e.message}\n`)
      return EXIT_LOCK_HELD
    }
    throw e
  }

  const host = createRuntimeHost({ config, dbPath: join(home, 'events.db'), defaultCwd: process.cwd() })
  const daemon = new Daemon(host)
  const server = serveWs(daemon, { port: requestedPort })
  if (server.port !== requestedPort) rewriteLock(lockPath, { pid: process.pid, port: server.port })
  process.stdout.write(`domid listening ${server.url}\n`)

  const shutdown = async (): Promise<void> => {
    await server.stop()
    await daemon.close()
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
