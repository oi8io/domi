/**
 * 终端问题框的当前状态（PRD-M12-004 AC-7）。按键在 main.tsx 里改它，ConfirmDialog 里画它。
 * 按 askId 存：换了一次提问就从头开始。状态机本身在 client-core（与 Web 同一份）。
 */
import { initQuestions, type Question, type QuestionsState } from '@domi/client-core'
import { atom } from 'nanostores'

export const $questions = atom<{ askId: string; state: QuestionsState } | null>(null)

export function questionsStateFor(askId: string, qs: readonly Question[]): QuestionsState {
  const cur = $questions.get()
  if (cur && cur.askId === askId) return cur.state
  const fresh = initQuestions(qs)
  $questions.set({ askId, state: fresh })
  return fresh
}
