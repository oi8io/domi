/**
 * PRD-M1-003 · 分层提示词（AC-1~4）
 * PRD-M1-004 AC-3 · cache 前缀 byte 级稳定
 */
import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_LAYERS,
  CacheBoundaryError,
  DuplicateLayerError,
  PRIORITY,
  type PromptCtx,
  type PromptLayer,
  assemble,
  formatDump,
  layersFromConfig,
  mergeLayers,
} from '../src/index.ts'

const CTX: PromptCtx = { cwd: '/tmp/work', model: 'stub-1' }

function layer(id: string, priority: number, cacheable = true, text = id): PromptLayer {
  return { id, role: 'system', priority, cacheable, render: () => text }
}

describe('AC-1 · 顺序只由 priority 决定', () => {
  test('乱序输入按 priority 输出，与注册顺序无关', () => {
    const a = assemble([layer('c', 300), layer('a', 100), layer('b', 200)], CTX)
    expect(a.layers.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  test('priority 相同时按 id 排，保证结果确定（否则 cache 前缀会随机漂移）', () => {
    const x = assemble([layer('zeta', 100), layer('alpha', 100)], CTX)
    const y = assemble([layer('alpha', 100), layer('zeta', 100)], CTX)
    expect(x.layers.map((l) => l.id)).toEqual(['alpha', 'zeta'])
    expect(x.prefixText).toBe(y.prefixText)
  })

  test('id 重复直接抛错 —— id 是覆盖的依据，重复会让「覆盖哪一层」变成运气', () => {
    expect(() => assemble([layer('dup', 100), layer('dup', 200)], CTX)).toThrow(DuplicateLayerError)
  })
})

describe('AC-2 · cacheable 层不得排在非 cacheable 之后', () => {
  test('违反时**构建期**抛错，并指出是哪两层', () => {
    const layers = [layer('static-a', 100), layer('volatile', 200, false), layer('static-b', 300)]
    expect(() => assemble(layers, CTX)).toThrow(CacheBoundaryError)
    try {
      assemble(layers, CTX)
    } catch (e) {
      const err = e as CacheBoundaryError
      expect(err.cacheableLayer).toBe('static-b')
      expect(err.afterVolatileLayer).toBe('volatile')
      // 错误信息要告诉人怎么修，不只是说错了
      expect(err.message).toContain('修法')
    }
  })

  test('全部可缓存 → 通过', () => {
    expect(() => assemble([layer('a', 100), layer('b', 200)], CTX)).not.toThrow()
  })

  test('会变的层全部排在最后 → 通过', () => {
    expect(() =>
      assemble([layer('a', 100), layer('v1', 800, false), layer('v2', 900, false)], CTX),
    ).not.toThrow()
  })

  test('内置层本身满足边界（否则 domi 自己就打不中 cache）', () => {
    expect(() => assemble(BUILTIN_LAYERS, CTX)).not.toThrow()
  })
})

describe('PRD-M1-004 AC-3 · 前缀 byte 级稳定', () => {
  test('动态内容变化时，稳定前缀一个字节都不变', () => {
    const dyn: PromptLayer = {
      id: 'dyn',
      role: 'user',
      priority: 900,
      cacheable: false,
      render: (c) => `现在是 ${String(c.dynamic?.now)}，剩余 ${String(c.dynamic?.left)} tok`,
    }
    const layers = [...BUILTIN_LAYERS, dyn]
    const a = assemble(layers, { ...CTX, dynamic: { now: 1, left: 100 } })
    const b = assemble(layers, { ...CTX, dynamic: { now: 2, left: 50 } })

    expect(a.prefixText).toBe(b.prefixText)
    expect(Buffer.from(a.prefixText).equals(Buffer.from(b.prefixText))).toBe(true)
    // 但完整消息确实变了 —— 否则这个测试等于什么都没测
    expect(JSON.stringify(a.messages)).not.toBe(JSON.stringify(b.messages))
  })

  test('动态内容只出现在最后一条 user message', () => {
    const a = assemble(BUILTIN_LAYERS, CTX)
    const system = a.messages.find((m) => m.role === 'system')
    expect(system?.content).not.toContain('/tmp/work')
    expect(a.messages.at(-1)?.role).toBe('user')
    expect((a.messages.at(-1) as { content: string }).content).toContain('/tmp/work')
  })

  test('prefixLayerCount 指到前缀边界，M2 选压缩点要用', () => {
    const a = assemble(BUILTIN_LAYERS, CTX)
    expect(a.prefixLayerCount).toBe(BUILTIN_LAYERS.filter((l) => l.cacheable).length)
  })
})

describe('AC-3 · 配置注入层', () => {
  test('配置里的层出现在结果中，不改代码即生效', () => {
    const custom = layersFromConfig([{ id: 'my.style', text: '回答要短。' }])
    const a = assemble(mergeLayers(BUILTIN_LAYERS, custom), CTX)
    expect(a.layers.map((l) => l.id)).toContain('my.style')
    expect(a.prefixText).toContain('回答要短。')
  })

  test('同 id 覆盖内置层而不是并存', () => {
    const custom = layersFromConfig([{ id: 'builtin.conventions', text: '我的约定。' }])
    const merged = mergeLayers(BUILTIN_LAYERS, custom)
    expect(merged.filter((l) => l.id === 'builtin.conventions')).toHaveLength(1)
    expect(assemble(merged, CTX).prefixText).toContain('我的约定。')
  })

  test('用户层默认落在稳定前缀内（priority 留了间隔，插层不用改内置编号）', () => {
    const custom = layersFromConfig([{ id: 'x', text: 'x' }])
    expect(custom[0]?.priority).toBe(PRIORITY.userStatic)
    expect(custom[0]?.priority).toBeLessThan(PRIORITY.workspace)
  })

  test('用户层写了会变的内容又没标 false → 构建期当场告诉他', () => {
    const custom = layersFromConfig([{ id: 'bad', text: '追加', priority: 950 }])
    expect(() => assemble(mergeLayers(BUILTIN_LAYERS, custom), CTX)).toThrow(CacheBoundaryError)
  })
})

describe('AC-4 · dump 输出', () => {
  test('含各层 id、cacheable 标记、token 数与前缀边界', () => {
    const out = formatDump(assemble(BUILTIN_LAYERS, CTX))
    expect(out).toContain('builtin.identity')
    expect(out).toContain('cacheable')
    expect(out).toContain('tok')
    expect(out).toContain('稳定前缀到此为止')
  })

  test('全部可缓存时也说清楚', () => {
    const out = formatDump(assemble([layer('a', 100), layer('b', 200)], CTX))
    expect(out).toContain('全部 2 层都可缓存')
  })
})
