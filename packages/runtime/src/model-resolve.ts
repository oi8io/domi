/**
 * 手填模型名 → 归属到哪一家 —— PRD-M9-003 AC-3 · SPEC-M9-003 取舍-4
 *
 * 模型的身份是 (provider, name)：官方 + 网关同时提供 `gpt-4o` 很常见，光看名字认不出是哪一家。
 * 用户在对话里只填模型名（不切 provider），由这里按固定顺序归属：
 *   1. 默认模型所在的那一家有这个名字 → 它
 *   2. 只有一家有 → 那一家
 *   3. 好几家都有 → 返回候选，让用户选（选的仍是「模型」，不是「切 provider」）
 *   4. 没有一家有 → 报错，提示去设置页添加
 * 「有」查的是 model.list 的同一份清单（探测 + 手填 + 默认模型），所以探测失败时也能按手填清单归属。
 */
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import type { ModelEntry } from './model-catalog.ts'

export type ResolveResult =
  | { kind: 'ok'; provider: string; name: string }
  | { kind: 'ambiguous'; name: string; candidates: Array<{ provider: string; providerName: string }> }
  | { kind: 'unresolved'; name: string }

export function resolveModel(models: readonly ModelEntry[], name: string, defaultProvider: string): ResolveResult {
  const want = name.trim()
  const hits = models.filter((m) => m.name === want)
  if (hits.some((m) => m.provider === defaultProvider)) return { kind: 'ok', provider: defaultProvider, name: want }
  const providers = [...new Map(hits.map((m) => [m.provider, m])).values()]
  if (providers.length === 1) return { kind: 'ok', provider: (providers[0] as ModelEntry).provider, name: want }
  if (providers.length > 1) {
    return {
      kind: 'ambiguous',
      name: want,
      candidates: providers.map((m) => ({ provider: m.provider, providerName: m.providerName })),
    }
  }
  return { kind: 'unresolved', name: want }
}

export class ModelResolveError extends KeyedError {
  constructor(
    key: MessageKey,
    params: Params,
    readonly reason: 'MODEL_UNRESOLVED' | 'AMBIGUOUS' | 'PROVIDER_UNAVAILABLE',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(key, params)
    this.name = 'ModelResolveError'
  }
}

/** 把非 ok 的结果变成错误（daemon 转成 INVALID_PARAMS，data.reason 带上） */
export function assertResolved(r: ResolveResult): { provider: string; name: string } {
  if (r.kind === 'ok') return { provider: r.provider, name: r.name }
  if (r.kind === 'ambiguous') {
    throw new ModelResolveError(
      'error.model.ambiguous',
      { name: r.name, providers: r.candidates.map((c) => c.providerName).join(', ') },
      'AMBIGUOUS',
      { name: r.name, candidates: r.candidates },
    )
  }
  throw new ModelResolveError('error.model.unresolved', { name: r.name }, 'MODEL_UNRESOLVED', { name: r.name })
}
