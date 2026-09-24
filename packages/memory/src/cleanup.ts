/**
 * 确定性上下文清理（压缩第一层）—— PRD-M2-002
 *
 * **第一层压缩不该动用模型。** 去重、截断、清掉已解决的错误，这些判断都是确定性的；
 * 花钱让模型来做同一件事，既慢又引入不确定性，而且每次结果都不一样——
 * 那会让 L1 回放评估（PRD-M2-008）当场失效。所以 AC-3 明确要求全程无 LLM 调用。
 *
 * **一条贯穿全文的设计不变量：清理只缩短投影，从不删除事件。**
 * 磁盘上的事件流一条不动（INV-01 / INV-12），清理改的只是「这一轮送给模型的上下文长什么样」。
 * 每条被处理过的事件都留下一个可读的标记，而不是凭空消失——
 * 「这里本来有东西」必须看得见，否则排查时人会以为那一步压根没发生。
 */
import type { AnyEvent, EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'

/** 粗略 token 估算，与 @domi/prompt 的 approxTokens 同口径（4 字符 ≈ 1 token） */
export function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

export const RULES = ['dedupe', 'verbose', 'resolvedError', 'stack'] as const
export type RuleId = (typeof RULES)[number]

export interface CleanupOptions {
  /** 超过这个字符数的工具结果会被截断。默认 2000 */
  maxResultChars?: number
  /** 截断时保留的头部字符数。默认 1200 */
  headChars?: number
  /** 截断时保留的尾部字符数。默认 400 —— 尾部常常是结论（"FAILED"、退出码） */
  tailChars?: number
  /** 堆栈保留的帧数。默认 3 */
  stackFrames?: number
}

const DEFAULTS: Required<CleanupOptions> = {
  maxResultChars: 2000,
  headChars: 1200,
  tailChars: 400,
  stackFrames: 3,
}

export interface CleanedItem {
  seq: number
  /** 清理后的文本投影。没被动过的事件这里就是原文 */
  text: string
  /** 动过它的规则；空数组表示原样保留 */
  appliedRules: RuleId[]
  /** 因为被后续事件显式引用而整条保留 */
  preserved: boolean
}

export interface CleanupResult {
  items: CleanedItem[]
  tokensBefore: number
  tokensAfter: number
  saved: Record<RuleId, number>
  preserved: number[]
  /** 直接可以 append 的事件（AC-4） */
  event: Extract<AnyEvent, { t: 'ctx.cleanup' }>
}

/**
 * 收集「被后续事件引用过」的 seq。
 *
 * **只认显式标注，不做推断。** 推断引用关系的代价是不对称的：
 * 漏判一次就等于把别人还要用的内容删了，而多保留一条只是少省一点 token。
 * 所以这里的规则是死的——事件上带 `refs: number[]` 才算数（AC-2 说的"由 fixture 显式标注"），
 * 将来由 kernel 在构造上下文时写进去。
 */
export function collectReferences(events: readonly EventEnvelope[]): Set<number> {
  const refs = new Set<number>()
  for (const env of events) {
    const raw = env.ev as unknown as { refs?: unknown }
    if (!Array.isArray(raw.refs)) continue
    for (const r of raw.refs) if (typeof r === 'number' && Number.isInteger(r) && r > 0) refs.add(r)
  }
  return refs
}

/** 事件的文本投影 —— 上下文里真正占 token 的就是它 */
export function projectText(ev: AnyEvent): string {
  if (!isKnownEvent(ev)) return JSON.stringify(ev)
  switch (ev.t) {
    case 'user.input':
    case 'user.note':
      return ev.text
    case 'model.delta':
    case 'model.reason':
      return ev.text
    case 'tool.call':
      return `${ev.name}(${stableArgs(ev.args)})`
    case 'tool.result':
      return typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)
    case 'error':
      return `${ev.scope}: ${ev.message}`
    default:
      return JSON.stringify(ev)
  }
}

/** 参数的稳定序列化：键排序，这样 `{a,b}` 与 `{b,a}` 算同一次调用 */
export function stableArgs(args: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = walk((v as Record<string, unknown>)[k])
      return out
    }
    return v
  }
  return JSON.stringify(walk(args))
}

const STACK_FRAME = /^\s+at\s+.+$/gm

/** 截断堆栈：留前几帧。栈底那些框架代码帧对定位问题从来没帮过忙 */
export function truncateStack(text: string, frames: number): { text: string; saved: number } {
  const matches = text.match(STACK_FRAME)
  if (!matches || matches.length <= frames) return { text, saved: 0 }
  const keep = matches.slice(0, frames)
  const dropped = matches.slice(frames)
  const droppedChars = dropped.join('\n').length
  let out = text
  for (const d of dropped) out = out.replace(`${d}\n`, '').replace(d, '')
  out = `${out.trimEnd()}\n    […省略 ${dropped.length} 帧，共 ${droppedChars} 字符…]`
  void keep
  return { text: out, saved: Math.max(0, text.length - out.length) }
}

/** 截断冗长输出：头 + 尾。尾部常常是结论，只留头会把"最后失败了"截掉 */
export function truncateVerbose(text: string, o: Required<CleanupOptions>): { text: string; saved: number } {
  if (text.length <= o.maxResultChars) return { text, saved: 0 }
  const head = text.slice(0, o.headChars)
  const tail = text.slice(-o.tailChars)
  const omitted = text.length - o.headChars - o.tailChars
  const out = `${head}\n[…已截断 ${omitted} 字符…]\n${tail}`
  return { text: out, saved: Math.max(0, text.length - out.length) }
}

