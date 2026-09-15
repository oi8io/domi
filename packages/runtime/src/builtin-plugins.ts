/**
 * 两个内置能力改写成插件形态 —— PRD-M6-001 AC-3（吃自己的狗粮）
 *
 * 形状和第三方插件一样（名字、版本、API 版本、扩展点），只是在进程内注册。
 * 判据：它们原来的测试（capability/skill、memory/search-tool、runtime/session）一个字没改照样通过。
 */
import { OFFICIAL_SKILLS } from '@domi/capability'
import { makeMemorySearchTool } from '@domi/memory'
import { definePlugin } from '@domi/plugin'
import type { SearchRepo } from '@domi/store'

/** skill 型：三个官方 Skill */
export const officialSkillsPlugin = definePlugin({
  name: 'official-skills',
  version: '1.0.0',
  description: '写提交信息、代码审查、排查问题三个官方 Skill',
  skills: () => OFFICIAL_SKILLS,
})

/** tool 型：跨会话全文检索 */
export const memorySearchPlugin = definePlugin<{ search: SearchRepo }>({
  name: 'memory-search',
  version: '1.0.0',
  description: '按内容检索全部历史会话（PRD-M2-004）',
  tools: ({ search }) => [makeMemorySearchTool(search)],
})
