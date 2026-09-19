/**
 * PRD-M9-001 / PRD-M9-003 · 模型清单、归属与厂商模板**经 Domi Protocol** 的样子
 *
 * runtime 那层（`model-probe.spec.ts`、`model-restore.spec.ts`）验的是算法；这里验的是端真正拿到的东西：
 * daemon 把 ModelCatalog 接到 `model.list` / `model.resolve` / `provider.vendors` 上之后，形状、错误码、缓存与重探是否如 AC 所写。
 * 探测全部走注入的 fetch（INV-08），并断言请求只发往配置的地址（INV-11）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { RpcNotification, RpcResponse } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  }
})

const CONFIG_YAML = `model:
  provider: claude
  name: claude-sonnet
providers:
  claude: { name: Claude, vendor: anthropic, api_key: k1 }
  ds: { name: DeepSeek, vendor: deepseek, api_key: k2, models: [deepseek-chat] }
  gw: { name: Gateway, vendor: custom, protocol: openai, base_url: http://gw.local/v1, api_key: k3, models: [gw-extra] }
  off: { name: Off, vendor: openai, api_key: k4, enabled: false, models: [gpt-x] }
`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(withConfigFile = false) {
  const hostsHit: string[] = []
  const probeFetch = async (input: string) => {
    const u = new URL(input)
    hostsHit.push(u.host)
    if (u.host === 'api.anthropic.com')
      return json({ data: [{ id: 'claude-sonnet' }, { id: 'claude-haiku' }, { id: 'shared-model' }] })
    if (u.host === 'gw.local') return json({ data: [{ id: 'shared-model' }, { id: 'text-embedding-3-small' }] })
    if (u.host === 'api.deepseek.com') return new Response('nope', { status: 401 })
    throw new Error(`不该探测 ${u.host}`)
  }
  const d = mkdtempSync(join(tmpdir(), 'domi-models-'))
  dirs.push(d)
  // 配置总是从真文件读；要测 config.set 时再把文件交给宿主（设置页走的就是这条路）
  const configSource = { path: join(d, 'config.yaml'), env: {}, home: d }
  writeFileSync(configSource.path, CONFIG_YAML)
  const host = createRuntimeHost({
    config: loadConfig(configSource),
    ...(withConfigFile ? { configSource } : {}),
    dbPath: join(d, 'events.db'),
    defaultCwd: d,
    provider: new StubProvider([[{ type: 'delta', text: 'ok' }]], { onExhausted: 'repeat-last' }),
    probeFetch: probeFetch as never,
    newId: () => 'sess-1',
  })
  hosts.push(host)
  return { daemon: new Daemon(host), hostsHit }
}

class Conn implements ClientConn {
  readonly id = 'c'
  readonly got: Array<RpcNotification | RpcResponse> = []
  send(m: RpcNotification | RpcResponse): void {
    this.got.push(m)
  }
}

let n = 0
async function rpc(d: Daemon, method: string, params: unknown = {}) {
  const c = new Conn()
  await d.handle(c, {
    jsonrpc: '2.0',
    id: ++n,
    method: 'handshake',
    params: { protocolVersion: PROTOCOL_VERSION, client: 't' },
  })
  return d.handle(c, { jsonrpc: '2.0', id: ++n, method, params })
}

type Listed = {
  models: Array<{
    provider: string
    providerName: string
    name: string
    source: string
    vision: boolean
    toolCall: boolean
  }>
  providers: Array<{ id: string; name: string; status: string; error?: string }>
  current: { provider: string; name: string }
}

describe('PRD-M9-003 AC-2 · model.list 经协议返回扁平条目，只含启用的 provider', () => {
  test('条目带 provider / providerName / source / vision / toolCall；同名模型在两家各占一行；停用的不出现也不探测', async () => {
    const { daemon, hostsHit } = setup()
    const r = (await rpc(daemon, 'model.list')).result as Listed
    expect(r.current).toEqual({ provider: 'claude', name: 'claude-sonnet' })
    expect(r.models.find((m) => m.name === 'claude-sonnet')).toEqual({
      provider: 'claude',
      providerName: 'Claude',
      name: 'claude-sonnet',
      source: 'probe',
      vision: true,
      toolCall: true,
    })
    expect(
      r.models
        .filter((m) => m.name === 'shared-model')
        .map((m) => m.provider)
        .sort(),
    ).toEqual(['claude', 'gw'])
    expect(r.models.some((m) => m.provider === 'off')).toBe(false)
    expect(r.providers.map((p) => p.id)).not.toContain('off')
    // PRD-M9-001 AC-5：只打到配置的地址或厂商默认地址
    expect([...new Set(hostsHit)].sort()).toEqual(['api.anthropic.com', 'api.deepseek.com', 'gw.local'])
  })

  test('PRD-M9-001 AC-2 / AC-4：探测失败的那家降级为本地清单并标注；非对话模型被剔除；custom 的能力 fail-closed', async () => {
    const { daemon } = setup()
    const r = (await rpc(daemon, 'model.list')).result as Listed
    const ds = r.providers.find((p) => p.id === 'ds')
    expect(ds?.status).toBe('fallback')
    expect(ds?.error ?? '').not.toContain('k2')
    expect(r.models.find((m) => m.provider === 'ds')).toMatchObject({ name: 'deepseek-chat', source: 'fallback' })
    expect(r.models.some((m) => m.name.includes('embedding'))).toBe(false)
    expect(r.models.find((m) => m.provider === 'gw')).toMatchObject({ vision: false, toolCall: false })
    // 探测成功的那家，手填的是补充：manual
    expect(r.models.find((m) => m.name === 'gw-extra')).toMatchObject({ provider: 'gw', source: 'manual' })
  })

  test('PRD-M9-001 AC-3：第二次走缓存不再探测；refresh: true 强制重探', async () => {
    const { daemon, hostsHit } = setup()
    await rpc(daemon, 'model.list')
    const first = hostsHit.length
    await rpc(daemon, 'model.list')
    expect(hostsHit.length).toBe(first)
    await rpc(daemon, 'model.list', { refresh: true })
    expect(hostsHit.length).toBe(first * 2)
  })
})

describe('PRD-M9-003 AC-3 · model.resolve：只给名字，由 daemon 归属', () => {
  test('唯一命中 → 那一家；默认 provider 下有同名 → 默认那家', async () => {
    const { daemon } = setup()
    expect((await rpc(daemon, 'model.resolve', { name: 'deepseek-chat' })).result).toEqual({
      provider: 'ds',
      name: 'deepseek-chat',
    })
    expect((await rpc(daemon, 'model.resolve', { name: 'shared-model' })).result).toEqual({
      provider: 'claude',
      name: 'shared-model',
    })
  })

  test('哪儿都没有 → INVALID_PARAMS / MODEL_UNRESOLVED', async () => {
    const { daemon } = setup()
    const r = await rpc(daemon, 'model.resolve', { name: 'no-such-model' })
    expect(r.error).toMatchObject({ code: 'INVALID_PARAMS', data: { reason: 'MODEL_UNRESOLVED' } })
  })
})

describe('PRD-M9-002 AC-2 · provider.vendors：厂商模板是唯一来源，经协议给端上用', () => {
  test('五个模板；custom 能力全关；每个模板都给协议与惯用环境变量名', async () => {
    const { daemon } = setup()
    const r = (await rpc(daemon, 'provider.vendors')).result as {
      vendors: Array<{ id: string; protocol: string; capabilities: Record<string, boolean>; envNames: string[] }>
    }
    expect(r.vendors.map((v) => v.id).sort()).toEqual(['anthropic', 'custom', 'deepseek', 'gemini', 'openai'])
    const custom = r.vendors.find((v) => v.id === 'custom')
    expect(Object.values(custom?.capabilities ?? { x: true }).every((v) => v === false)).toBe(true)
    for (const v of r.vendors.filter((x) => x.id !== 'custom')) {
      expect(['openai', 'anthropic']).toContain(v.protocol)
      expect(v.envNames.length).toBeGreaterThan(0)
    }
  })
})

describe('PRD-M9-002 AC-5 / PRD-M9-001 AC-3 · 经 config.set 改 provider', () => {
  test('停用 / 删除默认那一家：INVALID_PARAMS，data.reason = DEFAULT_PROVIDER，带文案 key', async () => {
    const { daemon } = setup(true)
    for (const patch of [{ 'providers.claude.enabled': false }, { 'providers.claude': null }]) {
      const r = await rpc(daemon, 'config.set', { patch })
      expect(r.error).toMatchObject({ code: 'INVALID_PARAMS', data: { reason: 'DEFAULT_PROVIDER' } })
      expect(r.error?.data).toHaveProperty('messageKey')
    }
  })

  test('停用别的一家：立刻从 model.list 里消失（配置热加载 + 探测缓存按配置失效），也不再探测它', async () => {
    const { daemon, hostsHit } = setup(true)
    const before = (await rpc(daemon, 'model.list')).result as Listed
    expect(before.models.some((m) => m.provider === 'gw')).toBe(true)
    expect((await rpc(daemon, 'config.set', { patch: { 'providers.gw.enabled': false } })).result).toMatchObject({
      ok: true,
    })
    hostsHit.length = 0
    const after = (await rpc(daemon, 'model.list')).result as Listed
    expect(after.models.some((m) => m.provider === 'gw')).toBe(false)
    expect(hostsHit).not.toContain('gw.local')
  })
})
