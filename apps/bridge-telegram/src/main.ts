/**
 * Telegram 桥接进程 —— PRD-M5-007 · docs/adr/021
 *
 * 独立进程，经 Domi Protocol 连 domid（AC-1）。grammY 长轮询，不需要公网入口。
 * Telegram 不可达时指数退避重连，最长 60 秒（AC-6）；domid 这边完全不受影响——它根本不知道桥接的存在。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Bot, InlineKeyboard } from 'grammy'
import { Bridge } from './bridge.ts'
import { isAllowed, readState, tryPair } from './pairing.ts'

export interface RunBridgeOptions {
  token: string
  client: DomiClient
  statePath: string
  log(line: string): void
  signal?: AbortSignal
}

const PAIR_REPLY = (): Record<ReturnType<typeof tryPair>, string> => ({
  paired: tr('bridge.paired'),
  already: tr('bridge.alreadyPaired'),
  expired: tr('bridge.codeExpired'),
  wrong: tr('bridge.codeWrong'),
  none: tr('bridge.noCode'),
})

export async function runBridge(opts: RunBridgeOptions): Promise<void> {
  const bot = new Bot(opts.token)
  const bridge = new Bridge({
    client: opts.client,
    chats: () => readState(opts.statePath).chats,
    log: opts.log,
    chat: {
      async send(chatId, text, buttons) {
        const kb = buttons ? buttons.reduce((k, b) => k.text(b.text, b.data), new InlineKeyboard()) : undefined
        await bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : {})
      },
    },
  })

  bot.command('pair', async (ctx) => {
    await ctx.reply(PAIR_REPLY()[tryPair(opts.statePath, ctx.chat.id, String(ctx.match ?? ''), Date.now())])
  })
  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.from.id
    const text = await bridge.onButton(chatId, ctx.callbackQuery.data)
    await ctx.answerCallbackQuery({ text })
  })
  // 其它消息：绑定过的给一句说明（桥接只读 + 审批，不能从这里发起任务）；没绑定的丢弃并记事件
  bot.on('message', async (ctx) => {
    if (isAllowed(opts.statePath, ctx.chat.id)) {
      await ctx.reply(tr('bridge.readOnly'))
      return
    }
    // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
    await bridge.audit(`未绑定的 chat ${ctx.chat.id} 发来消息，已丢弃`)
  })
  // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
  bot.catch((err) => opts.log(`bridge: 处理消息出错：${err.message}`))

  await bridge.start()
  opts.signal?.addEventListener('abort', () => {
    bridge.stop()
    bot.stop().catch(() => undefined)
  })

  let delay = 1000
  while (!opts.signal?.aborted) {
    try {
      await bot.start({
        onStart: () => {
          delay = 1000
          // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
          opts.log('bridge: 已连上 Telegram')
        },
      })
      return
    } catch (e) {
      // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
      opts.log(`bridge: 连不上 Telegram（${e instanceof Error ? e.message : String(e)}），${delay / 1000} 秒后重试`)
      await Bun.sleep(delay)
      delay = Math.min(delay * 2, 60_000)
    }
  }
}
