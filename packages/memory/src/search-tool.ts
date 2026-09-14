/**
 * 检索工具 —— PRD-M2-004 AC-2：**由模型决定何时调用**
 *
 * 为什么做成工具而不是每轮自动塞检索结果：
 * 自动塞的话，每一轮都要付一次检索的钱（token），而十轮里有九轮用不上；
 * 更糟的是模型会把塞进来的旧对话当成当前语境。
 * 做成工具，"要不要回忆"这个判断交给模型，判断错了也留在轨迹上看得见。
 *
 * 工具住在 `packages/memory` 而不是 `packages/capability`：
 * capability 是**执行原语**的家，这个工具的实质是记忆层的读接口。
 * 由 runtime（组合根）注册进 ToolRegistry。
 */
import type { Tool } from '@domi/capability'
import type { SearchRepo } from '@domi/store'
import { z } from 'zod'
import { type EpisodeAnswer, searchEpisodes } from './episodic.ts'

export const MemorySearchArgs = z.object({
  query: z.string().min(1).describe('要回忆的内容，用自然语言，例如「上次的 CORS 问题」'),
  limit: z.number().int().positive().max(50).optional(),
  sessionId: z.string().optional().describe('只在某个会话里找；不给就是全部历史'),
})
export type MemorySearchArgs = z.infer<typeof MemorySearchArgs>

export const MEMORY_SEARCH_CAPABILITY = 'memory.search'

/**
 * 读接口，所以默认可以直接放行——但**仍然走权限层**：
 * 历史对话里有用户的原话，"能不能翻旧账"应该由配置说了算，而不是由它是读操作说了算。
 */
export function makeMemorySearchTool(repo: SearchRepo): Tool<MemorySearchArgs, EpisodeAnswer> {
  return {
    name: 'memory.search',
    capability: MEMORY_SEARCH_CAPABILITY,
    description:
      '按内容检索全部历史会话（不只是当前这一个）。' +
      '找不到相关内容时返回 {found:false}，**不会**返回勉强沾边的结果——收到 found:false 就当作没有。',
    schema: MemorySearchArgs,
    async execute(args) {
      return searchEpisodes(repo, args.query, {
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
      })
    },
  }
}
