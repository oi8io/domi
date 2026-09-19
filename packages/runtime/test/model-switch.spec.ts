/**
 * PRD-M1-002 · 会话中途切换模型（AC-1~3）· SPEC-M1-003
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-switch-'))
  dirs.push(d)
  return d
}

const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

function session(providerKind: string) {
  const config = ConfigSchema.parse({ model: { provider: providerKind, name: 'model-a', apiKey: 'k' } })
  return new DomiSession({
    config,
    sessionId: 's1',
    cwd: tmp(),
    dbPath: join(tmp(), 'e.db'),
    clock,
    provider: new StubProvider([[{ type: 'delta', text: 'ok' }]], { onExhausted: 'repeat-last' }),
  })
}

describe('AC-1 · 切换产生事件且可定位', () => {
  test('model.switch 记下 from / to，轨迹中能找到起始 seq', async () => {
    const s = session('anthropic')
    await s.submit('第一轮')
    const before = await s.pumpAll()

    await s.switchModel('model-b', { reason: '省钱' })
    const after = await s.pumpAll()

    const sw = after.find((e) => e.ev.t === 'model.switch')!
    expect(sw.ev).toMatchObject({ from: 'model-a', to: 'model-b', reason: '省钱' })
    expect(sw.seq).toBe(before.length + 1)
    await s.flushAndClose()
  }, 15_000)
})

describe('AC-3 · 历史事件零丢失', () => {
  test('切换前后事件总数只增不减，且旧事件一字不动', async () => {
    const s = session('anthropic')
    await s.submit('第一轮')
    const before = await s.pumpAll()

    await s.switchModel('model-b')
    const after = await s.pumpAll()

    expect(after.length).toBe(before.length + 1)
    expect(JSON.parse(JSON.stringify(after.slice(0, before.length)))).toEqual(JSON.parse(JSON.stringify(before)))
    await s.flushAndClose()
  }, 15_000)

  test('切换之后的那一轮用新模型发请求', async () => {
    const s = session('anthropic')
    await s.submit('第一轮')
    await s.switchModel('model-b')
    await s.submit('第二轮')

    const reqs = (await s.pumpAll()).filter((e) => e.ev.t === 'model.request')
    const last = reqs.at(-1)
    if (!last) throw new Error('切换之后应该有一次 model.request')
    expect((last.ev as { model: string }).model).toBe('model-b')
    await s.flushAndClose()
  }, 15_000)
})

describe('AC-2 · 切到能力更弱的模型时列出将失去的能力', () => {
  test('同 provider 换模型：矩阵一致，不该报降级', async () => {
    const s = session('anthropic')
    expect(s.previewSwitch('model-b').lost).toEqual([])
    await s.flushAndClose()
  }, 15_000)

  test('anthropic → 本地网关：失去的能力被列出来（这才是「切到更弱的模型」）', async () => {
    const s = session('anthropic')
    const { lost } = s.previewSwitch('qwen-local', 'openai-compatible')
    expect(lost).toContain('toolCall')
    expect(lost).toContain('promptCache')
    await s.flushAndClose()
  }, 15_000)

  test('反向切回去不算降级 —— 差集是有方向的', async () => {
    const weak = session('openai-compatible')
    expect(weak.previewSwitch('claude-sonnet-4-5', 'anthropic').lost).toEqual([])
    await weak.flushAndClose()
  }, 15_000)

  test('失去的能力名写进事件，事后能审计「那一轮为什么没用工具」', async () => {
    const s = session('anthropic')
    const { lost } = await s.switchModel('qwen-local', { provider: 'openai-compatible' })
    expect(lost.length).toBeGreaterThan(0)
    const sw = (await s.pumpAll()).find((e) => e.ev.t === 'model.switch')!
    expect((sw.ev as { lostCapabilities?: string[] }).lostCapabilities).toEqual(lost)
    await s.flushAndClose()
  }, 15_000)
})

describe('切换之后，发出去的请求真的换了模型（2026-09-15 发现）', () => {
  // 原来 switchModel 只改了 currentModel 这个字符串：AiSdkProvider 在构造时就绑死了模型名，
  // 请求里的 model 字段它根本不看。替身 provider 看不出这个问题——所以这里用真工厂 + 假网关
  test('第二轮请求体里的 model 是新名字', async () => {
    const bodies: Array<{ model?: string }> = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        bodies.push((await req.json()) as { model?: string })
        const chunk = (d: Record<string, unknown>, f: string | null) =>
          `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`
        return new Response(`${chunk({ content: 'ok' }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    try {
      const config = ConfigSchema.parse({
        model: {
          provider: 'local-gw',
          name: 'model-a',
          apiKey: 'k',
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          capabilities: { toolCall: true },
        },
      })
      const s = new DomiSession({ config, sessionId: 's1', cwd: tmp(), dbPath: join(tmp(), 'e.db'), clock })
      await s.submit('第一轮')
      await s.switchModel('model-b')
      await s.submit('第二轮')
      // 过滤标题生成请求（M10-001）：它会多发一个请求到网关，model 是当前模型，与切换断言无关
      expect(
        bodies.filter((b) => !JSON.stringify(b.messages).includes('起一个不超过 20 字的标题')).map((b) => b.model),
      ).toEqual(['model-a', 'model-b'])
      expect(s.modelInfo()).toEqual({ provider: 'local-gw', model: 'model-b' })
      await s.flushAndClose()
    } finally {
      await server.stop(true)
    }
  }, 15_000)
})
