/**
 * `domi bridge …` —— PRD-M5-007
 *   pair      生成 5 分钟有效的一次性配对码
 *   telegram  在前台跑桥接进程（Ctrl-C 退出；想常驻就交给 launchd / systemd）
 */

import { join } from 'node:path'
import type { DomiConfig } from '@domi/config'
import { resolveClientToken } from '@domi/daemon'
import { tr } from '@domi/i18n'
import { connectDaemon } from './connect.ts'

export const BRIDGE_USAGE = () => tr('tui.bridge.usage')

export async function runBridgeCommand(
  sub: string | undefined,
  io: { out(s: string): void; err(s: string): void },
  opts: { config: DomiConfig; home: string; connect?: string },
): Promise<number> {
  const statePath = join(opts.home, '.domi', 'bridge-telegram.json')
  const { newPairingCode, runBridge, PAIRING_TTL_MS } = await import('@domi/bridge-telegram')
  switch (sub) {
    case 'pair': {
      const code = newPairingCode(statePath, Date.now())
      io.out(tr('tui.bridge.code', { code, v: PAIRING_TTL_MS / 60_000, code2: code }))
      return 0
    }
    case 'telegram': {
      const token = process.env.DOMI_TELEGRAM_TOKEN || opts.config.bridge.telegram?.token
      if (!token) {
        io.err(tr('tui.bridge.noToken'))
        return 2
      }
      const daemonToken = resolveClientToken({ config: opts.config, env: process.env, home: opts.home })
      const { client } = await connectDaemon({
        home: opts.home,
        cwd: process.cwd(),
        model: opts.config.model,
        clientName: 'domi-telegram',
        reconnectMs: 2000,
        ...(opts.connect === undefined ? {} : { connect: opts.connect }),
        ...(daemonToken === undefined ? {} : { token: daemonToken }),
      })
      const ac = new AbortController()
      process.on('SIGINT', () => ac.abort())
      process.on('SIGTERM', () => ac.abort())
      io.out(tr('tui.bridge.started'))
      await runBridge({ token, client, statePath, signal: ac.signal, log: (l) => io.err(l) })
      client.close()
      return 0
    }
    default:
      io.err(BRIDGE_USAGE())
      return 2
  }
}
