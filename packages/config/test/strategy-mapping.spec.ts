/**
 * SPEC-M15-004 取舍-2：老配置 full / clean / compact 读时映射为 balanced，不回写。
 * _full 不暴露（取舍-28）
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema } from '../src/schema.ts'

const base = { model: { provider: 'stub', name: 's', apiKey: 'k' } }

describe('context.strategy 映射（取舍-2）', () => {
  test('默认 balanced', () => {
    const c = ConfigSchema.parse(base)
    expect(c.context.strategy).toBe('balanced')
  })
  test('balanced / economical 保留', () => {
    expect(ConfigSchema.parse({ ...base, context: { strategy: 'balanced' } }).context.strategy).toBe('balanced')
    expect(ConfigSchema.parse({ ...base, context: { strategy: 'economical' } }).context.strategy).toBe('economical')
  })
  test('旧值 full / clean / compact → balanced', () => {
    for (const old of ['full', 'clean', 'compact']) {
      expect(ConfigSchema.parse({ ...base, context: { strategy: old } }).context.strategy).toBe('balanced')
    }
  })
  test('非法策略名拒绝', () => {
    expect(() => ConfigSchema.parse({ ...base, context: { strategy: 'whatever' } })).toThrow()
  })
})
