/**
 * 工具契约 —— capability 产出、model 消费。
 * 放在 protocol 里的理由与 message.ts 相同：它是跨包契约，两边都不该自己定义。
 */
import { z } from 'zod'

export const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema。由 zod schema 经 z.toJSONSchema() 产出，不手写 */
  inputSchema: z.record(z.string(), z.unknown()),
})
export type ToolSchema = z.infer<typeof ToolSchemaSchema>
