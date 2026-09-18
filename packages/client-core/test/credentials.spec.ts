/**
 * OPT-M8-001 · 端上认出「缺模型凭据」并指路（判断在 daemon，这里只认结构化错误与设置里的 set 标记）
 */
import { describe, expect, test } from 'bun:test'
import { DomiRpcError, defaultProviderMissingKey, missingCredentialOf } from '../src/index.ts'

const settings = (provider: string, set: Record<string, boolean>) => ({
  values: { 'model.provider': provider },
  secrets: Object.fromEntries(Object.entries(set).map(([p, v]) => [p, { set: v }])),
  providers: [],
  paths: { config: '/c', secrets: '/s' },
  secretsTooOpen: false,
  writable: [],
})

describe('OPT-M8-001 · 缺凭据的引导', () => {
  test('missingCredentialOf 只认 reason = MISSING_CREDENTIAL 的 RPC 错误', () => {
    const miss = new DomiRpcError({
      code: 'INVALID_PARAMS',
      message: 'x',
      data: { reason: 'MISSING_CREDENTIAL', provider: 'deepseek' },
    })
    expect(missingCredentialOf(miss)).toBe('deepseek')
    expect(
      missingCredentialOf(
        new DomiRpcError({ code: 'INVALID_PARAMS', message: 'x', data: { reason: 'MISSING_CREDENTIAL' } }),
      ),
    ).toBe('')
    expect(missingCredentialOf(new DomiRpcError({ code: 'SESSION_BUSY', message: 'x' }))).toBeNull()
    expect(missingCredentialOf(new Error('MISSING_CREDENTIAL'))).toBeNull()
  })

  test('defaultProviderMissingKey：默认那一家没 key → 那一家；有 key 或看不出来 → null', () => {
    expect(defaultProviderMissingKey(settings('anthropic', { anthropic: false, openai: true }))).toBe('anthropic')
    expect(defaultProviderMissingKey(settings('openai', { anthropic: false, openai: true }))).toBeNull()
    // 不在可编辑清单里的 provider：看不出来就不提前拦，交给提交时 daemon 判断
    expect(defaultProviderMissingKey(settings('ollama', { anthropic: false }))).toBeNull()
  })
})
