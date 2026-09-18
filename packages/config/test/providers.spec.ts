/**
 * SPEC-M9-002 取舍-2 · 运行期只有一种读法取某家的连接参数（BUG-M9-002）
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema, credentialEnvNames, loadConfig, providerConnection } from '../src/index.ts'

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
    expect(providerConnection(config, 'anthropic')).toEqual({
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
    expect(providerConnection(config, 'openai')).toEqual({ id: 'openai', models: [] })
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
