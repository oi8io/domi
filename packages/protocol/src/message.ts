/**
 * 送给模型的消息契约 —— docs/spec/M0.md §3.3 / §3.5
 *
 * 这是 buildContext 的**输出**类型，也是 ModelProvider 的**输入**类型。
 * 放在 protocol 里而不是 kernel 里，是因为它是跨包契约：
 * kernel 产出它、model 消费它，两边都不该定义它。
 */
import { z } from 'zod'

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
})
export type ToolCall = z.infer<typeof ToolCallSchema>

export const ModelMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({ role: z.literal('assistant'), content: z.string(), toolCalls: z.array(ToolCallSchema).optional() }),
  z.object({ role: z.literal('tool'), toolCallId: z.string(), ok: z.boolean(), content: z.string() }),
])
export type ModelMessage = z.infer<typeof ModelMessageSchema>

export type ModelMessages = ModelMessage[]
