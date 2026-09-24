/**
 * ModelProvider —— docs/spec/M0.md §3.3 · docs/adr/004
 *
 * 这一层存在的唯一理由是**边界**：kernel 不 import 任何 provider SDK（INV-02），
 * 只 import 这里导出的类型。ADR-004 的逃生口也在这里——
 * `providerOptions` 与原始 usage **原样透传**，适配层不做字段归一、不丢字段。
 * 缓存命中率（状态栏）与压缩时保住 prompt cache 前缀的判断都靠这份原始 usage，丢了就没有输入。
 */
import type { ModelMessages, ToolSchema } from '@domi/protocol'
import type { ModelCapabilities } from './capability.ts'

export type ModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'reason'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'usage'; raw: Record<string, unknown> }
  | { type: 'error'; message: string; recoverable: boolean }

export interface ModelRequest {
  model: string
  messages: ModelMessages
  tools?: ToolSchema[]
  /** ADR-004 的逃生口：provider 特有能力从这里透传下去，不被抽象层吃掉 */
  providerOptions?: Record<string, unknown>
}

export interface ModelProvider {
  readonly id: string
  /** 静态声明的能力矩阵（PRD-M1-001 AC-2）。调用未声明的能力会在发请求前抛错 */
  readonly capabilities: ModelCapabilities
  generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
