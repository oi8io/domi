/**
 * PRD-M9-003 AC-5 / AC-6 · BUG-M9-001：重开会话后，会话用的模型与 provider 和关闭前一致
 *
 * 修之前：`DomiSession` 构造时只读配置里的默认模型，全仓没有地方回放 `model.switch`——
 * 第一条用例在修之前是红的（重开后 modelInfo 回到 anthropic / claude-sonnet-4-5）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { DomiSession, resolveModel } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-restore-'))
  dirs.push(d)
  return d
}

const cfg = (providers: Record<string, unknown>) =>
  ConfigSchema.parse({ model: { provider: 'anthropic', name: 'claude-sonnet-4-5', apiKey: 'k-a' }, providers })

async function reopen(config: ReturnType<typeof cfg>, dbPath: string, cwd: string) {
  const s = new DomiSession({ config, sessionId: 's1', cwd, dbPath })
  await s.recover()
  return s
}

describe('BUG-M9-001 · 重开会话回到关闭前的模型', () => {
  test('切到别家的模型 → 关掉 → 重开：还是那一家的那个模型；事件里记着 provider', async () => {
    const config = cfg({ deepseek: { apiKey: 'k-ds' } })
    const dbPath = join(tmp(), 'e.db')
    const cwd = tmp()
    const a = new DomiSession({ config, sessionId: 's1', cwd, dbPath })
    await a.switchModel('deepseek-chat', { provider: 'deepseek' })
    const ev = (await a.pumpAll()).find((e) => e.ev.t === 'model.switch')?.ev as { provider?: string }
    expect(ev.provider).toBe('deepseek')
    await a.flushAndClose()

    const b = await reopen(config, dbPath, cwd)
    expect(b.modelInfo()).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    // 恢复本身不写事件
    expect((await b.pumpAll()).filter((e) => e.ev.t === 'model.switch')).toHaveLength(1)
    await b.flushAndClose()
  })

  test('那一家后来被停用：回到默认模型，并追加一条说明原因的 model.switch（只一次）', async () => {
    const dbPath = join(tmp(), 'e.db')
    const cwd = tmp()
    const a = new DomiSession({ config: cfg({ deepseek: { apiKey: 'k-ds' } }), sessionId: 's1', cwd, dbPath })
    await a.switchModel('deepseek-chat', { provider: 'deepseek' })
    await a.flushAndClose()

    const off = cfg({ deepseek: { apiKey: 'k-ds', enabled: false } })
    const b = await reopen(off, dbPath, cwd)
    expect(b.modelInfo()).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' })
    const switches = (await b.pumpAll()).filter((e) => e.ev.t === 'model.switch').map((e) => e.ev)
    expect(switches).toHaveLength(2)
    expect(switches[1]).toMatchObject({ from: 'deepseek-chat', to: 'claude-sonnet-4-5', provider: 'anthropic' })
    expect((switches[1] as { reason?: string }).reason).toContain('deepseek')
    await b.flushAndClose()

    const c = await reopen(off, dbPath, cwd)
    expect((await c.pumpAll()).filter((e) => e.ev.t === 'model.switch')).toHaveLength(2)
    await c.flushAndClose()
  })

  test('v11 老会话（model.switch 没有 provider）：按默认那一家恢复', async () => {
    const dbPath = join(tmp(), 'e.db')
    const cwd = tmp()
    const config = cfg({})
    const a = new DomiSession({ config, sessionId: 's1', cwd, dbPath })
    await (a as unknown as { log: { append: (id: string, evs: unknown[]) => Promise<void> } }).log.append('s1', [
      { t: 'model.switch', from: 'claude-sonnet-4-5', to: 'claude-opus-4-1' },
    ])
    await a.flushAndClose()
    const b = await reopen(config, dbPath, cwd)
    expect(b.modelInfo()).toEqual({ provider: 'anthropic', model: 'claude-opus-4-1' })
    await b.flushAndClose()
  })
})

describe('PRD-M9-003 AC-3 · 手填模型名的归属', () => {
  const entry = (provider: string, name: string) => ({
    provider,
    providerName: provider.toUpperCase(),
    name,
    source: 'probe' as const,
    vision: true,
    toolCall: true,
  })
  const list = [
    entry('openai', 'gpt-4o'),
    entry('gw', 'gpt-4o'),
    entry('gw', 'glm-4.6'),
    entry('anthropic', 'claude-x'),
  ]

  test('默认那一家有 → 它（即便别家也有同名的）', () => {
    expect(resolveModel(list, 'claude-x', 'anthropic')).toEqual({ kind: 'ok', provider: 'anthropic', name: 'claude-x' })
    expect(resolveModel(list, 'gpt-4o', 'openai')).toEqual({ kind: 'ok', provider: 'openai', name: 'gpt-4o' })
  })

  test('只有一家有 → 那一家；好几家有 → 候选；都没有 → unresolved', () => {
    expect(resolveModel(list, ' glm-4.6 ', 'anthropic')).toEqual({ kind: 'ok', provider: 'gw', name: 'glm-4.6' })
    expect(resolveModel(list, 'gpt-4o', 'anthropic')).toEqual({
      kind: 'ambiguous',
      name: 'gpt-4o',
      candidates: [
        { provider: 'openai', providerName: 'OPENAI' },
        { provider: 'gw', providerName: 'GW' },
      ],
    })
    expect(resolveModel(list, 'nope', 'anthropic')).toEqual({ kind: 'unresolved', name: 'nope' })
  })
})