interface CallInfo {
  seq: number
  key: string
  name: string
}

export function cleanup(events: readonly EventEnvelope[], opts: CleanupOptions = {}): CleanupResult {
  const o = { ...DEFAULTS, ...opts }
  const preservedSet = collectReferences(events)

  // 第一遍：把 tool.call 的 id 映射到「调用指纹」，tool.result 才知道自己是谁的结果
  const callById = new Map<string, CallInfo>()
  for (const env of events) {
    const ev = env.ev
    if (isKnownEvent(ev) && ev.t === 'tool.call') {
      callById.set(ev.id, { seq: env.seq, key: `${ev.name}#${stableArgs(ev.args)}`, name: ev.name })
    }
  }

  // 同一指纹的成功结果出现在哪些 seq —— 去重要保留**最后一次**（它才是当前状态）
  const successSeqsByKey = new Map<string, number[]>()
  const failSeqsByKey = new Map<string, number[]>()
  for (const env of events) {
    const ev = env.ev
    if (!isKnownEvent(ev) || ev.t !== 'tool.result') continue
    const info = callById.get(ev.id)
    if (!info) continue
    const bucket = ev.ok ? successSeqsByKey : failSeqsByKey
    const list = bucket.get(info.key) ?? []
    list.push(env.seq)
    bucket.set(info.key, list)
  }

  const saved: Record<RuleId, number> = { dedupe: 0, verbose: 0, resolvedError: 0, stack: 0 }
  const items: CleanedItem[] = []
  let tokensBefore = 0

  for (const env of events) {
    const ev = env.ev
    const original = projectText(ev)
    tokensBefore += approxTokens(original)

    const preserved = preservedSet.has(env.seq)
    if (preserved) {
      items.push({ seq: env.seq, text: original, appliedRules: [], preserved: true })
      continue
    }

    let text = original
    const applied: RuleId[] = []

    if (isKnownEvent(ev) && ev.t === 'tool.result') {
      const info = callById.get(ev.id)
      const key = info?.key

      // 规则 1 · 去重：同一次调用的**旧**结果换成一行指针，最后一次保持原样
      if (ev.ok && key !== undefined) {
        const all = successSeqsByKey.get(key) ?? []
        const last = all[all.length - 1]
        if (all.length > 1 && last !== undefined && env.seq !== last) {
          const replacement = `[已去重：${info?.name ?? '同一调用'} 的结果与第 ${last} 条相同]`
          saved.dedupe += Math.max(0, approxTokens(text) - approxTokens(replacement))
          text = replacement
          applied.push('dedupe')
        }
      }

      // 规则 3 · 清除已解决的错误：失败之后同一调用又成功了，失败详情只留一行
      if (!ev.ok && key !== undefined) {
        const later = (successSeqsByKey.get(key) ?? []).filter((s) => s > env.seq)
        if (later.length > 0) {
          const replacement = `[错误已解决：${info?.name ?? '该调用'} 于第 ${later[0]} 条成功]`
          saved.resolvedError += Math.max(0, approxTokens(text) - approxTokens(replacement))
          text = replacement
          applied.push('resolvedError')
        }
      }
    }

    // 规则 3 续 · 独立的 error 事件：后面同一 scope 没再出错，且有成功的工具结果，就算已解决
    if (isKnownEvent(ev) && ev.t === 'error' && applied.length === 0 && ev.recoverable) {
      const resolvedLater = events.some(
        (e) => e.seq > env.seq && isKnownEvent(e.ev) && e.ev.t === 'tool.result' && e.ev.ok,
      )
      if (resolvedLater) {
        const replacement = `[错误已解决：${ev.scope}]`
        saved.resolvedError += Math.max(0, approxTokens(text) - approxTokens(replacement))
        text = replacement
        applied.push('resolvedError')
      }
    }

    // 规则 4 · 截断堆栈（在长度截断之前——先扔掉最没用的部分，再看还长不长）
    if (!applied.includes('dedupe') && !applied.includes('resolvedError')) {
      const st = truncateStack(text, o.stackFrames)
      if (st.saved > 0) {
        saved.stack += approxTokens(text) - approxTokens(st.text)
        text = st.text
        applied.push('stack')
      }

      // 规则 2 · 冗长输出
      const vb = truncateVerbose(text, o)
      if (vb.saved > 0) {
        saved.verbose += approxTokens(text) - approxTokens(vb.text)
        text = vb.text
        applied.push('verbose')
      }
    }

    items.push({ seq: env.seq, text, appliedRules: applied, preserved: false })
  }

  const tokensAfter = items.reduce((s, i) => s + approxTokens(i.text), 0)
  const first = events[0]
  const last = events[events.length - 1]

  return {
    items,
    tokensBefore,
    tokensAfter,
    saved,
    preserved: [...preservedSet].sort((a, b) => a - b),
    event: {
      t: 'ctx.cleanup',
      fromSeq: first?.seq ?? 0,
      toSeq: last?.seq ?? 0,
      tokensBefore,
      tokensAfter,
      saved,
      preserved: [...preservedSet].sort((a, b) => a - b),
    },
  }
}
