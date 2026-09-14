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
