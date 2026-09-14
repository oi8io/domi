/**
 * 结构化输出 —— PRD-M1-005 · SPEC-M1-005
 *
 * 两条路径（原生 response_format / 提示词约束+重试）**对上层完全一致**。
 * 上层不该知道底下走的哪条——否则每个调用点都要分支，而分支会漂移。
 *
 * 失败时抛错而不是返回 null：调用方拿到 null 会当成"模型说没有"，
 * 而不是"我们没解析出来"，这两件事的处理方式完全不同。
 */
import type { z } from 'zod'
import type { ModelCapabilities } from './capability.ts'
import type { ModelEvent, ModelProvider, ModelRequest } from './provider.ts'

export const STRUCTURED_MAX_ATTEMPTS = 3

export class StructuredOutputError extends Error {
  readonly messageKey = 'error.structured_output'
  constructor(
    readonly attempts: number,
    /** 最后一次的原始返回全文（AC-4）。排查时没有它等于瞎猜 */
    readonly raw: string,
    readonly issues: string[],
  ) {
    super(`error.structured_output: ${attempts} 次都没拿到合法结构。最后一次问题：${issues.join('; ')}`)
    this.name = 'StructuredOutputError'
  }
}

async function collectText(it: AsyncIterable<ModelEvent>): Promise<string> {
  let text = ''
  for await (const e of it) if (e.type === 'delta') text += e.text
  return text
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.search(/[[{]/)
  if (start === -1) return body
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  return end > start ? body.slice(start, end + 1) : body.slice(start)
}

export interface StructuredDeps {
  provider: ModelProvider
  capabilities: ModelCapabilities
  signal?: AbortSignal
}

export async function generateStructured<T>(deps: StructuredDeps, schema: z.ZodType<T>, req: ModelRequest): Promise<T> {
  const signal = deps.signal ?? new AbortController().signal
  const native = deps.capabilities.structuredOutput

  let lastRaw = ''
  let lastIssues: string[] = []

  for (let attempt = 1; attempt <= STRUCTURED_MAX_ATTEMPTS; attempt++) {
    const messages = [...req.messages]
    if (!native) {
      // 降级路径：把约束写进提示词。重试时**把上一次的错误也带上**——
      // 只说"格式不对"而不说哪里不对，模型第二次大概率还是错一样的地方。
      const hint =
        attempt === 1
          ? '只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。'
          : `上一次的输出无法解析：${lastIssues.join('; ')}。只输出一个合法 JSON 对象。`
      messages.push({ role: 'user', content: hint })
    }

    const nextReq: ModelRequest = native
      ? { ...req, messages, providerOptions: { ...req.providerOptions, responseFormat: { type: 'json_object' } } }
      : { ...req, messages }

    lastRaw = await collectText(deps.provider.generate(nextReq, signal))
    const parsed = schema.safeParse(safeJsonParse(extractJson(lastRaw)))
    if (parsed.success) return parsed.data
    lastIssues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  }

  throw new StructuredOutputError(STRUCTURED_MAX_ATTEMPTS, lastRaw, lastIssues)
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
