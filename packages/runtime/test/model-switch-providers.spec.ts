/**
 * PRD-M9-003 AC-7 · 切换仍产生 model.switch，切到能力更弱的模型时列出失去的能力（PRD-M1-002 AC-1/2 不回退）
 *
 * M9 之后能力挂在 provider 上（厂商模板给默认、配置可覆盖），所以「更弱」要按**目标 provider**的能力算：
 * 跨 provider 切换时用的是那一家的模板与覆盖，而不是当前这一家的。
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
  const d = mkdtempSync(join(tmpdir(), 'domi-switch-m9-'))
  dirs.push(d)
  return d
}

const clock = (() => {
  let t = 1_758_000_000_000
  return { now: () => (t += 1) }
})()

function session() {
  const config = ConfigSchema.parse({
    model: { provider: 'claude', name: 'claude-sonnet' },
    providers: {
      claude: { vendor: 'anthropic', apiKey: 'k1' },
      ds: { vendor: 'deepseek', apiKey: 'k2' },
      local: { vendor: 'custom', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen'] },
      // 自定义网关，但显式声明了能力：不应被报成降级
      gw: {
        vendor: 'custom',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:4000/v1',
        capabilities: { toolCall: true, vision: true, reasoning: true, promptCache: true, structuredOutput: false },
      },
    },
  })
  return new DomiSession({
    config,
    sessionId: 's1',
    cwd: tmp(),
    dbPath: join(tmp(), 'e.db'),
    clock,
    provider: new StubProvider([[{ type: 'delta', text: 'ok' }]], { onExhausted: 'repeat-last' }),
  })
}

describe('PRD-M9-003 AC-7 · 跨 provider 切换按目标 provider 的能力算失去了什么', () => {
  test('anthropic → deepseek：只失去 vision（和 prompt 缓存）；事件带 provider 与 lostCapabilities', async () => {
    const s = session()
    expect(s.previewSwitch('deepseek-chat', 'ds').lost).toContain('vision')
    expect(s.previewSwitch('deepseek-chat', 'ds').lost).not.toContain('toolCall')
    const { lost } = await s.switchModel('deepseek-chat', { provider: 'ds' })
    const sw = (await s.pumpAll()).find((e) => e.ev.t === 'model.switch')
    expect(sw?.ev).toMatchObject({ from: 'claude-sonnet', to: 'deepseek-chat', provider: 'ds', lostCapabilities: lost })
    expect(lost).toContain('vision')
    await s.flushAndClose()
  }, 15_000)

  test('切到没声明能力的自定义 provider：fail-closed，工具调用与视觉都列为失去', async () => {
    const s = session()
    const { lost } = await s.switchModel('qwen', { provider: 'local' })
    expect(lost).toEqual(expect.arrayContaining(['toolCall', 'vision']))
    await s.flushAndClose()
  }, 15_000)

  test('目标 provider 显式声明了能力：不报降级；切回更强的也不报', async () => {
    const s = session()
    expect(s.previewSwitch('any-model', 'gw').lost).not.toContain('toolCall')
    expect(s.previewSwitch('any-model', 'gw').lost).not.toContain('vision')
    await s.switchModel('qwen', { provider: 'local' })
    const back = await s.switchModel('claude-sonnet', { provider: 'claude' })
    expect(back.lost).toEqual([])
    const events = await s.pumpAll()
    const last = events.filter((e) => e.ev.t === 'model.switch').at(-1)
    expect(last?.ev).not.toHaveProperty('lostCapabilities')
    await s.flushAndClose()
  }, 15_000)
})
