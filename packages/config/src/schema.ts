/**
 * 配置契约 —— PRD-M0-008 · SPEC-M0-009
 *
 * 配置文件是 YAML（docs/adr/014），解析用 Bun 内置的 `Bun.YAML`，不引第三方库（`PRD-VISION.md` §6 第一类的反面：
 * 内置的就够用时，引库只是多一个要跟版本的东西）。
 */
import { z } from 'zod'

export const PermissionRuleSchema = z.object({
  name: z.string(),
  capability: z.string(),
  decision: z.enum(['allow', 'deny', 'ask']),
})

export const ConfigSchema = z.object({
  model: z.object({
    provider: z.string().default('anthropic'),
    name: z.string().default('claude-sonnet-4-5'),
    /** 自定义网关：LiteLLM / OpenRouter / 本地模型都从这里进来（DESIGN §5） */
    baseUrl: z.string().optional(),
    /**
     * 允许写在配置文件里，但**不推荐**——环境变量优先。
     * 无论从哪来，它都不会进事件流：脱敏挂在 EventLog.append 前置（SPEC-M0-009）。
     */
    apiKey: z.string().optional(),
    /**
     * 能力矩阵的显式覆盖（PRD-M1-001 AC-2）。openai-compatible 默认全关（fail-closed），
     * 后面挂的模型其实支持工具调用的话，在 model.capabilities 里打开
     */
    capabilities: z
      .object({
        toolCall: z.boolean(),
        vision: z.boolean(),
        reasoning: z.boolean(),
        promptCache: z.boolean(),
        structuredOutput: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
  }),
  permissions: z.object({ rules: z.array(PermissionRuleSchema).default([]) }).default({ rules: [] }),
  context: z
    .object({
      maxTokens: z.number().int().positive().default(150_000),
      includeReasoning: z.boolean().default(false),
      strategy: z.string().default('full'),
    })
    .default({ maxTokens: 150_000, includeReasoning: false, strategy: 'full' }),
})

export type DomiConfig = z.infer<typeof ConfigSchema>
