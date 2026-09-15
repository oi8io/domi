/**
 * PRD-M1-007 AC-2 · 上下文占用的颜色阈值
 *
 * 颜色是**状态**，所以断言的是颜色状态而不是像素。
 *
 * 这里**故意不 import kernel 的 contextLevel**：apps/tui 不许依赖 kernel（INV-02），
 * 连测试也不行——第一版就是在这里栽的，depcruise 当场红了。
 * 阈值本身在 packages/kernel/test/metrics.spec.ts 里测；
 * 本文件只负责「等级 → 颜色」这一层映射。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, type MetricsSnapshot } from '@domi/client-core'
import { CONTEXT_COLOR, StatusBar } from '../src/components/StatusBar.tsx'
import { renderAt } from './render.tsx'

function metrics(percent: number, cost = '$0.0042', level: MetricsSnapshot['contextLevel'] = 'ok'): MetricsSnapshot {
  return {
    tokens: { input: 12_000, output: 800, cacheRead: 9_000 },
    cost,
    contextPercent: percent,
    contextLevel: level,
    unpricedModels: [],
  }
}

function status(m: MetricsSnapshot | null) {
  const s = createSessionStore({ model: 'claude-sonnet-4-5', provider: 'anthropic' })
  s.setMetrics(m)
  return s.$status.get()
}

describe('AC-2 · 颜色阈值', () => {
  test.each<[keyof typeof CONTEXT_COLOR, (typeof CONTEXT_COLOR)[keyof typeof CONTEXT_COLOR]]>([
    ['ok', 'gray'],
    ['warn', 'yellow'],
    ['danger', 'red'],
  ])('%s → %s', (level, color) => {
    expect(CONTEXT_COLOR[level]).toBe(color)
  })

  test('三个等级一个不少，加了新等级会在这里红', () => {
    expect(Object.keys(CONTEXT_COLOR).sort()).toEqual(['danger', 'ok', 'warn'])
  })
})

describe('AC-1 · 状态栏显示的内容', () => {
  test('模型、token（含 cache）、花费、工具次数、上下文占用都在', async () => {
    const h = renderAt(120, <StatusBar status={status(metrics(75, '$0.0042', 'warn'))} />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('anthropic/claude-sonnet-4-5')
    expect(frame).toContain('12.0k/800 tok')
    expect(frame).toContain('cache 9.0k')
    expect(frame).toContain('$0.0042')
    expect(frame).toContain('ctx 75%')
    h.unmount()
  })

  test('BUG-M3-003 · 本轮耗时', async () => {
    const h = renderAt(120, <StatusBar status={status({ ...metrics(10, '—'), turnMs: 83_400 })} />)
    await h.flush()
    expect(h.lastFrame()).toContain('本轮 1m23s')
    h.unmount()
  })

  test('AC-4 · 未知模型的花费显示 — 而不是 $0', async () => {
    const h = renderAt(120, <StatusBar status={status(metrics(10, '—'))} />)
    await h.flush()
    expect(h.lastFrame()).toContain('—')
    expect(h.lastFrame()).not.toContain('$0.0000')
    h.unmount()
  })

  test('还没有任何用量时不瞎编数字', async () => {
    const h = renderAt(120, <StatusBar status={status(null)} />)
    await h.flush()
    expect(h.lastFrame()).toContain('— tok')
    expect(h.lastFrame()).toContain('ctx 0%')
    h.unmount()
  })
})
