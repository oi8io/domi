/**
 * 把拼好的提示词接到上下文上 —— PRD-M1-003 / PRD-M1-004 AC-3 · BUG-M3-015
 *
 * kernel 不认识「层」（那是 packages/prompt 的事），只收拼好的两段：
 *   - system：稳定前缀，放最前面
 *   - dynamic：会变的内容（工作目录之类），**只**接在最后一条 user message 后面
 * 提示词不进事件流：它是每次请求时现拼的，改配置后下一轮就生效，历史不必重写。
 */

import type { ModelMessages } from '@domi/protocol'
import { NOTE_MARK } from './build-context.ts'

export interface PromptParts {
  system: string
  /** @deprecated M15（SPEC-M15-003）：不再把动态内容拼进最后一条 user（会改写前缀）。动态内容走 notes 追加 */
  dynamic?: string
  /**
   * M15（SPEC-M15-003）：user 层的稳定内容（如工作区信息，cacheable:false 但会话内不变）。
   * 作为固定 user 消息插在 system 之后、history 之前——前缀稳定，又不污染 system 前缀。
   */
  user?: string
  /**
   * M14（SPEC-M14-006）：这一份提示词的层清单（来自 prompt.assemble()）。
   * kernel 不认识「层」，只原样透传到 model.request.ctx 供上下文 tab 分段（纯计算，零 IO）。
   * 可选——老实现 / 回放不填，端上按「没有分段数据」显示
   */
  layers?: Array<{
    id: string
    role: 'system' | 'user'
    cacheable: boolean
    approxTokens: number
  }>
  /**
   * M15（SPEC-M15-001）：每层渲染文本的 FNV-1a 哈希（assemble().layerFingerprints）。
   * 只用于计算 model.request.fingerprint——**不进 ctx.layers、不落盘**。
   * 可选——老实现 / 回放不填，指纹缺层数据时按「只有消息级」计算
   */
  layerHashes?: Array<{ id: string; hash: string }>
  /**
   * M15（SPEC-M15-003 · INV-12(b)）：这一轮必须送达的动态变化（计划更新 / 环境 / 验证 / 补充）。
   * 渲染为**追加**的 user 块（不改写已发出的消息），并随 model.request 前落盘成 ctx.note 事件。
   * 可选——没有变化就不传
   */
  notes?: Array<{ reason: 'plan' | 'env' | 'verify' | 'supplement' | 'model_switch'; text: string }>
}

export function withPrompt(messages: ModelMessages, prompt: PromptParts): ModelMessages {
  const out: ModelMessages = [...messages]
  // M15（SPEC-M15-003 · INV-12(b)）：追加段只 push 新 user 块，绝不动已有消息——相邻请求前缀稳定
  for (const note of prompt.notes ?? []) {
    out.push({ role: 'user', content: `${NOTE_MARK} ${note.text}` })
  }
  if (prompt.system !== '') out.unshift({ role: 'system', content: prompt.system })
  if (prompt.user !== undefined && prompt.user !== '') out.splice(1, 0, { role: 'user', content: prompt.user })
  return out
}
