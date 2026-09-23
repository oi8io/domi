/**
 * 终端问题框 —— PRD-M12-004 AC-7。按键映射是纯函数（keys.ts），画面用 renderAt 测。
 * 真终端里的按键手感进 M12 DoD（无 TTY 环境测不了 useInput，见 docs/adr/001）。
 */
import { describe, expect, test } from 'bun:test'
import { initQuestions, type Question, reduceQuestions } from '@domi/client-core'
import { questionsToForm } from '@domi/protocol'
import { ConfirmDialog } from '../src/components/ConfirmDialog.tsx'
import { questionKey } from '../src/keys.ts'
import { $questions } from '../src/questions-state.ts'
import { renderAt } from './render.tsx'

const QS: Question[] = [
  {
    header: '存储',
    question: '会话数据存哪？',
    options: [
      { label: 'SQLite', description: '单文件' },
      { label: 'Postgres', description: '要起服务' },
    ],
  },
  { header: '端', question: '先做哪几端？', options: [{ label: 'Web' }, { label: 'TUI' }], multiSelect: true },
]
const browse = { editing: false, onReview: false }

describe('PRD-M12-004 AC-7 · 问题框按键', () => {
  test('←→ / Tab 切题，↑↓ 移动，回车 / 空格选，a–d 直选', () => {
    expect(questionKey('', { rightArrow: true }, browse)).toEqual({ kind: 'act', action: { t: 'next' } })
    expect(questionKey('', { tab: true }, browse)).toEqual({ kind: 'act', action: { t: 'next' } })
    expect(questionKey('', { tab: true, shift: true }, browse)).toEqual({ kind: 'act', action: { t: 'prev' } })
    expect(questionKey('', { downArrow: true }, browse)).toEqual({ kind: 'act', action: { t: 'move', delta: 1 } })
    expect(questionKey('', { return: true }, browse)).toEqual({ kind: 'act', action: { t: 'choose' } })
    expect(questionKey(' ', {}, browse)).toEqual({ kind: 'act', action: { t: 'choose' } })
    expect(questionKey('b', {}, browse)).toEqual({ kind: 'act', action: { t: 'letter', ch: 'b' } })
    expect(questionKey('x', {}, browse)).toBeNull()
  })

  test('n / Esc 不回答；核对页回车才是提交', () => {
    expect(questionKey('n', {}, browse)).toEqual({ kind: 'decline' })
    expect(questionKey('', { escape: true }, browse)).toEqual({ kind: 'decline' })
    expect(questionKey('', { return: true }, { editing: false, onReview: true })).toEqual({ kind: 'submit' })
    expect(questionKey('', { downArrow: true }, { editing: false, onReview: true })).toBeNull()
  })

  test('写「其他」时按键进输入：n 是字不是拒绝，回车 / Esc 写完', () => {
    const editing = { editing: true, onReview: false }
    expect(questionKey('n', {}, editing)).toEqual({ kind: 'act', action: { t: 'type', text: 'n' } })
    expect(questionKey('', { backspace: true }, editing)).toEqual({ kind: 'act', action: { t: 'backspace' } })
    expect(questionKey('', { return: true }, editing)).toEqual({ kind: 'act', action: { t: 'edit', on: false } })
    expect(questionKey('', { escape: true }, editing)).toEqual({ kind: 'act', action: { t: 'edit', on: false } })
  })
})

describe('PRD-M12-004 AC-7 · 问题框画面', () => {
  const ask = { askId: 'a1', capabilityId: 'ask.user', detail: '', form: questionsToForm(QS, '其他') }

  test('tab 行、问题、a / b 选项带说明、光标在第一项、「其他」一行、按键提示', async () => {
    $questions.set(null)
    const h = renderAt(100, <ConfirmDialog ask={ask} />)
    await h.flush()
    const f = h.lastFrame()
    expect(f).toContain('需要你决定')
    expect(f).toContain('存储')
    expect(f).toContain('核对')
    expect(f).toContain('会话数据存哪？')
    expect(f).toContain('❯ ( ) a. SQLite — 单文件')
    expect(f).toContain('b. Postgres — 要起服务')
    expect(f).toContain('其他:')
    expect(f).toContain('a–d')
    h.unmount()
  })

  test('状态变了画面跟着变：多选题打勾、核对页列出答案', async () => {
    let s = reduceQuestions(QS, initQuestions(QS), { t: 'letter', ch: 'a' })
    s = reduceQuestions(QS, s, { t: 'pick', label: 'TUI' })
    $questions.set({ askId: 'a1', state: s })
    const h = renderAt(100, <ConfirmDialog ask={ask} />)
    await h.flush()
    expect(h.lastFrame()).toContain('[x] b. TUI')
    expect(h.lastFrame()).toContain('✓ 存储')
    $questions.set({ askId: 'a1', state: reduceQuestions(QS, s, { t: 'tab', to: 2 }) })
    await h.flush()
    expect(h.lastFrame()).toContain('存储：SQLite')
    expect(h.lastFrame()).toContain('端：TUI')
    expect(h.lastFrame()).toContain('回车提交')
    h.unmount()
    $questions.set(null)
  })
})

describe('PRD-M12-004 AC-10 · 终端续跑', () => {
  test('/continue = 替用户说一句「接着做」（计划已经在上下文里）', async () => {
    const { parseSlash } = await import('../src/commands.ts')
    const { continuePrompt } = await import('@domi/client-core')
    expect(parseSlash('/continue', 3)).toEqual({ kind: 'submit', text: continuePrompt() })
  })

  test('提示行：还剩几步 + /continue；被打断时明说', async () => {
    const { ResumeHint } = await import('../src/components/ResumeHint.tsx')
    const { createSessionStore } = await import('@domi/client-core')
    const s = createSessionStore({ provider: 'p', model: 'm' })
    s.setMetrics({
      tokens: { input: 1, output: 1, cacheRead: 0 },
      cost: '—',
      contextPercent: 1,
      contextLevel: 'ok',
      unpricedModels: [],
      plan: { total: 4, remaining: 3, interrupted: true },
    })
    const h = renderAt(100, <ResumeHint status={s.$status.get()} ask={null} />)
    await h.flush()
    expect(h.lastFrame()).toContain('上次被打断了 · 计划还剩 3/4 步')
    expect(h.lastFrame()).toContain('/continue')
    h.unmount()
  })
})
