/**
 * LLM 压缩：保边压中 + 结构化摘要 —— PRD-M2-003 · 守 INV-12
 *
 * **压缩不是删历史，是换一种方式把中间那段讲给模型听。**
 * 原始事件一条没动、一个字节没改（INV-12）——`ctx.compact` 只是又一条**追加**的事件。
 * AC-5 的"压缩后从原始事件流重放仍然等价"因此是**免费**得到的，
 * 不需要另写一套还原逻辑：因为压根没有东西被改掉。
 *
 * 「保边」是两头：**system prompt 逐字保留**（它是 prompt cache 的前缀，动一下全场失效），
 * **最近 N 轮逐字保留**（正在做的事最需要细节）。压的是中间——那部分已经变成背景了。
 *
 * 摘要是**固定字段**而不是自由文本（AC-3）。自由文本摘要有三个问题：
 * 没法断言、没法比较、下一次压缩还得把它再压一遍。
 */
import type { AnyEvent, EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import { z } from 'zod'
import { approxTokens, projectText } from './cleanup.ts'

/** AC-3：固定字段结构，经 zod 校验，非自由文本 */
export const SummarySchema = z.object({
  /** 用户到底想干成什么 —— 丢了它，压缩之后模型就开始做别的事 */
  intent: z.string(),
  filesModified: z.array(z.string()),
  keyDecisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  nextSteps: z.array(z.string()),
})
export type Summary = z.infer<typeof SummarySchema>

export type CompactEvent = Extract<AnyEvent, { t: 'ctx.compact' }>

/** AC-1：窗口用量落在这个区间就该压了 */
export const TRIGGER_LOW = 0.7
export const TRIGGER_HIGH = 0.75

/**
 * 该不该压。
 *
 * 阈值给的是**区间**而不是一个点：正好卡在 70% 抖动的会话会反复触发压缩，
 * 而每次压缩都是一次真实模型调用。所以到 70% 就压，别等 75%——
 * 75% 是"最晚也该压了"的上限，不是触发点。
 */
export function shouldCompact(usedTokens: number, maxTokens: number): boolean {
  if (maxTokens <= 0) return false
  return usedTokens / maxTokens >= TRIGGER_LOW
}

/** 摘要生成器由外面注入 —— packages/memory 不依赖 @domi/model（INV-02） */
export type Summarizer = (input: { text: string; events: readonly EventEnvelope[] }) => Promise<unknown>

export interface CompactOptions {
  summarize: Summarizer
  /** 逐字保留的最近轮数。一轮 = 一次 user.input 到下一次之前 */
  keepTurns?: number
  trigger?: 'threshold' | 'manual'
}

export interface CompactResult {
  event: CompactEvent
  summary: Summary
  /** 被摘要覆盖的事件（只用于断言与展示，事件流里它们原样还在） */
  covered: readonly EventEnvelope[]
  /** 逐字保留的事件 */
  kept: readonly EventEnvelope[]
}

export class SummaryShapeError extends Error {
  constructor(readonly issues: string[]) {
    super(`摘要结构不合法：${issues.join('; ')}\n（AC-3 要求固定字段，不接受自由文本）`)
    this.name = 'SummaryShapeError'
  }
}

/** 按 user.input 切轮 —— 返回每一轮的起始下标 */
export function turnStarts(events: readonly EventEnvelope[]): number[] {
  const starts: number[] = []
  for (const [i, e] of events.entries()) {
    if (isKnownEvent(e.ev) && e.ev.t === 'user.input') starts.push(i)
  }
  return starts
}

export async function compact(events: readonly EventEnvelope[], opts: CompactOptions): Promise<CompactResult> {
  const keepTurns = opts.keepTurns ?? 2
  const starts = turnStarts(events)
  // 保留最近 keepTurns 轮；不足这么多轮时一条都不压——压了也省不下什么，
  // 反而把正在进行的事情变模糊
  const cut = starts.length > keepTurns ? (starts[starts.length - keepTurns] ?? events.length) : 0

  const covered = events.slice(0, cut)
  const kept = events.slice(cut)

  const text = covered.map((e) => `[${e.seq}] ${projectText(e.ev)}`).join('\n')
  const raw = await opts.summarize({ text, events: covered })

  const parsed = SummarySchema.safeParse(raw)
  if (!parsed.success) {
    throw new SummaryShapeError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
  }
  const summary = parsed.data

  const tokensBefore = events.reduce((s, e) => s + approxTokens(projectText(e.ev)), 0)
  const summaryTokens = approxTokens(JSON.stringify(summary))
  const tokensAfter = kept.reduce((s, e) => s + approxTokens(projectText(e.ev)), 0) + summaryTokens

  return {
    summary,
    covered,
    kept,
    event: {
      t: 'ctx.compact',
      fromSeq: covered[0]?.seq ?? 0,
      toSeq: covered[covered.length - 1]?.seq ?? 0,
      keptTurns: Math.min(keepTurns, starts.length),
      tokensBefore,
      tokensAfter,
      trigger: opts.trigger ?? 'threshold',
      summary,
    },
  }
}

/** 摘要渲染成一条 user 消息的文本。固定字段 → 固定格式，压缩前后可比对 */
export function renderSummary(s: Summary): string {
  const list = (title: string, items: readonly string[]): string =>
    items.length === 0 ? `${title}：（无）` : `${title}：\n${items.map((x) => `  - ${x}`).join('\n')}`
  return [
    '【以下是更早历史的结构化摘要，不是用户的新指令】',
    `目标：${s.intent}`,
    list('改过的文件', s.filesModified),
    list('关键决定', s.keyDecisions),
    list('未决问题', s.openQuestions),
    list('下一步', s.nextSteps),
    '【摘要结束】',
  ].join('\n')
}
