/**
 * 问题框（Web）—— PRD-M12-004 AC-7。SSR 渲染：交互逻辑在 client-core 的状态机里测，这里测画出来的样子。
 */
import { describe, expect, test } from 'bun:test'
import { initQuestions, type Question, reduceQuestions } from '@domi/client-core'
import { questionsToForm } from '@domi/protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmDialog } from '../src/ConfirmDialog.tsx'
import { QuestionsDialog } from '../src/QuestionsDialog.tsx'

const QS: Question[] = [
  {
    header: '存储',
    question: '会话数据存哪？',
    options: [
      { label: 'SQLite', description: '单文件，零运维' },
      { label: 'Postgres', description: '要起服务' },
    ],
  },
  { header: '端', question: '先做哪几端？', options: [{ label: 'Web' }, { label: 'TUI' }], multiSelect: true },
]
const noop = () => undefined

describe('PRD-M12-004 AC-7 · Web 问题框', () => {
  test('带扩展键的询问画成问题框，不是普通表单', () => {
    const form = questionsToForm(QS, '其他')
    const html = renderToStaticMarkup(
      <ConfirmDialog ask={{ askId: 'a1', capabilityId: 'ask.user', detail: '', form }} onAnswer={noop} />,
    )
    expect(html).toContain('data-part="questions"')
    expect(html).not.toContain('name="q1"')
  })

  test('每题一个 tab + 核对页；第一题的选项 a / b 带说明，最后一行是「其他」', () => {
    const html = renderToStaticMarkup(<QuestionsDialog questions={QS} onAnswer={noop} />)
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/button>/g)].map((m) =>
      m[1]?.replace(/<[^>]+>/g, ''),
    )
    expect(tabs).toEqual(['存储', '端', '核对'])
    expect(html).toContain('会话数据存哪？')
    expect(html).toMatch(/a\.<\/span><span[^>]*>SQLite/)
    expect(html).toContain('单文件，零运维')
    expect(html).toContain('data-other')
    // 还没到核对页：没有提交按钮
    expect(html).not.toContain('data-action="submit"')
  })

  test('多选题标「可多选」；答过的 tab 打勾', () => {
    const s = reduceQuestions(QS, initQuestions(QS), { t: 'pick', label: 'SQLite' })
    const html = renderToStaticMarkup(<QuestionsDialog questions={QS} onAnswer={noop} initial={s} />)
    expect(html).toContain('可多选')
    expect(html).toContain('✓ 存储')
  })

  test('核对页列出每题答案，没答的标出来，才有提交按钮', () => {
    let s = reduceQuestions(QS, initQuestions(QS), { t: 'pick', label: 'Postgres' })
    s = reduceQuestions(QS, s, { t: 'tab', to: 2 })
    const html = renderToStaticMarkup(<QuestionsDialog questions={QS} onAnswer={noop} initial={s} />)
    const text = html.replace(/<[^>]+>/g, '|')
    expect(text).toContain('存储：|Postgres')
    expect(text).toContain('端：||未回答')
    expect(html).toContain('data-action="submit"')
  })
})
