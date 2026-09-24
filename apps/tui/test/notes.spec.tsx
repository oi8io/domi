/**
 * PRD-M13-001 / PRD-M13-002 · TUI：运行中补充与 Esc 中断（SPEC-M13-001 取舍-6 · SPEC-M13-002 取舍-5）
 * 按键在无 TTY 环境里验不了（docs/adr/001），所以判定都是纯函数；渲染用假 stdout。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, mergeDraft } from '@domi/client-core'
import { tr } from '@domi/i18n'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { App } from '../src/App.tsx'
import { COMMANDS, parseSlash } from '../src/commands.ts'
import { isInterruptKey } from '../src/keys.ts'
import { notesLine } from '../src/notes.ts'
import { renderAt } from './render.tsx'

describe('PRD-M13-002 AC-6 · Esc 中断的判定', () => {
  const base = { busy: true, overlay: false, asking: false }
  test('跑着、没有弹层、没有待答的询问、按 Esc → 中断', () => {
    expect(isInterruptKey({ escape: true }, base)).toBe(true)
  })
  test('闲着 / 有弹层 / 有询问 / 不是 Esc → 不中断（Esc 归它们）', () => {
    expect(isInterruptKey({ escape: true }, { ...base, busy: false })).toBe(false)
    expect(isInterruptKey({ escape: true }, { ...base, overlay: true })).toBe(false)
    expect(isInterruptKey({ escape: true }, { ...base, asking: true })).toBe(false)
    expect(isInterruptKey({}, base)).toBe(false)
    expect(isInterruptKey({ escape: true, ctrl: true }, base)).toBe(false)
  })
})

describe('PRD-M13-001 AC-6 · /unqueue 撤回最后一条', () => {
  test('解析与命令表', () => {
    expect(parseSlash('/unqueue', 0)).toEqual({ kind: 'unqueue' })
    expect(COMMANDS().some((c) => c.name === '/unqueue')).toBe(true)
  })
})

describe('PRD-M13-001 AC-5 · 排队行', () => {
  test('条数 + 最新一条摘要；空的不显示', () => {
    expect(notesLine([])).toBeNull()
    const line = notesLine([
      { id: 'n-1', text: '顺便跑测试' },
      { id: 'n-2', text: '文件在 src/ 下' },
    ])
    expect(line).toContain(tr('tui.notes.queued', { n: 2 }))
    expect(line).toContain('文件在 src/ 下')
  })

  test('草稿恢复与 Web 同一口径', () => {
    expect(mergeDraft(['没送到'], '在打')).toBe('没送到\n\n在打')
  })
})

describe('PRD-M13-001 AC-5 · 对话里的补充', () => {
  test('补充行带「补充」标注', async () => {
    let seq = 0
    const env = (ev: DomiEvent): EventEnvelope => ({
      seq: ++seq,
      sessionId: 's',
      parentSeq: null,
      ts: 0,
      schemaVersion: 15,
      ev,
    })
    const store = createSessionStore({ model: 'stub-1', provider: 'stub' })
    store.applyEvents([
      env({ t: 'user.input', text: '改一下' }),
      env({ t: 'user.note', id: 'n-1', text: '顺便跑测试' }),
    ])
    const h = renderAt(80, <App store={store} />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain(`${tr('web.transcript.note')} 顺便跑测试`)
    h.unmount()
  })
})
