/**
 * 结构化输出 —— PRD-M1-005 · SPEC-M1-005
 *
 * 两条路径（原生 response_format / 提示词约束+重试）**对上层完全一致**。
 * 上层不该知道底下走的哪条——否则每个调用点都要分支，而分支会漂移。
 *
 * 失败时抛错而不是返回 null：调用方拿到 null 会当成"模型说没有"，
 * 而不是"我们没解析出来"，这两件事的处理方式完全不同。
 */
import { toJSONSchema, type z } from 'zod'
import type { ModelCapabilities } from './capability.ts'
import type { ModelProvider, ModelRequest } from './provider.ts'

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
    let nextReq: ModelRequest
    if (native) {
      nextReq = {
        ...req,
        messages,
        providerOptions: { ...req.providerOptions, responseFormat: { type: 'json_object' } },
      }
    } else {
      // 降级路径（SPEC-M15-008 取舍-22）：第一次尝试把 schema 塞进 submit_items 工具的
      // inputSchema，让模型**调用工具提交**——比「只输出 JSON」稳，厂商也认。
      // 之后重试退到纯提示词（工具能力有问题的厂商也有救），并且把上次的错误带回去。
      if (attempt === 1) {
        const toolSchema = toJSONSchema(schema) as Record<string, unknown>
        nextReq = {
          ...req,
          messages: [
            ...messages,
            { role: 'user' as const, content: '请调用 submit_items 工具提交结果，参数就是你要给出的数据。' },
          ],
          tools: [
            ...(req.tools ?? []),
            {
              name: 'submit_items',
              description: '提交本次任务的结果。参数就是你要给出的数据。',
              inputSchema: toolSchema,
            },
          ],
        }
      } else {
        const hint = `上一次的输出无法解析：${lastIssues.join('; ')}。只输出一个合法 JSON 对象。`
        nextReq = { ...req, messages: [...messages, { role: 'user', content: hint }] }
      }
    }

    // 收集：工具调用参数（降级路径的首选）+ 文本（提示词路径）
    let text = ''
    let toolArgs: unknown
    for await (const e of deps.provider.generate(nextReq, signal)) {
      if (e.type === 'delta') text += e.text
      else if (e.type === 'tool-call' && e.name === 'submit_items') toolArgs = e.args
    }
    lastRaw = text

    // 解析候选：工具参数优先，其次文本（兼容 markdown 包裹 / 数组外框）。
    // 「直接给数组」是 RECON S9 实测最多的偏差：schema 是 { items: [...] } 时，
    // 把数组包成 { items } 再试一轮
    const candidates: unknown[] = []
    if (toolArgs !== undefined) candidates.push(toolArgs)
    if (text.trim() !== '') candidates.push(safeJsonParse(extractJson(text)))
    let parsed: ReturnType<typeof schema.safeParse> | null = null
    for (const c of candidates) {
      if (c === undefined) continue
      parsed = schema.safeParse(c)
      if (parsed.success) return parsed.data
      if (Array.isArray(c)) {
        const wrapped = schema.safeParse({ items: c })
        if (wrapped.success) return wrapped.data
      }
    }
    lastIssues =
      parsed === null
        ? ['没有收到工具调用，也没有可解析的文本']
        : parsed.success === false
          ? parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          : []
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
