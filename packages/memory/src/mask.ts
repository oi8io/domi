/**
 * 遮蔽（mask）—— PRD-M15-004（SPEC-M15-004 取舍-3/4，INV-12(a)(b)）
 *
 * **冷区一次决定、热区不动。** 旧的、用过的工具输出自动收起，窗口留给正在做的事；
 * 刚读的文件永远看得全（AC-1，R4 用例：刚读的 300 行文件模型能看到第 150 行）。
 *
 * 与 cleanup 同一条不变量：遮蔽只缩短**投影**，磁盘上的事件流一条不动（INV-01 / INV-12）。
 * 每条被遮蔽的 tool.result 都换成一行**指针**（工具名 / 参数摘要 / 原始大小 / 需要时重读），
 * 而不是凭空消失——「这里本来有东西」必须看得见，否则排查时人会以为那一步压根没发生。
 *
 * 热区 = 最近 K=10 步（model.request 为步起点）**且** 最近 T=32k token 的工具输出；
 * 双阈值满足其一不满足即冷区（步近但输出巨大、输出近但步远都算冷区）。
 * 单批至少腾出 X=8k token 才值得付一次缓存重写（clear_at_least 同理）；
 * 已遮蔽的 seq 记在 ctx.mask 事件里，投影时直接替换为指针，不再变（INV-12(b)）。
 */
import type { EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import { approxTokens, projectText, stableArgs } from './cleanup.ts'

/** 最近 K 步（每个 model.request 事件为一步起点） */
export const HOT_STEPS = 10
/** 最近 T token 的工具输出（以工具结果文本的估算量累加为时间轴） */
export const HOT_TOKENS = 32_000
/** 单批至少腾出 X token 才值得付一次缓存重写 */
export const BATCH_MIN_FREED = 8_000

export interface HotCold {
  /** 热区 tool.result 的 seq */
  hot: Set<number>
  /** 冷区 tool.result 的 seq（可遮蔽候选） */
  cold: Set<number>
}

/**
 * 热区 / 冷区划分（AC-1）。纯函数。
 * 从最新事件往回扫：遇 model.request 步计数 +1；工具结果按 projectText 估算累加 token。
 * 步 ≤ K 且 累计 token ≤ T → 热区；否则冷区。
 */
export function partitionHotCold(events: readonly EventEnvelope[]): HotCold {
  const hot = new Set<number>()
  const cold = new Set<number>()
  let steps = 0
  let tokens = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const env = events[i]
    if (env === undefined) continue
    const e = env.ev
    if (!isKnownEvent(e)) continue
    if (e.t === 'model.request') steps += 1
    if (e.t !== 'tool.result') continue
    const tk = approxTokens(projectText(e))
    // 0 基：steps=0 是最近一步；steps < 10 即最近 10 步内（取舍-3 K=10）
    if (steps < HOT_STEPS && tokens + tk <= HOT_TOKENS) hot.add(env.seq)
    else cold.add(env.seq)
    tokens += tk
  }
  return { hot, cold }
}

/** 收集被钉住的 seq（ctx.pin 事件流；解钉即删，AC-5） */
export function collectPinned(events: readonly EventEnvelope[]): Set<number> {
  const pinned = new Set<number>()
  for (const env of events) {
    const e = env.ev
    if (isKnownEvent(e) && e.t === 'ctx.pin') {
      if (e.pinned) pinned.add(e.seq)
      else pinned.delete(e.seq)
    }
  }
  return pinned
}

/** 收集已遮蔽的 seq（ctx.mask.seqs 并集；已遮蔽不再变，INV-12(b)） */
export function collectMasked(events: readonly EventEnvelope[]): Set<number> {
  const masked = new Set<number>()
  for (const env of events) {
    const e = env.ev
    if (isKnownEvent(e) && e.t === 'ctx.mask') for (const s of e.seqs) masked.add(s)
  }
  return masked
}

/** 一行指针文本：工具名 / 参数摘要 / 原始大小 / 需要时重读（AC-2） */
export function maskPointer(name: string, args: unknown, originalChars: number, seq: number): string {
  const summary = stableArgs(args)
  const trimmed = summary.length > 80 ? `${summary.slice(0, 80)}…` : summary
  return `[已遮蔽 · ${name}(${trimmed}) · 原始 ${originalChars} 字符 · 需要时重读 · seq ${seq}]`
}

/** tool.call 的 id → 调用信息（指针文本要用工具名与参数摘要） */
export function buildCallMap(events: readonly EventEnvelope[]): Map<string, { name: string; args: unknown }> {
  const byId = new Map<string, { name: string; args: unknown }>()
  for (const env of events) {
    const e = env.ev
    if (isKnownEvent(e) && e.t === 'tool.call') byId.set(e.id, { name: e.name, args: e.args })
  }
  return byId
}

export type MaskReason = 'cold' | 'dedup' | 'resolved_error' | 'truncate' | 'threshold'

export interface MaskOptions {
  /** 遮蔽原因。默认 threshold（超阈值预检触发） */
  reason?: MaskReason
  /** 单批最少腾出 token。默认 BATCH_MIN_FREED=8000 */
  minFreed?: number
}

export interface MaskDecision {
  seqs: number[]
  freedTokens: number
  reason: MaskReason
}

/**
 * 遮蔽决定（AC-3）：一批冷区 tool.result 换指针。
 * - 只选冷区，且跳过被钉住 / 已被遮蔽过的 seq（AC-5 + INV-12(b)）
 * - 工具调用与错误信息不在候选（AC-2：保留错误）
 * - 腾出不足 X token → 不落事件（不值得付一次缓存重写）
 * 事件流一条不改；调用方把返回值落成 ctx.mask 事件。
 */
export function computeMask(events: readonly EventEnvelope[], opts: MaskOptions = {}): MaskDecision {
  const reason = opts.reason ?? 'threshold'
  const minFreed = opts.minFreed ?? BATCH_MIN_FREED
  const pinned = collectPinned(events)
  const masked = collectMasked(events)
  const { cold } = partitionHotCold(events)
  const calls = buildCallMap(events)

  const seqs: number[] = []
  let freed = 0
  for (const env of events) {
    if (!cold.has(env.seq) || pinned.has(env.seq) || masked.has(env.seq)) continue
    const e = env.ev
    if (!isKnownEvent(e) || e.t !== 'tool.result') continue
    const text = projectText(e)
    const before = approxTokens(text)
    const info = calls.get(e.id)
    const pointer = maskPointer(info?.name ?? 'tool', info?.args ?? null, text.length, env.seq)
    const after = approxTokens(pointer)
    seqs.push(env.seq)
    freed += Math.max(0, before - after)
  }
  if (freed < minFreed) return { seqs: [], freedTokens: 0, reason }
  return { seqs, freedTokens: freed, reason }
}

/**
 * 把遮蔽决定落到投影：被遮蔽的 tool.result 替换成指针文本。
 * 事件流一条不动（INV-12）；返回的新数组只改了这一轮的 messages 形状。
 */
export function applyMask(events: readonly EventEnvelope[], seqs: readonly number[]): EventEnvelope[] {
  const toMask = new Set(seqs)
  if (toMask.size === 0) return [...events]
  const calls = buildCallMap(events)
  return events.map((env) => {
    if (!toMask.has(env.seq)) return env
    const e = env.ev
    if (!isKnownEvent(e) || e.t !== 'tool.result') return env
    const text = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)
    const info = calls.get(e.id)
    const pointer = maskPointer(info?.name ?? 'tool', info?.args ?? null, text.length, env.seq)
    return { ...env, ev: { ...e, payload: pointer } }
  })
}
