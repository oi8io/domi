/**
 * 连通性自检 —— `domi doctor --ping`
 *
 * **只在显式加 --ping 时跑**，因为它是一次真实的模型调用（INV-08：不进 CI 门禁）。
 * 但它值得存在：拿不到官方 key、走自建网关的人，第一个问题永远是
 * 「到底是我的 key 不对，还是网关没通，还是模型名写错了」——
 * 三种情况的修法完全不同，而一句「连接失败」区分不了它们。
 */

import type { ModelProvider } from '@domi/model'
import { createProvider, StubProvider } from '@domi/model'
import type { PingResult } from './doctor.ts'

export interface PingInput {
  provider: string
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  now?: () => number
  /** 注入用；不给就按配置真建一个 */
  makeProvider?: (cfg: {
    provider: string
    name: string
    apiKey: string | undefined
    baseUrl: string | undefined
  }) => ModelProvider
}

export async function ping(input: PingInput): Promise<PingResult> {
  const now = input.now ?? (() => Date.now())
  const t0 = now()
  const make =
    input.makeProvider ??
    ((cfg) => createProvider({ provider: cfg.provider, name: cfg.name, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }))

  try {
    const p = make({ provider: input.provider, name: input.model, apiKey: input.apiKey, baseUrl: input.baseUrl })
    let sawText = false
    let error: string | null = null
    for await (const ev of p.generate(
      { model: input.model, messages: [{ role: 'user', content: 'ping' }] },
      AbortSignal.timeout(15_000),
    )) {
      if (ev.type === 'delta' || ev.type === 'usage') sawText = true
      if (ev.type === 'error') error = ev.message
    }
    const ms = now() - t0
    if (error) return { ok: false, ms, detail: classify(error, input) }
    return sawText
      ? { ok: true, ms, detail: `${input.provider}/${input.model} 有响应` }
      : { ok: false, ms, detail: '端点接受了请求但什么都没返回——多半是模型名不对' }
  } catch (e) {
    return { ok: false, ms: now() - t0, detail: classify(e instanceof Error ? e.message : String(e), input) }
  }
}

/** 把一句笼统的失败翻译成「是哪一环」——三种情况的修法完全不同 */
function classify(msg: string, input: PingInput): string {
  const m = msg.toLowerCase()
  if (/401|403|unauthorized|invalid.*key|authentication/.test(m)) {
    return `端点通了，但 key 不被接受：${msg}`
  }
  if (/404|not found|model/.test(m)) {
    return `端点通了、key 也过了，但模型名 "${input.model}" 找不到：${msg}`
  }
  if (/enotfound|econnrefused|dns|getaddrinfo/.test(m)) {
    return `连不上 ${input.baseUrl ?? input.provider}：${msg}`
  }
  if (/timeout|timed out|abort/.test(m)) return `超时（15 秒）：${msg}`
  return msg
}

/** 供测试：一个永远成功的替身 */
export function stubPingProvider(): ModelProvider {
  return new StubProvider([[{ type: 'delta', text: 'pong' }]])
}
