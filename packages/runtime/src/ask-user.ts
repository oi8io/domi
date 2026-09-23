/**
 * ask.user —— 模型向用户提问（PRD-M12-004 AC-7 · SPEC-M12-004 第二轮 取舍-1）
 *
 * 形态照 Claude Code 的 AskUserQuestion：一次 1–4 题，每题 2–4 个选项 + 用户自己写。
 * 它是「和用户说话」，不碰外部世界：runtime 内置放行（INTRINSIC_RULES），不进危险清单。
 * 走询问通道（ctx.elicit）：form 带扩展键，认识的端画多 tab，不认识的端按普通表单降级。
 */
import type { Tool } from '@domi/capability'
import { tr } from '@domi/i18n'
import { answerText, normalizeAnswers, QuestionsSchema, questionsToForm } from '@domi/protocol'
import { z } from 'zod'

export const ASK_USER_CAPABILITY = 'ask.user'

export const AskUserArgs = z.object({
  questions: QuestionsSchema.describe(
    '1–4 个问题。每题：header（≤12 字的短标签，做 tab）、question（完整的问题）、options（2–4 个，label + 一句 description 说清取舍）、multiSelect（可多选时 true）。用户总能自己写答案，不用加「其他」选项',
  ),
})
export type AskUserArgs = z.infer<typeof AskUserArgs>

export interface AskUserResult {
  answered: boolean
  answers?: Array<{ header: string; question: string; answer: string }>
  message?: string
}

export function makeAskUserTool(): Tool<AskUserArgs, AskUserResult> {
  return {
    name: 'ask.user',
    capability: ASK_USER_CAPABILITY,
    description:
      '向用户提问，等用户选好再继续。用在需要用户拍板、猜错代价大的地方（方案取舍、范围、命名、要不要动某个东西）。' +
      '能自己查到或有稳妥默认值的事不要问；一次把相关的问题问完（最多 4 题），不要一题一题地挤牙膏。',
    schema: AskUserArgs,
    async execute(args, ctx) {
      if (!ctx.elicit) {
        return {
          answered: false,
          message: '现在没有人能回答。不要替用户选：按最稳妥、可逆的理解继续，或者停下来说明需要用户决定什么。',
        }
      }
      const form = questionsToForm(args.questions, tr('core.ask.other'))
      const r = await ctx.elicit({ message: form.message, requestedSchema: form.schema })
      if (r.action !== 'accept') {
        return {
          answered: false,
          message: '用户没有回答（拒绝了这次提问）。不要替用户选；换个问法，或者说明需要用户决定什么后结束这一轮。',
        }
      }
      const answers = normalizeAnswers(args.questions, r.content ?? {})
      return {
        answered: true,
        answers: answers.map((a) => ({ header: a.header, question: a.question, answer: answerText(a) })),
      }
    },
  }
}
