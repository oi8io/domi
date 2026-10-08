/**
 * 前缀指纹 —— SPEC-M15-001（PRD-M15-001 AC-1/AC-2）
 *
 * 纯函数，不碰 IO；同一输入两次哈希一致（逐字节）；断裂定位：工具 → 层 → 消息。
 */
import { describe, expect, test } from 'bun:test'
import { fnv1a, type ModelMessages } from '@domi/protocol'
import { type Fingerprint, fingerprintOf, locateBreak, stableMessageHash } from '../src/fingerprint.ts'

const toolSchemas = [
  { name: 'fs.read', params: { line: 'number' } },
  { name: 'bash', params: {} },
]

const messages: ModelMessages = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '来了' },
]

function fp(input: Partial<Parameters<typeof fingerprintOf>[0]> = {}): Fingerprint {
  return fingerprintOf({ toolSchemas, messages, layers: [{ id: 'identity', hash: 'aa' }], ...input })
}

describe('fnv1a', () => {
  test('确定性：同一输入两次一致；空串有值', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('')).toBe('811c9dc5')
  })
  test('不同输入哈希不同', () => {
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })
})

describe('fingerprintOf', () => {
  test('同一输入两次指纹逐字节一致', () => {
    expect(fp()).toEqual(fp())
  })
  test('工具顺序变化 → toolHash 变化（工具表不稳会定位到 tools）', () => {
    const a = fp()
    const b = fp({ toolSchemas: [...toolSchemas].reverse() })
    expect(a.toolHash).not.toBe(b.toolHash)
    const br = locateBreak(a, b)
    expect(br?.cause).toBe('tools')
  })
  test('层文本变化 → 该层 hash 变化，定位到层 id', () => {
    const a = fp()
    const b = fp({ layers: [{ id: 'session.plan', hash: 'bb' }] })
    expect(locateBreak(a, b)).toEqual({ layer: 'session.plan', msgIndex: 0, cause: 'plan.update' })
  })
  test('消息逐条 hash：同位置 user 内容变化定位到消息 index', () => {
    const m1: ModelMessages = [
      { role: 'user', content: '你好' },
      { role: 'user', content: '第二条不变' },
      { role: 'assistant', content: '回复（协议回灌，不参与）' },
    ]
    const m2: ModelMessages = [
      { role: 'user', content: '你好' },
      { role: 'user', content: '第二条变了' },
      { role: 'assistant', content: '回复（协议回灌，不参与）' },
    ]
    const br = locateBreak(fp({ messages: m1 }), fp({ messages: m2 }))
    expect(br?.msgIndex).toBe(1)
  })
  test('尾部追加 user 消息（新输入 / 新轮）→ 协议必需，不算可避免断裂', () => {
    const a = fp()
    const b = fp({ messages: [...messages, { role: 'user', content: '再来一句' }] })
    expect(locateBreak(a, b)).toBeNull()
  })
  test('assistant 回复与 tool 回灌（协议必需）不触发断裂', () => {
    const a = fp()
    const b = fp({
      messages: [
        ...messages,
        { role: 'assistant', content: '我来改', toolCalls: [{ id: 't1', name: 'fs.read', args: {} }] },
        { role: 'tool', toolCallId: 't1', ok: true, content: '输出' },
      ],
    })
    expect(locateBreak(a, b)).toBeNull()
  })
  test('完全一致 → null', () => {
    expect(locateBreak(fp(), fp())).toBeNull()
  })
  test('images 剔除：同内容不同 images 不参与哈希', () => {
    const m1: ModelMessages = [{ role: 'user', content: '看图', images: [{ mime: 'image/png', data: 'x' }] }]
    const m2: ModelMessages = [{ role: 'user', content: '看图', images: [{ mime: 'image/png', data: 'y' }] }]
    expect(fp({ messages: m1 }).messages[0]).toBe(fp({ messages: m2 }).messages[0])
  })
})

describe('stableMessageHash', () => {
  test('tool 消息（role/toolCallId/ok/content）稳定', () => {
    const m1: ModelMessages[number] = { role: 'tool', toolCallId: 't1', ok: true, content: '输出' }
    expect(stableMessageHash(m1)).toBe(stableMessageHash(m1))
    const m2: ModelMessages[number] = { role: 'tool', toolCallId: 't1', ok: false, content: '输出' }
    expect(stableMessageHash(m1)).not.toBe(stableMessageHash(m2))
  })
})
