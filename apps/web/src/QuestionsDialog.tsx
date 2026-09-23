/**
 * 问题框 —— PRD-M12-004 AC-7（交互照 Claude Code 的 AskUserQuestion）。
 *
 * 每题一个 tab（标签 + 答了打勾），最后一个 tab 核对全部答案再提交。选项 a–d 带说明；
 * 单选选中即跳下一题；「其他」永远在最后一行。状态机在 client-core（与 TUI 同一份），这里只管画。
 */
import {
  answeredFlags,
  initQuestions,
  type Question,
  type QuestionsState,
  questionsContent,
  reduceQuestions,
} from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useReducer } from 'react'
import { Button } from './components/ui/button.tsx'
import { cn } from './lib/cn.ts'

const LETTERS = ['a', 'b', 'c', 'd']

export function QuestionsDialog({
  questions,
  onAnswer,
  initial,
}: {
  questions: readonly Question[]
  onAnswer: (allowed: boolean, content?: Record<string, unknown>) => void
  /** 测试用：从某个状态开始画 */
  initial?: QuestionsState
}) {
  const [s, dispatch] = useReducer(
    (st: QuestionsState, a: Parameters<typeof reduceQuestions>[2]) => reduceQuestions(questions, st, a),
    initial ?? initQuestions(questions),
  )
  const done = answeredFlags(questions, s)
  const onReview = s.tab >= questions.length
  const q = questions[s.tab]

  return (
    <div
      className="my-2 overflow-hidden rounded-md border border-accent bg-panel"
      role="dialog"
      aria-labelledby="questions-title"
      data-part="questions"
    >
      <p id="questions-title" className="px-3.5 pt-2 pb-1 text-[13px] font-semibold text-accent">
        {tr('web.questions.title')}
      </p>
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2" role="tablist">
        {questions.map((qq, i) => (
          <button
            key={qq.header}
            type="button"
            role="tab"
            aria-selected={s.tab === i}
            data-answered={done[i] ? 'true' : 'false'}
            className={cn('pill', s.tab === i && 'border-accent text-accent')}
            onClick={() => dispatch({ t: 'tab', to: i })}
          >
            {done[i] ? '✓ ' : ''}
            {qq.header}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={onReview}
          className={cn('pill', onReview && 'border-accent text-accent')}
          onClick={() => dispatch({ t: 'tab', to: questions.length })}
        >
          {tr('web.questions.review')}
        </button>
      </div>

      {q !== undefined && !onReview && (
        <div className="px-3.5 pb-2" role="tabpanel">
          <p className="mb-2 text-[13px] whitespace-pre-wrap">
            {q.question}
            {q.multiSelect === true && <span className="ml-2 text-xs text-mut">{tr('web.questions.multi')}</span>}
          </p>
          <div className="grid gap-1.5">
            {q.options.map((o, j) => {
              const on = (s.selected[s.tab] ?? []).includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  data-option={o.label}
                  aria-pressed={on}
                  className={cn(
                    'grid grid-cols-[auto_1fr] gap-x-2 rounded-sm border px-2.5 py-1.5 text-left text-[13px]',
                    on ? 'border-accent bg-accent-d' : 'border-border2 hover:bg-panel-h',
                  )}
                  onClick={() => dispatch({ t: 'pick', label: o.label })}
                >
                  <span className="font-mono text-mut">{LETTERS[j]}.</span>
                  <span className="font-medium">{o.label}</span>
                  {o.description !== undefined && o.description !== '' && (
                    <span className="col-start-2 text-xs text-mut">{o.description}</span>
                  )}
                </button>
              )
            })}
            <label className="grid grid-cols-[auto_1fr] items-center gap-x-2 rounded-sm border border-border2 px-2.5 py-1.5 text-[13px]">
              <span className="text-mut">{tr('web.questions.other')}</span>
              <input
                className="field-input"
                data-other
                placeholder={tr('web.questions.otherPlaceholder')}
                value={s.other[s.tab] ?? ''}
                onChange={(e) => dispatch({ t: 'setOther', text: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}

      {onReview && (
        <div className="px-3.5 pb-2" role="tabpanel" data-part="questions-review">
          {questions.map((qq, i) => {
            const picked = [...(s.selected[i] ?? []), ...((s.other[i] ?? '').trim() === '' ? [] : [s.other[i]?.trim()])]
            return (
              <p key={qq.header} className="mb-1 text-[13px]">
                <span className="text-mut">{qq.header}：</span>
                {picked.length > 0 ? (
                  picked.join('、')
                ) : (
                  <span className="text-warn">{tr('web.questions.unanswered')}</span>
                )}
              </p>
            )
          })}
        </div>
      )}

      <div className="flex justify-end gap-2 px-3.5 pb-2.5">
        <Button onClick={() => onAnswer(false)}>{tr('web.questions.decline')}</Button>
        {!onReview && <Button onClick={() => dispatch({ t: 'next' })}>{tr('web.questions.next')}</Button>}
        {onReview && (
          <Button
            variant="primary"
            data-action="submit"
            onClick={() => onAnswer(true, questionsContent(questions, s) as unknown as Record<string, unknown>)}
          >
            {tr('common.submit')}
          </Button>
        )}
      </div>
    </div>
  )
}
