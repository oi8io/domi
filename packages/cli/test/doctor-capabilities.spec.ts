/**
 * SPEC-M15-006 AC-6：doctor 列「这家支持什么、开了什么」。
 * 纯函数直打，不联网、不改库。
 */
import { describe, expect, test } from 'bun:test'
import { VENDORS } from '@domi/config'
import { capabilityLines } from '../src/doctor-capabilities.ts'

const base = { provider: 'deepseek', modelName: 'deepseek-chat', serverSide: false }

describe('capabilityLines（SPEC-M15-006 AC-6）', () => {
  test('deepseek：能力表按实际显示自动缓存', () => {
    const lines = capabilityLines({ ...base }, VENDORS.deepseek).join('\n')
    expect(lines).toContain('厂商：deepseek · 模型 deepseek-chat')
    expect(lines).toContain('支持：工具调用 / 推理 / 提示词缓存')
    expect(lines).toContain('提示词缓存：厂商自动（无需参数）')
    expect(lines).toContain('服务端能力（compaction / clear_tool_uses）：关（默认，P1 骨架）')
  })

  test('anthropic：显式缓存参数与 TTL；serverSide 开了就显示开', () => {
    const lines = capabilityLines(
      { provider: 'anthropic', modelName: 'claude-sonnet-4-5', ttlOverride: 1800, serverSide: true },
      VENDORS.anthropic,
    ).join('\n')
    expect(lines).toContain('提示词缓存：顶层 cache_control，TTL 1800s')
    expect(lines).toContain('服务端能力（compaction / clear_tool_uses）：开')
  })

  test('openai 自定义端点：prompt_cache_key（网关需支持）', () => {
    const lines = capabilityLines(
      { provider: 'openai', modelName: 'gpt-5', baseUrl: 'https://gw.example.com/v1', serverSide: false },
      VENDORS.openai,
    ).join('\n')
    expect(lines).toContain('提示词缓存：prompt_cache_key（会话 id），网关需支持')
  })

  test('未知厂商：fail-closed，不炸', () => {
    const lines = capabilityLines({ provider: 'my-gw', modelName: 'x', serverSide: false }, undefined)
    expect(lines[1]).toContain('未知厂商')
  })
})
