/**
 * `domi doctor --ping` —— 拿不到官方 key、走自建网关时的第一道自检
 *
 * 不打真接口（INV-08）：provider 是注入的。
 * 这里验的是**分类是否准确**——「key 不对 / 网关没通 / 模型名错」三种情况
 * 修法完全不同，而一句「连接失败」区分不了它们。
 */
import { describe, expect, test } from 'bun:test'
import type { ModelEvent, ModelProvider } from '@domi/model'
import { StubProvider } from '@domi/model'
import { diagnose, ping } from '../src/index.ts'

const BASE = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: 'sk-ant-abc',
  baseUrl: 'https://my-gateway.internal/v1',
  now: (() => {
    let t = 0
    return () => (t += 120)
  })(),
}

function provider(events: ModelEvent[]): ModelProvider {
  return new StubProvider([events], { onExhausted: 'repeat-last' })
}

function thrower(message: string): ModelProvider {
  return {
    id: 'x',
    capabilities: { toolCall: true, vision: true, reasoning: true, promptCache: true, structuredOutput: true },
    // biome-ignore lint/correctness/useYield: 故意在产出前就抛
    async *generate(): AsyncIterable<ModelEvent> {
      throw new Error(message)
    },
  }
}

describe('成功路径', () => {
  test('有响应就是通了，并带上耗时', async () => {
    const r = await ping({ ...BASE, makeProvider: () => provider([{ type: 'delta', text: 'pong' }]) })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('claude-sonnet-4-5')
    expect(r.ms).toBeGreaterThan(0)
  })

  test('只回 usage 不回文本也算通 —— 有些网关就是这样', async () => {
    const r = await ping({ ...BASE, makeProvider: () => provider([{ type: 'usage', raw: {} }]) })
    expect(r.ok).toBe(true)
  })
})

describe('把一句笼统的失败翻译成「是哪一环」', () => {
  test('401 → key 不被接受（端点是通的）', async () => {
    const r = await ping({ ...BASE, makeProvider: () => thrower('HTTP 401 Unauthorized') })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('端点通了，但 key 不被接受')
  })

  test('404 / model not found → 模型名不对（key 也是好的）', async () => {
    const r = await ping({ ...BASE, makeProvider: () => thrower('404 model not found') })
    expect(r.detail).toContain('模型名')
    expect(r.detail).toContain('claude-sonnet-4-5')
  })

  test('DNS 解析不了 → 连不上网关，并把网关地址说出来', async () => {
    const r = await ping({ ...BASE, makeProvider: () => thrower('getaddrinfo ENOTFOUND my-gateway.internal') })
    expect(r.detail).toContain('my-gateway.internal')
  })

  test('超时单独一类 —— 它和「连不上」的修法不一样', async () => {
    const r = await ping({ ...BASE, makeProvider: () => thrower('The operation timed out') })
    expect(r.detail).toContain('超时')
  })

  test('端点接受了但什么都没返回 → 多半是模型名不对', async () => {
    const r = await ping({ ...BASE, makeProvider: () => provider([]) })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('模型名不对')
  })

  test('error 事件也走同一套分类，不是只看抛出来的异常', async () => {
    const r = await ping({
      ...BASE,
      makeProvider: () => provider([{ type: 'error', message: '403 invalid x-api-key', recoverable: true }]),
    })
    expect(r.detail).toContain('key 不被接受')
  })
})

describe('doctor 把 ping 结果并进体检报告', () => {
  const input = {
    configPath: '/nonexistent/config.toml',
    hasCredential: true,
    credentialEnvNames: ['DOMI_API_KEY'],
    dataDir: '/tmp',
    gitAvailable: true,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    baseUrl: 'https://my-gateway.internal/v1',
  }

  test('自定义网关被显示出来 —— 用户要能确认自己连的是哪儿', () => {
    const f = diagnose(input).find((x) => x.title === '自定义网关')
    expect(f?.detail).toBe('https://my-gateway.internal/v1')
  })

  test('没配网关时显示官方端点', () => {
    const f = diagnose({ ...input, baseUrl: undefined }).find((x) => x.title === '模型端点')
    expect(f?.detail).toContain('官方端点')
  })

  test('ping 失败时给的是一条能看到真实响应的 curl，不是「检查一下网络」', () => {
    const f = diagnose({ ...input, ping: { ok: false, ms: 30, detail: '连不上' } }).find(
      (x) => x.title === '连不上模型端点',
    )
    expect(f?.fix).toMatch(/^\$ curl/)
    expect(f?.fix).toContain('my-gateway.internal')
    expect(f?.fix).not.toContain('检查')
  })

  test('不加 --ping 就不产生连通性条目 —— 它是真实调用，不该默认跑（INV-08）', () => {
    expect(diagnose(input).some((x) => x.title.includes('连通'))).toBe(false)
  })
})
