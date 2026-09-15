/**
 * `domi bridge …` —— PRD-M5-007
 *   pair      生成 5 分钟有效的一次性配对码
 *   telegram  在前台跑桥接进程（Ctrl-C 退出；想常驻就交给 launchd / systemd）
 */
import { join } from 'node:path'
import type { DomiConfig } from '@domi/config'
import { resolveClientToken } from '@domi/daemon'
import { connectDaemon } from './connect.ts'

export const BRIDGE_USAGE = `用法：
  domi bridge pair        生成配对码（5 分钟有效），然后在 Telegram 里给你的 bot 发 /pair <码>
  domi bridge telegram    启动桥接（token 放 DOMI_TELEGRAM_TOKEN 或 config.yaml 的 bridge.telegram.token）

桥接只推送长任务的进展与审批，不能从 Telegram 发起或修改任务；不发送任何文件内容。`

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
      io.out(
        `配对码：${code}（${PAIRING_TTL_MS / 60_000} 分钟内有效，用一次作废）\n在 Telegram 里给你的 bot 发：/pair ${code}`,
      )
      return 0
    }
    case 'telegram': {
      const token = process.env.DOMI_TELEGRAM_TOKEN || opts.config.bridge.telegram?.token
      if (!token) {
        io.err('没有 Telegram bot token。先找 @BotFather 建一个 bot，再设 DOMI_TELEGRAM_TOKEN。')
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
      io.out('桥接已启动，Ctrl-C 退出。')
      await runBridge({ token, client, statePath, signal: ac.signal, log: (l) => io.err(l) })
      client.close()
      return 0
    }
    default:
      io.err(BRIDGE_USAGE)
      return 2
  }
}
