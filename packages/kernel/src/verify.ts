/**
 * 完成前验证的投影 —— PRD-M7-004 · SPEC-M7-004
 *
 * 纯函数：只看事件流（INV-13，不新增埋点）。判定靠命令模式匹配，不靠模型自报（SPEC 取舍-6）。
 */
import { type EventEnvelope, isKnownEvent } from '@domi/protocol'

export type VerifyState = 'clean' | 'unverified' | 'verified' | 'failed'

/** 默认认作「验证」的命令 */
export const DEFAULT_VERIFY_PATTERNS: readonly RegExp[] = [
  /\btest\b/,
  /\bcheck\b/,
  /\btsc\b/,
  /\blint\b/,
  /\bpytest\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bcargo\s+(test|check|clippy)\b/,
  /\bgo\s+(test|vet)\b/,
  /\bbiome\b/,
  /\beslint\b/,
  /\bmypy\b/,
  /\bruff\b/,
]

export interface VerifyOptions {
  /** 配置里写的验证命令；命令里包含它就算 */
  command?: string | undefined
}

export function isVerifyCommand(cmd: string, opts: VerifyOptions = {}): boolean {
  if (opts.command && cmd.includes(opts.command)) return true
  return DEFAULT_VERIFY_PATTERNS.some((re) => re.test(cmd))
}

/** 本轮（最后一条 user.input 之后）的验证状态 */
export function verifyState(events: readonly EventEnvelope[], opts: VerifyOptions = {}): VerifyState {
  let start = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i] as EventEnvelope).ev.t === 'user.input') {
      start = i
      break
    }
  }
  const calls = new Map<string, { name: string; cmd?: string }>()
  let changed = false
  let last: 'ok' | 'fail' | null = null
  for (let i = start; i < events.length; i++) {
    const ev = (events[i] as EventEnvelope).ev
    if (!isKnownEvent(ev)) continue
    if (ev.t === 'tool.call') {
      const a = ev.args as { cmd?: unknown } | null
      calls.set(ev.id, { name: ev.name, ...(a && typeof a.cmd === 'string' ? { cmd: a.cmd } : {}) })
    } else if (ev.t === 'fs.snapshot' && ev.phase === 'after') {
      changed = true
      last = null // 改动之前的验证不算数
    } else if (ev.t === 'tool.result') {
      const call = calls.get(ev.id)
      if (!call) continue
      const p = (ev.payload ?? {}) as { cmd?: unknown; exitCode?: unknown; running?: unknown; background?: unknown }
      // 前台 shell.exec 与后台 job 跑完后的 shell.output 都带 cmd 与 exitCode
      const cmd = typeof p.cmd === 'string' ? p.cmd : call.cmd
      if (call.name !== 'shell.exec' && call.name !== 'shell.output') continue
      if (!cmd || !isVerifyCommand(cmd, opts) || p.background === true || p.running === true) continue
      last = ev.ok && p.exitCode === 0 ? 'ok' : 'fail'
    }
  }
  if (last === 'ok') return 'verified'
  if (last === 'fail') return 'failed'
  return changed ? 'unverified' : 'clean'
}

/** 本轮已经追加过几次验证提示 */
export function verifyNudges(events: readonly EventEnvelope[]): number {
  let n = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const t = (events[i] as EventEnvelope).ev.t
    if (t === 'user.input') break
    if (t === 'verify.required') n++
  }
  return n
}
