/**
 * 问题框的契约 —— PRD-M12-004 AC-7 · SPEC-M12-004 第二轮 取舍-1
 *
 * 形态照 Claude Code 的 AskUserQuestion：1–4 题、每题 2–4 个选项、标签 ≤12 字；「其他」永远有。
 * 传输复用 session.ask 的 form：扩展键 + 一份普通表单做降级。
 */
import { describe, expect, test } from 'bun:test'
import {
  answerText,
  normalizeAnswers,
  QUESTIONS_KEY,
  type Question,
  QuestionsSchema,
  questionsOf,
  questionsToForm,
} from '../src/index.ts'

const q = (header: string, n = 2, multiSelect?: boolean): Question => ({
  header,
  question: `${header} 怎么选？`,
  options: Array.from({ length: n }, (_, i) => ({ label: `选项${i + 1}`, description: `说明${i + 1}` })),
  ...(multiSelect === undefined ? {} : { multiSelect }),
})

describe('PRD-M12-004 AC-7 · 问题的边界', () => {
  test('1–4 题、每题 2–4 个选项、标签不超过 12 个字', () => {
    expect(QuestionsSchema.safeParse([q('存储')]).success).toBe(true)
    expect(QuestionsSchema.safeParse([q('a'), q('b'), q('c'), q('d')]).success).toBe(true)
    expect(QuestionsSchema.safeParse([]).success).toBe(false)
    expect(QuestionsSchema.safeParse([q('a'), q('b'), q('c'), q('d'), q('e')]).success).toBe(false)
    expect(QuestionsSchema.safeParse([q('a', 1)]).success).toBe(false)
    expect(QuestionsSchema.safeParse([q('a', 5)]).success).toBe(false)
    expect(QuestionsSchema.safeParse([q('一二三四五六七八九十一二三')]).success).toBe(false)
  })

  test('选项说明可以不写（模型常省略）', () => {
    const r = QuestionsSchema.safeParse([{ header: 'x', question: '?', options: [{ label: 'a' }, { label: 'b' }] }])
    expect(r.success).toBe(true)
  })

  test('同一题里选项重名不行：答案按标签对回去，重名就分不清', () => {
    const r = QuestionsSchema.safeParse([{ header: 'x', question: '?', options: [{ label: 'a' }, { label: 'a' }] }])
    expect(r.success).toBe(false)
  })
})

describe('PRD-M12-004 AC-7 · 表单：扩展键 + 降级字段', () => {
  const form = questionsToForm([q('存储'), q('范围', 3, true)], '其他')

  test('扩展键原样带着问题，认识它的端画多 tab', () => {
    expect(questionsOf(form.schema)).toEqual([q('存储'), q('范围', 3, true)])
  })

  test('不认识扩展键的端（旧客户端、Telegram）看到的是普通表单：每题一个枚举 + 一个自定义输入', () => {
    const props = (form.schema as { properties: Record<string, { type: string; enum?: string[]; title: string }> })
      .properties
    expect(Object.keys(props)).toEqual(['q1', 'q1_other', 'q2', 'q2_other'])
    expect(props.q1?.enum).toEqual(['选项1', '选项2'])
    expect(props.q1?.title).toContain('存储')
    expect(props.q1_other?.title).toContain('其他')
    expect(form.message).toContain('存储 怎么选？')
  })

  test('questionsOf 对不是问题框的 schema 返回 null，不抛错', () => {
    expect(questionsOf({ type: 'object', properties: {} })).toBeNull()
    expect(questionsOf(null)).toBeNull()
    expect(questionsOf({ [QUESTIONS_KEY]: 'garbage' })).toBeNull()
  })
})

describe('PRD-M12-004 AC-7 · 两种回答都认', () => {
  const qs = [q('存储'), q('范围', 3, true)]

  test('新端：answers 按题序，选中的标签 + 自定义', () => {
    const a = normalizeAnswers(qs, {
      answers: [{ selected: ['选项2'] }, { selected: ['选项1', '选项3'], other: ' 还有 CLI ' }],
    })
    expect(a.map(answerText)).toEqual(['选项2', '选项1、选项3；还有 CLI'])
    expect(a[0]).toMatchObject({ header: '存储', question: '存储 怎么选？' })
  })

  test('降级表单：q1 / q1_other', () => {
    const a = normalizeAnswers(qs, { q1: '选项1', q2_other: '都不要' })
    expect(a.map(answerText)).toEqual(['选项1', '都不要'])
  })

  test('单选题只认一个；不在选项里的标签丢掉，不替人编', () => {
    const a = normalizeAnswers(qs, { answers: [{ selected: ['选项1', '选项2', '瞎编'] }, { selected: ['瞎编'] }] })
    expect(a[0]?.selected).toEqual(['选项1'])
    expect(a[1]?.selected).toEqual([])
    expect(answerText(a[1]!)).toBe('')
  })
})
