/**
 * PRD-M15-002 AC-1 · 模型窗口表（SPEC-M15-002 取舍-15）
 * - 内置常用模型窗口；未知模型保守默认 128k / 8k
 * - 设置里可填（model.contextWindow / model.maxOutput）覆盖内置表
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema, DEFAULT_WINDOW, MODEL_WINDOWS, modelWindow } from '../src/index.ts'

describe('PRD-M15-002 AC-1 · 模型窗口表', () => {
  test('内置常用模型有窗口 / 输出预留', () => {
    expect(MODEL_WINDOWS['deepseek-chat']).toEqual({ contextWindow: 128_000, maxOutput: 8_000 })
    expect(MODEL_WINDOWS['deepseek-v4-pro']).toEqual({ contextWindow: 128_000, maxOutput: 8_000 })
    expect(MODEL_WINDOWS['claude-3-7-sonnet']).toEqual({ contextWindow: 200_000, maxOutput: 32_000 })
    expect(MODEL_WINDOWS['claude-3-5-sonnet']).toEqual({ contextWindow: 200_000, maxOutput: 32_000 })
    expect(MODEL_WINDOWS['gpt-4o']).toEqual({ contextWindow: 128_000, maxOutput: 16_000 })
    expect(MODEL_WINDOWS['glm-4.7-flash']).toEqual({ contextWindow: 128_000, maxOutput: 8_000 })
  })

  test('gemini 系列按前缀匹配（估算 1M / 8k）', () => {
    const w = modelWindow('gemini-2.5-pro')
    expect(w.contextWindow).toBe(1_000_000)
    expect(w.maxOutput).toBe(8_000)
  })

  test('未知模型 → 保守默认 128k / 8k', () => {
    const w = modelWindow('totally-unknown-model-x')
    expect(w).toEqual(DEFAULT_WINDOW)
    expect(DEFAULT_WINDOW).toEqual({ contextWindow: 128_000, maxOutput: 8_000 })
  })

  test('设置里的 contextWindow / maxOutput 覆盖内置表', () => {
    expect(modelWindow('deepseek-chat', { contextWindow: 64_000 }).contextWindow).toBe(64_000)
    expect(modelWindow('deepseek-chat', { maxOutput: 16_000 }).maxOutput).toBe(16_000)
    expect(modelWindow('deepseek-chat', { contextWindow: 64_000, maxOutput: 16_000 })).toEqual({
      contextWindow: 64_000,
      maxOutput: 16_000,
    })
  })

  test('未知模型 + 设置可填（AC-1 设置兜底）', () => {
    expect(modelWindow('unknown', { contextWindow: 200_000, maxOutput: 16_000 })).toEqual({
      contextWindow: 200_000,
      maxOutput: 16_000,
    })
  })

  test('schema 支持 model.contextWindow / model.maxOutput（可选）', () => {
    const cfg = ConfigSchema.parse({
      model: { provider: 'stub', name: 'm', apiKey: 'k', contextWindow: 200_000, maxOutput: 16_000 },
    })
    expect(cfg.model.contextWindow).toBe(200_000)
    expect(cfg.model.maxOutput).toBe(16_000)
  })
})
