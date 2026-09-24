/**
 * AI SDK 适配 —— TASK-M0-011 · docs/adr/004
 *
 * 这一层只做一件事：把 AI SDK 的流**翻译**成 ModelEvent。
 * 它不做决策、不做归一化、不做重试——那些都在 kernel 的 loop 里，
 * 否则同一件事会在两个地方各做一半。
 *
 * ADR-004 的红线在这里落地：`providerOptions` 原样传下去，
 * `providerMetadata` 与 `usage` **整块**塞进 usage 事件，不挑字段。
 * 挑字段的那一刻，缓存命中率与「压缩 × prompt cache」就失去了输入。
 */
import type { ModelMessages, ToolSchema } from '@domi/protocol'
import type { LanguageModel } from 'ai'
import { type ModelMessage as AiMessage, jsonSchema, NoOutputGeneratedError, streamText, tool } from 'ai'
import { assertCapability, type ModelCapabilities } from './capability.ts'
import type { ModelEvent, ModelProvider, ModelRequest } from './provider.ts'

/**
 * Anthropic 的工具名只允许 `^[a-zA-Z0-9_-]{1,64}$`——我们的 `fs.read` 带点，会被拒。
 * 所以对外发送时把点换成下划线，收到 tool-call 再换回来。
 * 这个映射必须是**双向且无歧义**的，所以只允许点这一种替换；
 * 真出现 `fs_read` 与 `fs.read` 并存时直接报错，而不是悄悄猜一个。
 */
export function encodeToolName(name: string): string {
  return name.replaceAll('.', '_')
}

export function buildToolNameMap(schemas: ToolSchema[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const s of schemas) {
    const encoded = encodeToolName(s.name)
    const existing = map.get(encoded)
    if (existing !== undefined && existing !== s.name) {
      throw new Error(`工具名冲突：${existing} 与 ${s.name} 编码后都是 ${encoded}，请改名`)
    }
    map.set(encoded, s.name)
  }
  return map
}

/** 所有 system 消息拼成一段，交给 AI SDK 的 instructions（它不收 messages 里的 system） */
export function systemOf(messages: ModelMessages): string {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
}

/** 我们的消息 → AI SDK 的消息。tool 结果需要 toolName，从前面的 assistant 消息里找 */
export function toAiMessages(messages: ModelMessages): AiMessage[] {
  const nameOf = new Map<string, string>()
  const out: AiMessage[] = []

  for (const m of messages) {
    switch (m.role) {
      // system 不进 messages：AI SDK 要求它走 instructions 选项（见 systemOf）
      case 'system':
        break
      case 'user':
        if (m.images && m.images.length > 0) {
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: m.content },
              ...m.images.map((i) => ({
                type: 'file',
                data: { type: 'data', data: i.data },
                mediaType: i.mime,
                ...(i.name === undefined ? {} : { filename: i.name }),
              })),
            ],
          } as AiMessage)
        } else {
          out.push({ role: m.role, content: m.content })
        }
        break
      case 'assistant': {
        const parts: Array<Record<string, unknown>> = []
        if (m.content !== '') parts.push({ type: 'text', text: m.content })
        for (const c of m.toolCalls ?? []) {
          nameOf.set(c.id, c.name)
          parts.push({ type: 'tool-call', toolCallId: c.id, toolName: encodeToolName(c.name), input: c.args })
        }
        out.push({ role: 'assistant', content: parts } as AiMessage)
        break
      }
      case 'tool':
        out.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: m.toolCallId,
              toolName: encodeToolName(nameOf.get(m.toolCallId) ?? 'unknown'),
              output: { type: 'json', value: safeJson(m.content) },
            },
          ],
        } as AiMessage)
        break
    }
  }
  return out
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return { raw: s }
  }
}

export interface AiSdkProviderOptions {
  id: string
  model: LanguageModel
  capabilities: ModelCapabilities
  /** 最近一次出站请求地址，由工厂的诊断 fetch 填。空流时用它说清楚「发到了哪」 */
  trace?: { lastUrl: string | undefined }
}

/** 流里一个事件都没有时给人看的话。SDK 原文「No output generated」指不到任何一环 */
export function describeEmptyStream(url: string | undefined): string {
  return (
    `模型流里一个事件都没有：${url ? `POST ${url} ` : ''}返回了空的事件流。` +
    '常见原因：base_url 路径不对、模型名网关不认、或网关没实现流式。先跑 `domi doctor --ping` 看是哪一环。'
  )
}

