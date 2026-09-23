/**
 * 终端问题框 —— PRD-M12-004 AC-7（交互照 Claude Code 的 AskUserQuestion，与 Web 同一个状态机）。
 */
import { answeredFlags, type Question, type QuestionsState } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.ts'

const LETTERS = ['a', 'b', 'c', 'd']

export function QuestionsDialog({ questions, state }: { questions: readonly Question[]; state: QuestionsState }) {
  const t = useTheme()
  const done = answeredFlags(questions, state)
  const onReview = state.tab >= questions.length
  const q = questions[state.tab]
  const cursor = state.cursor[state.tab] ?? 0
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border('accent')} paddingX={1} marginLeft={2}>
      <Text {...t.fg('accent')} bold>
        {tr('web.questions.title')}
      </Text>
      <Text>
        {questions.map((qq, i) => (
          <Text
            key={qq.header}
            {...t.fg(state.tab === i ? 'accent' : done[i] ? 'ok' : 'mut')}
            inverse={state.tab === i}
          >
            {` ${done[i] ? '✓ ' : ''}${qq.header} `}
          </Text>
        ))}
        <Text {...t.fg(onReview ? 'accent' : 'mut')} inverse={onReview}>{` ${tr('web.questions.review')} `}</Text>
      </Text>
      {q !== undefined && !onReview && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {q.question}
            {q.multiSelect === true ? <Text {...t.fg('mut')}>{`  (${tr('web.questions.multi')})`}</Text> : ''}
          </Text>
          {q.options.map((o, j) => {
            const on = (state.selected[state.tab] ?? []).includes(o.label)
            const mark = q.multiSelect === true ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )'
            return (
              <Text key={o.label} {...t.fg(cursor === j ? 'accent' : 'ink2')}>
                {`${cursor === j ? '❯' : ' '} ${mark} ${LETTERS[j]}. ${o.label}`}
                {o.description ? <Text {...t.fg('mut')}>{` — ${o.description}`}</Text> : ''}
              </Text>
            )
          })}
          <Text {...t.fg(cursor === q.options.length ? 'accent' : 'ink2')}>
            {`${cursor === q.options.length ? '❯' : ' '}     ${tr('web.questions.other')}: ${state.other[state.tab] ?? ''}${state.editing ? '▏' : ''}`}
          </Text>
        </Box>
      )}
      {onReview && (
        <Box flexDirection="column" marginTop={1}>
          {questions.map((qq, i) => {
            const other = (state.other[i] ?? '').trim()
            const picked = [...(state.selected[i] ?? []), ...(other === '' ? [] : [other])]
            return (
              <Text key={qq.header}>
                <Text {...t.fg('mut')}>{`${qq.header}：`}</Text>
                {picked.length > 0 ? (
                  picked.join('、')
                ) : (
                  <Text {...t.fg('warn')}>{tr('web.questions.unanswered')}</Text>
                )}
              </Text>
            )
          })}
        </Box>
      )}
      <Text {...t.fg('mut2')}>
        {state.editing
          ? tr('tui.questions.editing')
          : onReview
            ? tr('tui.questions.submitKeys')
            : tr('tui.questions.keys')}
      </Text>
    </Box>
  )
}
