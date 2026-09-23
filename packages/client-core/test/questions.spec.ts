/**
 * 问题框的交互状态 —— PRD-M12-004 AC-7（Web 与 TUI 共用一份，端上只管画）
 *
 * 照 Claude Code 的 AskUserQuestion：每题一个 tab，最后一个 tab 核对后提交；
 * 单选选中就跳下一题；多选来回勾；「其他」永远在最后一行，写了字就算答了。
 */
import { describe, expect, test } from 'bun:test'
import type { Question } from '@domi/protocol'
import { answeredFlags, initQuestions, type QuestionsState, questionsContent, reduceQuestions } from '../src/index.ts'

const QS: Question[] = [
  { header: '存储', question: '存哪？', options: [{ label: 'SQLite' }, { label: 'Postgres' }] },
  {
    header: '端',
    question: '哪几端？',
    options: [{ label: 'Web' }, { label: 'TUI' }, { label: 'Desktop' }],
    multiSelect: true,
  },
]

const run = (...actions: Parameters<typeof reduceQuestions>[2][]): QuestionsState =>
  actions.reduce((s, a) => reduceQuestions(QS, s, a), initQuestions(QS))

describe('PRD-M12-004 AC-7 · 问题框状态机', () => {
  test('初始：第一题、光标在第一个选项、什么都没答', () => {
    const s = initQuestions(QS)
    expect(s.tab).toBe(0)
    expect(s.cursor).toEqual([0, 0])
    expect(answeredFlags(QS, s)).toEqual([false, false])
  })

  test('单选：选中即跳到下一题；再选别的会替换', () => {
    const s = run({ t: 'pick', label: 'SQLite' })
    expect(s.tab).toBe(1)
    const s2 = reduceQuestions(QS, { ...s, tab: 0 }, { t: 'pick', label: 'Postgres' })
    expect(s2.selected[0]).toEqual(['Postgres'])
  })

  test('多选：来回勾，不自动跳', () => {
    const s = run(
      { t: 'tab', to: 1 },
      { t: 'pick', label: 'Web' },
      { t: 'pick', label: 'TUI' },
      { t: 'pick', label: 'Web' },
    )
    expect(s.selected[1]).toEqual(['TUI'])
    expect(s.tab).toBe(1)
  })

  test('键盘：↑↓ 在选项和「其他」之间移动，回车 / 空格选光标所在的那个', () => {
    const s = run({ t: 'move', delta: 1 }, { t: 'choose' })
    expect(s.selected[0]).toEqual(['Postgres'])
    // 光标到「其他」再回车 = 进入输入
    const s2 = run({ t: 'move', delta: 1 }, { t: 'move', delta: 1 }, { t: 'choose' })
    expect(s2.editing).toBe(true)
    expect(s2.cursor[0]).toBe(2)
    // 到底不越界
    expect(run({ t: 'move', delta: 1 }, { t: 'move', delta: 1 }, { t: 'move', delta: 1 }).cursor[0]).toBe(2)
    expect(run({ t: 'move', delta: -1 }).cursor[0]).toBe(0)
  })

  test('字母 a–d 直接选对应选项（超出的忽略）', () => {
    expect(run({ t: 'letter', ch: 'b' }).selected[0]).toEqual(['Postgres'])
    expect(run({ t: 'letter', ch: 'd' }).selected[0]).toEqual([])
  })

  test('「其他」：打字、退格；单选题写了自定义就清掉选项（二者择一），多选题两个都留', () => {
    const s = run(
      { t: 'pick', label: 'SQLite' },
      { t: 'tab', to: 0 },
      { t: 'edit', on: true },
      { t: 'type', text: '内存' },
      { t: 'backspace' },
      { t: 'type', text: '存' },
    )
    expect(s.other[0]).toBe('内存')
    expect(s.selected[0]).toEqual([])
    const m = run({ t: 'tab', to: 1 }, { t: 'pick', label: 'Web' }, { t: 'setOther', text: 'CLI' })
    expect(m.selected[1]).toEqual(['Web'])
    expect(m.other[1]).toBe('CLI')
  })

  test('tab：左右切，最后一个是核对页；不越界', () => {
    expect(run({ t: 'next' }, { t: 'next' }, { t: 'next' }).tab).toBe(2)
    expect(run({ t: 'prev' }).tab).toBe(0)
  })

  test('提交内容：按题序，给 normalizeAnswers 用', () => {
    const s = run({ t: 'pick', label: 'Postgres' }, { t: 'pick', label: 'Web' }, { t: 'setOther', text: ' 以后再说 ' })
    expect(questionsContent(QS, s)).toEqual({
      answers: [{ selected: ['Postgres'] }, { selected: ['Web'], other: '以后再说' }],
    })
    expect(answeredFlags(QS, s)).toEqual([true, true])
  })
})

describe('PRD-M12-004 AC-7 · 对话流里的问答', () => {
  test('ask.user 的调用读成问题，结果读成「标签：答案」；拒答如实说', async () => {
    const { createSessionStore } = await import('../src/index.ts')
    const s = createSessionStore()
    let seq = 0
    const env = (ev: Record<string, unknown>) => ({
      seq: ++seq,
      sessionId: 's',
      parentSeq: seq - 1 || null,
      ts: seq,
      schemaVersion: 14,
      ev,
    })
    s.applyEvents([
      env({ t: 'tool.call', id: 'q1', name: 'ask.user', args: { questions: QS } }),
      env({
        t: 'tool.result',
        id: 'q1',
        ok: true,
        ms: 1,
        payload: {
          answered: true,
          answers: [
            { header: '存储', answer: 'SQLite' },
            { header: '端', answer: 'Web、TUI' },
          ],
        },
      }),
      env({ t: 'tool.call', id: 'q2', name: 'ask.user', args: { questions: QS } }),
      env({ t: 'tool.result', id: 'q2', ok: true, ms: 1, payload: { answered: false, message: 'x' } }),
    ] as never)
    const items = s.$items.get()
    expect(items[0]).toMatchObject({ kind: 'tool-call', summary: '存哪？ / 哪几端？' })
    expect(items[1]).toMatchObject({ kind: 'tool-result', summary: '存储：SQLite；端：Web、TUI' })
    expect(items[3]).toMatchObject({ kind: 'tool-result', summary: '用户没有回答' })
  })
})
