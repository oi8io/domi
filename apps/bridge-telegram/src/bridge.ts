/**
 * 桥接的编排 —— PRD-M5-007 · docs/adr/021
 *
 * 不认识 grammY：发消息、收回调都经 `ChatPort`（main.ts 用 grammY 实现它，测试用替身）。
 * 业务一行都没有（INV-02）：推什么由 daemon 的事件决定，怎么答由用户点的按钮决定。
 */

import { createSessionStore, type DomiClient, type SessionStore } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { formatAsk, formatProgress } from './format.ts'

export interface ChatPort {
  send(chatId: number, text: string, buttons?: Array<{ text: string; data: string }>): Promise<void>
}

export interface BridgeOptions {
  client: DomiClient
  chat: ChatPort
  /** 当前白名单（每次现读：配对是另一个进程写的） */
  chats(): readonly number[]
  /** 多久看一次有没有新的运行 */
  pollMs?: number
  log?(line: string): void
}

const RUN_PREFIX = 'run-'

export class Bridge {
  private readonly watched = new Map<string, { store: SessionStore; unsub: Array<() => void> }>()
  /** callback_data 只有 64 字节：askId 太长，换成短号 */
  private readonly asks = new Map<string, string>()
  private nextAsk = 1
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly opts: BridgeOptions) {}

  async start(): Promise<void> {
    await this.scan()
    this.timer = setInterval(() => {
      // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
      void this.scan().catch((e) => this.opts.log?.(`bridge: 刷新运行列表失败：${String(e)}`))
    }, this.opts.pollMs ?? 5000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    for (const [id, w] of this.watched) {
      for (const u of w.unsub) u()
      this.opts.client.unwatch(id)
    }
    this.watched.clear()
  }

  /** 找出还在跑的运行，盯上（运行会话里包括它的节点会话转来的询问） */
  async scan(): Promise<void> {
    const runs = await this.opts.client.listTasks()
    for (const r of runs) {
      if (!r.runId.startsWith(RUN_PREFIX) || this.watched.has(r.runId)) continue
      if (r.status !== 'running') continue
      await this.watch(r.runId)
    }
  }

  private async broadcast(text: string, buttons?: Array<{ text: string; data: string }>): Promise<void> {
    for (const chatId of this.opts.chats()) {
      try {
        await this.opts.chat.send(chatId, text, buttons)
      } catch (e) {
        // Telegram 不可达：记一行，不影响别的（AC-6）
        // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
        this.opts.log?.(`bridge: 发给 ${chatId} 失败：${String(e)}`)
      }
    }
  }

  private async watch(runId: string): Promise<void> {
    const store = createSessionStore()
    const unsub: Array<() => void> = []
    // 订阅会先补发历史：只推订阅之后的新进展，不把整段历史刷一遍
    let ready = false
    let seen = 0
    unsub.push(
      store.$items.listen((items) => {
        const fresh = items.slice(seen)
        seen = items.length
        if (!ready) return
        for (const item of fresh) {
          const text = formatProgress(runId, item)
          if (text) void this.broadcast(text)
        }
      }),
    )
    unsub.push(
      store.$ask.listen((ask) => {
        if (!ask?.askId) return
        const short = String(this.nextAsk++)
        this.asks.set(short, ask.askId)
        void this.broadcast(formatAsk(runId, ask), [
          { text: tr('common.allow'), data: `a:${short}:1` },
          { text: tr('common.deny'), data: `a:${short}:0` },
        ])
      }),
    )
    this.watched.set(runId, { store, unsub })
    await this.opts.client.watch(runId, store)
    seen = store.$items.get().length
    ready = true
  }

  /** 按钮回调。返回给点按钮的人看的一句话 */
  async onButton(chatId: number, data: string): Promise<string> {
    if (!this.opts.chats().includes(chatId)) {
      // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
      await this.audit(`未绑定的 chat ${chatId} 点了按钮`)
      return tr('bridge.notPaired')
    }
    const m = data.match(/^a:(\d+):([01])$/)
    if (!m) return tr('bridge.badButton')
    const askId = this.asks.get(m[1] as string)
    if (!askId) return tr('bridge.expired')
    this.asks.delete(m[1] as string)
    const allowed = m[2] === '1'
    // 与 TUI 同一条路径，只多一个 channel（AC-3）
    const applied = await this.opts.client.answer(askId, allowed, undefined, 'telegram')
    return applied ? (allowed ? tr('bridge.allowed') : tr('bridge.denied')) : tr('bridge.answeredElsewhere')
  }

  /** 白名单之外的消息：丢弃并记事件（AC-4） */
  async audit(detail: string): Promise<void> {
    try {
      await this.opts.client.recordAudit('bridge.telegram.rejected', detail)
    } catch (e) {
      // i18n-ignore：日志（PRD-M9-004 AC-5：日志不翻）
      this.opts.log?.(`bridge: 审计事件没记上：${String(e)}`)
    }
  }
}
