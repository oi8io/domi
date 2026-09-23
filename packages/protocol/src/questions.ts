/**
 * 问题框的契约 —— PRD-M12-004 AC-7 · SPEC-M12-004 第二轮 取舍-1
 *
 * 形态照 Claude Code 的 AskUserQuestion：模型一次问 1–4 题，每题 2–4 个选项（a–d，各带一句说明），
 * 标签 ≤12 字做 tab；「其他」（用户自己写）不用模型声明，永远有。
 *
 * 传输复用 session.ask 的 form，不加协议字段：form.schema 里同时带
 * - 扩展键 `x-domi-questions`：问题原样，认识它的端（Web、TUI）画多 tab；
 * - 一份普通 JSON Schema（q1 / q1_other …）：不认识的端（旧客户端、Telegram 桥接）照普通表单画。
 * 两种回答 normalizeAnswers 都认。放在 protocol 是因为 runtime 与两端要用同一份。
 */
import { z } from 'zod'

export const QUESTIONS_KEY = 'x-domi-questions'

export const QuestionOptionSchema = z.object({
  label: z.string().min(1).max(80),
  /** 这个选项意味着什么、有什么取舍。可以不写 */
  description: z.string().max(400).optional(),
})

export const QuestionSchema = z
  .object({
    /** tab 上的短标签，≤12 字（「存储」「范围」） */
    header: z.string().min(1).max(12),
    question: z.string().min(1).max(600),
    options: z.array(QuestionOptionSchema).min(2).max(4),
    /** 可以多选。不给 = 单选 */
    multiSelect: z.boolean().optional(),
  })
  .refine((q) => new Set(q.options.map((o) => o.label)).size === q.options.length, {
    message: '同一题里选项的 label 不能重名——答案按 label 对回去',
    path: ['options'],
  })

export const QuestionsSchema = z.array(QuestionSchema).min(1).max(4)

export type Question = z.infer<typeof QuestionSchema>

/** 一题的回答：选中的选项 label（按选项顺序）+ 用户自己写的 */
export interface QuestionAnswer {
  header: string
  question: string
  selected: string[]
  other?: string
}

/** 新端回的 content：按题序 */
export interface QuestionsContent {
  answers: Array<{ selected?: string[]; other?: string }>
}

/** 问题 → 询问表单。otherLabel 是「其他」的文案（按当前界面语言，由调用方给） */
export function questionsToForm(
  questions: readonly Question[],
  otherLabel: string,
): { message: string; schema: Record<string, unknown> } {
  const properties: Record<string, unknown> = {}
  questions.forEach((q, i) => {
    const key = `q${i + 1}`
    properties[key] = { type: 'string', title: `${q.header} · ${q.question}`, enum: q.options.map((o) => o.label) }
    properties[`${key}_other`] = { type: 'string', title: `${q.header} · ${otherLabel}` }
  })
  return {
    message: questions.map((q) => q.question).join('\n'),
    schema: { type: 'object', [QUESTIONS_KEY]: questions, properties },
  }
}

/** 从询问表单里认出问题框；不是问题框（或内容坏了）返回 null，不抛错 */
export function questionsOf(schema: unknown): Question[] | null {
  if (schema === null || typeof schema !== 'object') return null
  const raw = (schema as Record<string, unknown>)[QUESTIONS_KEY]
  if (raw === undefined) return null
  const r = QuestionsSchema.safeParse(raw)
  return r.success ? r.data : null
}

function trimmed(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/**
 * 两种回答都认，产出按题序的答案。不在选项里的 label 丢掉；单选题只留第一个——宁可少，不替人编。
 */
export function normalizeAnswers(questions: readonly Question[], content: Record<string, unknown>): QuestionAnswer[] {
  const rich = Array.isArray(content.answers) ? (content.answers as QuestionsContent['answers']) : null
  return questions.map((q, i) => {
    let picked: string[]
    let other: string | undefined
    if (rich) {
      const a = rich[i] ?? {}
      picked = Array.isArray(a.selected) ? a.selected.filter((x): x is string => typeof x === 'string') : []
      other = trimmed(a.other)
    } else {
      const v = content[`q${i + 1}`]
      picked = typeof v === 'string' ? [v] : []
      other = trimmed(content[`q${i + 1}_other`])
    }
    const labels = q.options.map((o) => o.label)
    let selected = labels.filter((l) => picked.includes(l))
    if (q.multiSelect !== true) selected = selected.slice(0, 1)
    return { header: q.header, question: q.question, selected, ...(other === undefined ? {} : { other }) }
  })
}

/** 一题的答案读成一句话：选中的用「、」连，自定义的接在「；」后面 */
export function answerText(a: QuestionAnswer): string {
  const picked = a.selected.join('、')
  if (a.other === undefined) return picked
  return picked === '' ? a.other : `${picked}；${a.other}`
}
