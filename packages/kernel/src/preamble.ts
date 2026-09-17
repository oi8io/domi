/**
 * 把拼好的提示词接到上下文上 —— PRD-M1-003 / PRD-M1-004 AC-3 · BUG-M3-015
 *
 * kernel 不认识「层」（那是 packages/prompt 的事），只收拼好的两段：
 *   - system：稳定前缀，放最前面
 *   - dynamic：会变的内容（工作目录之类），**只**接在最后一条 user message 后面
 * 提示词不进事件流：它是每次请求时现拼的，改配置后下一轮就生效，历史不必重写。
 */
import type { ModelMessages } from '@domi/protocol'

export interface PromptParts {
  system: string
  dynamic: string
}

export function withPrompt(messages: ModelMessages, prompt: PromptParts): ModelMessages {
  const out: ModelMessages = [...messages]
  if (prompt.dynamic !== '') {
    for (let i = out.length - 1; i >= 0; i--) {
      const m = out[i]
      if (m?.role !== 'user') continue
      out[i] = { ...m, content: `${m.content}\n\n${prompt.dynamic}` }
      break
    }
  }
  if (prompt.system !== '') out.unshift({ role: 'system', content: prompt.system })
  return out
}
