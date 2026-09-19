/**
 * SPEC-M9-002 取舍-2 · 运行期只有一种读法取某家的连接参数（BUG-M9-002）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigSchema,
  ConfigWriteError,
  credentialEnvNames,
  loadConfig,
  maskSecret,
  providerConnection,
  readSettings,
  writeConfigPatch,
} from '../src/index.ts'

describe('providerConnection', () => {
  const config = ConfigSchema.parse({
    model: {
      provider: 'anthropic',
      name: 'm',
      apiKey: 'k-legacy',
      baseUrl: 'https://a.example',
      capabilities: { toolCall: true },
    },
    providers: { gw: { baseUrl: 'https://gw.example/v1', models: ['x'] } },
  })

  test('默认那一家：旧写法 model.* 并进来', () => {
    expect(providerConnection(config, 'anthropic')).toMatchObject({
      id: 'anthropic',
      apiKey: 'k-legacy',
      baseUrl: 'https://a.example',
      capabilities: { toolCall: true },
      models: [],
    })
  })

  test('别家：只有它自己的，缺 key 就是缺，能力覆盖不串过去', () => {
    const c = providerConnection(config, 'gw')
    expect(c.apiKey).toBeUndefined()
    expect(c.capabilities).toBeUndefined()
    expect(c.baseUrl).toBe('https://gw.example/v1')
    expect(c.models).toEqual(['x'])
  })

  test('没登记的一家：什么都没有，不借默认那一家的地址', () => {
    expect(providerConnection(config, 'openai')).toMatchObject({ id: 'openai', models: [] })
    expect(providerConnection(config, 'openai').apiKey).toBeUndefined()
    expect(providerConnection(config, 'openai').baseUrl).toBeUndefined()
  })
})

describe('DOMI_API_KEY 只给默认模型所在的那一家（PRD-M9-002 AC-6）', () => {
  test('环境变量名', () => {
    expect(credentialEnvNames('anthropic')).toEqual(['DOMI_API_KEY', 'ANTHROPIC_API_KEY', 'DOMI_ANTHROPIC_API_KEY'])
    expect(credentialEnvNames('openai', false)).toEqual(['OPENAI_API_KEY', 'DOMI_OPENAI_API_KEY'])
    // 自定义 id：DOMI_<ID>_API_KEY（- 转 _）
    expect(credentialEnvNames('my-gw', false)).toEqual(['DOMI_MY_GW_API_KEY'])
  })

  test('装载：DOMI_API_KEY 不会变成别家的 key', () => {
    const cfg = loadConfig({
      path: '/nonexistent/config.yaml',
      env: { DOMI_API_KEY: 'k-uni', DOMI_MODEL_PROVIDER: 'anthropic' },
    })
    expect(providerConnection(cfg, 'anthropic').apiKey).toBe('k-uni')
    expect(providerConnection(cfg, 'openai').apiKey).toBeUndefined()
  })
})

describe('PRD-M9-002 · provider 的增删改（config.set 白名单）', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
  })
  function home(text: string) {
    const h = mkdtempSync(join(tmpdir(), 'domi-prov-'))
    dirs.push(h)
    mkdirSync(join(h, '.domi'))
    writeFileSync(join(h, '.domi', 'config.yaml'), text)
    return {
      cfg: join(h, '.domi', 'config.yaml'),
      secrets: join(h, '.domi', 'secrets.yaml'),
      opts: { home: h, env: {} },
    }
  }
  const BASE = 'model:\n  provider: anthropic\n  name: claude-sonnet-4-5\n'

  test('AC-1 / AC-8：新增一家自定义网关，七个字段齐全；key 只进 secrets.yaml', () => {
    const h = home(BASE)
    writeConfigPatch(
      {
        'providers.my-gw.name': '公司网关',
        'providers.my-gw.vendor': 'custom',
        'providers.my-gw.protocol': 'anthropic',
        'providers.my-gw.base_url': 'https://gw.example/api/anthropic',
        'providers.my-gw.api_key': 'sk-gw-0123456789',
        'providers.my-gw.enabled': true,
        'providers.my-gw.models': ['glm-4.6'],
        'providers.my-gw.capabilities': { toolCall: true },
      },
      h.opts,
    )
    expect(readFileSync(h.cfg, 'utf8')).not.toContain('sk-gw-0123456789')
    expect(readFileSync(h.secrets, 'utf8')).toContain('sk-gw-0123456789')
    const p = providerConnection(loadConfig(h.opts), 'my-gw')
    expect(p).toMatchObject({
      name: '公司网关',
      vendor: 'custom',
      protocol: 'anthropic',
      baseUrl: 'https://gw.example/api/anthropic',
      apiKey: 'sk-gw-0123456789',
      enabled: true,
      models: ['glm-4.6'],
      capabilities: { toolCall: true },
      inferred: false,
    })
    const view = readSettings(h.opts).providers.find((x) => x.id === 'my-gw')
    expect(view?.key).toEqual({ set: true, masked: maskSecret('sk-gw-0123456789'), source: 'secrets' })
  })

  test('AC-8：删掉整条——config 与 secrets 两边都没了；字段之外的键、不合规的新 id 一律拒绝', () => {
    const h = home(`${BASE}providers:\n  my-gw:\n    base_url: https://gw.example/v1\n`)
    writeConfigPatch({ 'providers.my-gw.api_key': 'sk-gw-0123456789' }, h.opts)
    writeConfigPatch({ 'providers.my-gw': null }, h.opts)
    expect(readFileSync(h.cfg, 'utf8')).not.toContain('my-gw')
    expect(readFileSync(h.secrets, 'utf8')).not.toContain('sk-gw')
    for (const bad of [
      { 'providers.my-gw.hooks': [] },
      { 'providers.Bad_Id.base_url': 'x' },
      { 'providers.my-gw': { base_url: 'x' } },
      { 'providers.my-gw.name': 'x', 'permissions.rules': [] },
    ]) {
      expect(() => writeConfigPatch(bad as never, h.opts)).toThrow(ConfigWriteError)
    }
  })

  test('AC-5：默认模型所在的那一家不能停用、不能删（reason = DEFAULT_PROVIDER）；先换默认就可以', () => {
    const h = home(`${BASE}providers:\n  anthropic:\n    base_url: https://a.example\n  deepseek: {}\n`)
    for (const bad of [{ 'providers.anthropic.enabled': false }, { 'providers.anthropic': null }]) {
      try {
        writeConfigPatch(bad, h.opts)
        throw new Error('should have thrown')
      } catch (e) {
        expect((e as ConfigWriteError).reason).toBe('DEFAULT_PROVIDER')
      }
    }
    writeConfigPatch(
      { 'model.provider': 'deepseek', 'model.name': 'deepseek-chat', 'providers.anthropic.enabled': false },
      h.opts,
    )
    expect(providerConnection(loadConfig(h.opts), 'anthropic').enabled).toBe(false)
  })

  test('PRD-M10-002 AC-1（回归）：设新默认后旧默认的保护解除，新默认接管', () => {
    const h = home(`${BASE}providers:\n  anthropic:\n    base_url: https://a.example\n  deepseek: {}\n`)
    // 当前 anthropic 是默认：删它被拒
    try {
      writeConfigPatch({ 'providers.anthropic': null }, h.opts)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ConfigWriteError).reason).toBe('DEFAULT_PROVIDER')
    }
    // 「设为默认」= 写 model.provider + model.name（Web 补丁的等价物）
    writeConfigPatch({ 'model.provider': 'deepseek', 'model.name': 'deepseek-chat' }, h.opts)
    const cfg = loadConfig(h.opts)
    expect(cfg.model.provider).toBe('deepseek')
    expect(cfg.model.name).toBe('deepseek-chat')
    // 新默认接管保护：deepseek 不能停/删
    try {
      writeConfigPatch({ 'providers.deepseek': null }, h.opts)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ConfigWriteError).reason).toBe('DEFAULT_PROVIDER')
    }
    // 旧默认保护解除：anthropic 现在可以停用
    writeConfigPatch({ 'providers.anthropic.enabled': false }, h.opts)
    expect(providerConnection(loadConfig(h.opts), 'anthropic').enabled).toBe(false)
  })

  test('AC-7：旧配置照读，按键名推断 vendor；设置页标出 inferred', () => {
    const h = home(`${BASE}providers:\n  openai-compatible:\n    base_url: http://localhost:4000/v1\n  google: {}\n`)
    const cfg = loadConfig(h.opts)
    expect(providerConnection(cfg, 'openai-compatible')).toMatchObject({
      vendor: 'custom',
      protocol: 'openai',
      inferred: true,
    })
    expect(providerConnection(cfg, 'google')).toMatchObject({ vendor: 'gemini', protocol: 'openai' })
    expect(readSettings(h.opts).providers.map((p) => [p.id, p.isDefault])).toEqual([
      ['anthropic', true],
      ['openai-compatible', false],
      ['google', false],
    ])
  })
})