export class AiSdkProvider implements ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities
  private readonly model: LanguageModel
  private readonly trace: { lastUrl: string | undefined } | undefined

  constructor(opts: AiSdkProviderOptions) {
    this.id = opts.id
    this.model = opts.model
    this.capabilities = opts.capabilities
    this.trace = opts.trace
  }

  private errorMessage(err: unknown): string {
    if (NoOutputGeneratedError.isInstance(err)) return describeEmptyStream(this.trace?.lastUrl)
    return err instanceof Error ? err.message : String(err)
  }

  async *generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const schemas = req.tools ?? []
    // PRD-M1-001 AC-3：在**发出请求之前**拒绝。放在 streamText 之后就晚了——
    // 那时 HTTP 请求已经出去，钱也花了。
    if (schemas.length > 0) assertCapability(this.id, this.capabilities, 'toolCall')
    const nameMap = buildToolNameMap(schemas)

    const tools = Object.fromEntries(
      schemas.map((s) => [
        encodeToolName(s.name),
        // 不给 execute：工具由 domi 的 ToolRegistry 执行（INV-05：Tool 是唯一执行原语）。
        // 交给 AI SDK 执行会绕过权限引擎——那是 INV-03 的破口。
        tool({ description: s.description, inputSchema: jsonSchema(s.inputSchema as never) }),
      ]),
    )

    /**
     * 这里整体断言一次类型，原因写清楚免得以后有人「顺手修一下」：
     * AI SDK 的 ToolSet 在 exactOptionalPropertyTypes 下要求工具带 execute——它假定
     * 工具由自己执行。我们**故意**不给 execute：工具必须走 domi 的 ToolRegistry，
     * 那里才有权限引擎（INV-03）与唯一执行原语（INV-05）。
     * 交给 AI SDK 执行等于绕开权限，所以这是类型层的摩擦，不是绕过运行时约束。
     */
    const opts = {
      model: this.model,
      messages: toAiMessages(req.messages),
      ...(systemOf(req.messages) === '' ? {} : { instructions: systemOf(req.messages) }),
      abortSignal: signal,
      // SDK 默认把流里的错误 console.error 一遍。错误已经作为事件进了事件流，
      // 再打一遍只会在 domid 的终端里留一段没人看的堆栈
      onError: () => undefined,
      ...(schemas.length > 0 ? { tools } : {}),
      ...(req.providerOptions ? { providerOptions: req.providerOptions } : {}),
    } as unknown as Parameters<typeof streamText>[0]

    let errored = false
    try {
      // streamText 会在**构造时同步抛错**（比如 messages 为空、prompt 不合法），
      // 所以它必须在 try 里面。放在外面的话这类错误会穿透到 loop 之外，
      // 而 loop 只认识 error 事件——用户会看到一个裸异常而不是"可以继续"的提示。
      const result = streamText(opts)
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { type: 'delta', text: part.text }
            break
          case 'reasoning-delta':
            yield { type: 'reason', text: part.text }
            break
          case 'tool-call':
            yield {
              type: 'tool-call',
              id: part.toolCallId,
              name: nameMap.get(part.toolName) ?? part.toolName,
              args: part.input,
            }
            break
          case 'finish-step':
            // 整块透传：usage / providerMetadata / response 一个字段都不挑（ADR-004）
            yield {
              type: 'usage',
              raw: JSON.parse(
                JSON.stringify({
                  usage: part.usage,
                  providerMetadata: part.providerMetadata,
                  response: part.response,
                }),
              ) as Record<string, unknown>,
            }
            break
          case 'error':
            // 只报第一个。请求本身失败后 SDK 收尾时还会再补一个 NoOutputGenerated，
            // 而 loop 记的是最后一个——那样真正的原因就被盖掉了
            if (!errored) {
              errored = true
              yield { type: 'error', message: this.errorMessage(part.error), recoverable: true }
            }
            break
          default:
            break
        }
      }
    } catch (e) {
      // 流在中途炸掉（网络断、上游 5xx）也要变成事件，而不是异常穿透到 loop 之外。
      // loop 收到 recoverable 的 error 会落盘并让用户可以继续（PRD-M0-002 AC-4）。
      if (!errored) yield { type: 'error', message: this.errorMessage(e), recoverable: true }
    }
  }
}
