/**
 * PRD-M1-005 · 结构化输出（AC-1~4）
 * fixture 四类：valid / malformed-json / schema-mismatch / never-valid
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  CAPABILITIES,
  STRUCTURED_MAX_ATTEMPTS,
  StructuredOutputError,
  StubProvider,
  generateStructured,
} from '../src/index.ts'

const TitleSchema = z.object({ title: z.string().max(40), tags: z.array(z.string()) })
const REQ = { model: 'm', messages: [{ role: 'user' as const, content: '给这段对话起个标题' }] }

function textProvider(...turns: string[]) {
  return new StubProvider(
    turns.map((t) => [{ type: 'delta' as const, text: t }]),
    { onExhausted: 'repeat-last' },
  )
}

describe('AC-1 · 类型安全 + 运行时校验', () => {
  test('valid：一次就拿到合法结构', async () => {
    const provider = textProvider('{"title":"修复 sum.js","tags":["bug","js"]}')
    const r = await generateStructured(
      { provider, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    )
    expect(r).toEqual({ title: '修复 sum.js', tags: ['bug', 'js'] })
    // 类型是推出来的，不是 any
    const t: string = r.title
    expect(t).toBe('修复 sum.js')
  })

  test('模型爱加代码块和解释文字，照样能解析出来', async () => {
    const provider = textProvider('好的，这是结果：\n```json\n{"title":"标题","tags":[]}\n```\n希望有用。')
    const r = await generateStructured(
      { provider, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    )
    expect(r.title).toBe('标题')
  })
})

describe('AC-2 · 原生通道', () => {
  test('声明 structuredOutput 的 provider 走 response_format', async () => {
    const provider = textProvider('{"title":"原生","tags":[]}')
    await generateStructured({ provider, capabilities: CAPABILITIES.openai }, TitleSchema, REQ)
    expect(provider.calls[0]?.providerOptions).toMatchObject({ responseFormat: { type: 'json_object' } })
    // 原生通道**不**往消息里塞提示词
    expect(provider.calls[0]?.messages).toHaveLength(1)
  })

  test('不支持的 provider 走降级：往消息里加约束', async () => {
    const provider = textProvider('{"title":"降级","tags":[]}')
    await generateStructured({ provider, capabilities: CAPABILITIES['openai-compatible'] }, TitleSchema, REQ)
    expect(provider.calls[0]?.providerOptions).toBeUndefined()
    expect(provider.calls[0]?.messages).toHaveLength(2)
    expect(JSON.stringify(provider.calls[0]?.messages)).toContain('只输出一个 JSON 对象')
  })
})

describe('AC-3 · 降级路径最多 3 次', () => {
  test('malformed-json：第一次坏、第二次好 → 成功，且第二次把错误带回去了', async () => {
    const provider = textProvider('这不是 JSON', '{"title":"第二次","tags":[]}')
    const r = await generateStructured(
      { provider, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    )
    expect(r.title).toBe('第二次')
    // 只说「格式不对」不说哪里不对，模型第二次大概率还错一样的地方
    expect(JSON.stringify(provider.calls[1]?.messages)).toContain('上一次的输出无法解析')
  })

  test('schema-mismatch：JSON 合法但字段不对，也会重试', async () => {
    const provider = textProvider('{"name":"字段名错了"}', '{"title":"改对了","tags":[]}')
    const r = await generateStructured(
      { provider, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    )
    expect(r.title).toBe('改对了')
    expect(JSON.stringify(provider.calls[1]?.messages)).toContain('title')
  })

  test('接口签名与返回类型对上层完全一致 —— 上层不知道走的哪条路', async () => {
    const native = textProvider('{"title":"a","tags":[]}')
    const fallback = textProvider('{"title":"a","tags":[]}')
    const a = await generateStructured({ provider: native, capabilities: CAPABILITIES.openai }, TitleSchema, REQ)
    const b = await generateStructured(
      { provider: fallback, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    )
    expect(a).toEqual(b)
  })
})

describe('AC-4 · never-valid 时抛错并带上原文', () => {
  test('3 次都失败 → StructuredOutputError，raw 是最后一次原始返回全文', async () => {
    const provider = textProvider('永远不对')
    try {
      await generateStructured({ provider, capabilities: CAPABILITIES['openai-compatible'] }, TitleSchema, REQ)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredOutputError)
      const err = e as StructuredOutputError
      expect(err.attempts).toBe(STRUCTURED_MAX_ATTEMPTS)
      expect(err.raw).toBe('永远不对')
      expect(err.issues.length).toBeGreaterThan(0)
    }
    expect(provider.calls).toHaveLength(STRUCTURED_MAX_ATTEMPTS)
  })

  test('**不返回 null** —— 调用方会把 null 当成「模型说没有」，那是另一回事', async () => {
    const provider = textProvider('nope')
    const r = await generateStructured(
      { provider, capabilities: CAPABILITIES['openai-compatible'] },
      TitleSchema,
      REQ,
    ).catch((e) => e)
    expect(r).toBeInstanceOf(StructuredOutputError)
    expect(r).not.toBeNull()
  })
})
