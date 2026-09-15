/**
 * PRD-M0-005 AC-1 · 流式输出、工具调用摘要、工具结果
 * PRD-M0-002 AC-1 · 提交后 ≤100ms 出等待指示
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore } from '@domi/client-core'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { App } from '../src/App.tsx'
import { renderAt } from './render.tsx'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts: 0, schemaVersion: 2, ev }
}

function storeWith(events: DomiEvent[]) {
  seq = 0
  const s = createSessionStore({ model: 'stub-1', provider: 'stub' })
  s.applyEvents(events.map(env))
  return s
}

describe('PRD-M0-005 AC-1', () => {
  test('流式输出合并成一段，工具调用带参数摘要，工具结果可见', async () => {
    const store = storeWith([
      { t: 'user.input', text: '修一下 sum.js' },
      { t: 'model.delta', text: '我先' },
      { t: 'model.delta', text: '读文件。' },
      { t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } },
      { t: 'tool.result', id: 'c1', ok: true, payload: { lines: 1 }, ms: 4 },
    ])
    const h = renderAt(80, <App store={store} />)
    await h.flush()
    const frame = h.lastFrame()

    expect(frame).toContain('› 修一下 sum.js')
    expect(frame).toContain('我先读文件。')
    expect(frame).toContain('fs.read')
    expect(frame).toContain('{"path":"sum.js"}')
    expect(frame).toContain('stub/stub-1')
    h.unmount()
  })

  test('超长参数按 80 字符截断（规则在 client-core，渲染层不重复截）', async () => {
    const store = storeWith([{ t: 'tool.call', id: 'c1', name: 'fs.write', args: { content: 'x'.repeat(300) } }])
    const h = renderAt(200, <App store={store} />)
    await h.flush()
    expect(h.lastFrame()).toContain('…')
    expect(h.lastFrame()).not.toContain('x'.repeat(100))
    h.unmount()
  })
})

describe('PRD-M0-002 AC-1 · 等待指示', () => {
  test('busy 置位后 100ms 内出现 spinner', async () => {
    const store = storeWith([{ t: 'user.input', text: 'hi' }])
    const h = renderAt(80, <App store={store} />)
    await h.flush()
    store.setBusy(true)
    // 轮询而不是 sleep：ink 有 32ms 节流，固定 sleep 要么假红要么测不出上限
    const elapsed = await h.waitFor((f) => f.includes('思考中'), 500)
    expect(elapsed).toBeLessThan(100)
    h.unmount()
  })

  test('有待确认时不显示 spinner —— 那会让人以为还在跑，其实在等他', async () => {
    const store = storeWith([])
    store.setBusy(true)
    store.setAsk({ capabilityId: 'fs.write', detail: 'sum.js: 34 字节' })
    const h = renderAt(80, <App store={store} />)
    await h.flush()
    expect(h.lastFrame()).not.toContain('思考中')
    expect(h.lastFrame()).toContain('需要授权：fs.write')
    h.unmount()
  })
})

describe('PRD-M0-003 AC-1 · 确认框显示完整待执行内容', () => {
  test('命令行原文出现在确认框里，而不是只有能力名', async () => {
    const store = storeWith([])
    store.setAsk({ capabilityId: 'shell.exec', detail: '$ rm -rf build && pnpm build' })
    const h = renderAt(80, <App store={store} />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('rm -rf build && pnpm build')
    expect(frame).toContain('y 允许 / n 拒绝（默认拒绝）')
    h.unmount()
  })
})

describe('TASK-M3-016 · 表单型询问在终端里', () => {
  test('单个布尔字段：y 直接回答；多字段：提示去 Web 端填', async () => {
    const { tuiFormAnswer } = await import('../src/main.tsx')
    const { formNeedsWeb } = await import('../src/components/ConfirmDialog.tsx')
    const one = { type: 'object', properties: { confirm: { type: 'boolean' } } }
    const many = { type: 'object', properties: { env: { type: 'string' }, n: { type: 'integer' } } }
    expect(tuiFormAnswer(one)).toEqual({ confirm: true })
    expect(tuiFormAnswer({ type: 'object', properties: {} })).toEqual({})
    expect(tuiFormAnswer(many)).toBeNull()
    expect(formNeedsWeb(one)).toBe(false)
    expect(formNeedsWeb(many)).toBe(true)
  })
})
