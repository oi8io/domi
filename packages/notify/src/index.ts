/**
 * 长任务通知 —— PRD-M5-004 · docs/adr/021 · INV-11
 *
 * 两条规矩：
 * 1. **旁路**：渠道失败只记一行日志，不抛——通知坏了不能让任务失败（AC-4）。
 * 2. **只发状态，不发内容**：payload 只有类型、标题、运行 / 节点 id 与一句说明；
 *    发出前整体再过一遍凭据脱敏（与事件落盘同一份正则，AC-3）。
 */
import { spawn } from 'node:child_process'
import { redactString } from '@domi/store'

export type NotifyKind = 'done' | 'failed' | 'approval'

export interface Notification {
  kind: NotifyKind
  title: string
  detail: string
  runId?: string
  nodeId?: string
  sessionId?: string
}

export interface NotifyConfig {
  system?: boolean
  webhook?: { url: string; headers?: Record<string, string> | undefined } | undefined
}

export interface NotifierDeps {
  /** 执行系统命令（测试替换）。返回退出码 */
  exec?: (cmd: string, args: string[]) => Promise<number>
  fetch?: typeof globalThis.fetch
  platform?: NodeJS.Platform
  log?: (line: string) => void
  timeoutMs?: number
}

const MAX_TITLE = 80
const MAX_DETAIL = 200
/** 控制字符（保留换行与制表）。用码点判断而不是正则：lint 不许正则里写控制字符 */
function stripControl(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if ((c < 0x20 && c !== 0x0a && c !== 0x09) || c === 0x7f) continue
    out += ch
  }
  return out
}

/** 出站前的最后一道：截短、脱敏、去掉控制字符 */
export function sanitize(n: Notification): Notification {
  const clean = (s: string, max: number): string => stripControl(redactString(s)).slice(0, max)
  return {
    kind: n.kind,
    title: clean(n.title, MAX_TITLE),
    detail: clean(n.detail, MAX_DETAIL),
    ...(n.runId === undefined ? {} : { runId: n.runId }),
    ...(n.nodeId === undefined ? {} : { nodeId: n.nodeId }),
    ...(n.sessionId === undefined ? {} : { sessionId: n.sessionId }),
  }
}

function defaultExec(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.once('error', () => resolve(127))
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

/** AppleScript 字符串字面量 */
function osa(s: string): string {
  return JSON.stringify(s)
}

export class Notifier {
  constructor(
    private readonly config: NotifyConfig,
    private readonly deps: NotifierDeps = {},
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.system) || this.config.webhook !== undefined
  }

  /** 不抛。返回各渠道是否成功，给日志与测试看 */
  async send(raw: Notification): Promise<{ system?: boolean; webhook?: boolean }> {
    const n = sanitize(raw)
    const [system, webhook] = await Promise.all([
      this.config.system ? this.system(n) : Promise.resolve(undefined),
      this.config.webhook ? this.webhook(n) : Promise.resolve(undefined),
    ])
    return {
      ...(system === undefined ? {} : { system }),
      ...(webhook === undefined ? {} : { webhook }),
    }
  }

  private async system(n: Notification): Promise<boolean> {
    const exec = this.deps.exec ?? defaultExec
    const platform = this.deps.platform ?? process.platform
    try {
      const code =
        platform === 'darwin'
          ? await exec('osascript', [
              '-e',
              `display notification ${osa(n.detail)} with title ${osa(`domi · ${n.title}`)}`,
            ])
          : platform === 'linux'
            ? await exec('notify-send', ['--app-name=domi', `domi · ${n.title}`, n.detail])
            : 127
      if (code !== 0) this.deps.log?.(`notify: 系统通知没发出去（退出码 ${code}）`)
      return code === 0
    } catch (e) {
      this.deps.log?.(`notify: 系统通知失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  private async webhook(n: Notification): Promise<boolean> {
    const hook = this.config.webhook
    if (!hook) return false
    const f = this.deps.fetch ?? globalThis.fetch
    try {
      const res = await f(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(hook.headers ?? {}) },
        body: JSON.stringify({ source: 'domi', ...n }),
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? 5000),
      })
      if (!res.ok) this.deps.log?.(`notify: webhook 回了 HTTP ${res.status}`)
      return res.ok
    } catch (e) {
      this.deps.log?.(`notify: webhook 失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
}
