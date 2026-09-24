/**
 * PRD-M13-001 / PRD-M13-002 · Web：运行中补充与停止（SPEC-M13-001 取舍-6 · SPEC-M13-002 取舍-5）
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, DomiClient, type WireSocket } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionView } from '../src/App.tsx'
import { Composer, mergeDraft } from '../src/session/Composer.tsx'
import { Transcript, turnRanges } from '../src/Transcript.tsx'

const client = new DomiClient({
  clientName: 't',
  connect: (): WireSocket => {
    throw new Error('渲染测试不该发起连接')
  },
})
const noop = async () => undefined

const view = (store: ReturnType<typeof createSessionStore>): string =>
  renderToStaticMarkup(
    <SessionView
      client={client}
      sessionId="s-1"
      store={store}
      title="会话"
      tab="chat"
      connection="open"
      onBranched={() => undefined}
      onRefsChange={() => undefined}
      onDeleted={() => undefined}
    />,
  )
const around = (html: string, marker: string): string => {
  const at = html.indexOf(marker)
  return at < 0 ? '' : html.slice(Math.max(0, at - 300), at + 60)
}

describe('PRD-M13-001 AC-9 · 运行中输入框不禁用，回车 = 补充', () => {
  test('Composer running：忙也能发，按钮写「补充」；文件 / 技能按钮禁用（首版只收文本）', () => {
    const html = renderToStaticMarkup(
      <Composer busy running placeholder="x" tools={{ client, sessionId: 's-1' }} onSubmit={noop} />,
    )
    expect(around(html, 'data-action="send"')).not.toContain('disabled=""')
    expect(around(html, 'data-action="send"')).toContain(tr('web.composer.addNote'))
    expect(around(html, 'data-action="files"')).toContain('disabled=""')
    expect(around(html, 'data-action="skills"')).toContain('disabled=""')
  })

  test('会话页：忙时发送键可用；闲时与原来一致（回归）', () => {
    const busy = createSessionStore()
    busy.setBusy(true)
    expect(around(view(busy), 'data-action="send"')).not.toContain('disabled=""')
    const idle = view(createSessionStore())
    expect(around(idle, 'data-action="send"')).toContain(tr('web.composer.send'))
    expect(idle).not.toContain(tr('web.composer.addNote'))
  })
})

describe('PRD-M13-001 AC-5 / AC-6 · 排队条', () => {
  test('有排队的补充 → 显示条数与每条的撤回；没有就不显示', () => {
    const store = createSessionStore()
    store.setBusy(true)
    store.setNotes([
      { id: 'n-1', text: '顺便跑测试', from: 'domi-web' },
      { id: 'n-2', text: '文件在 src/ 下', from: 'domi-tui' },
    ])
    const html = view(store)
    expect(html).toContain('data-view="notes"')
    expect(html).toContain(tr('web.notes.queued', { n: 2 }))
    expect(html).toContain('顺便跑测试')
    expect(html.match(/data-action="withdraw-note"/g)).toHaveLength(2)
    const empty = createSessionStore()
    empty.setBusy(true)
    expect(view(empty)).not.toContain('data-view="notes"')
  })
})

describe('PRD-M13-001 AC-5 · 补充气泡', () => {
  const items = [
    { seq: 1, kind: 'user' as const, text: '改一下', ts: 1 },
    { seq: 2, kind: 'assistant' as const, text: '好', ts: 2 },
    { seq: 3, kind: 'user' as const, text: '顺便跑测试', note: true, ts: 3 },
    { seq: 4, kind: 'user' as const, text: '下一轮', ts: 4 },
  ]

  test('补充带「补充」标签，没有「引用本轮」', () => {
    const html = renderToStaticMarkup(<Transcript items={items} onBranch={() => undefined} onQuote={() => undefined} />)
    const row = html.slice(html.indexOf('data-seq="3"'), html.indexOf('data-seq="4"'))
    expect(row).toContain(tr('web.transcript.note'))
    expect(row).not.toContain('data-action="quote"')
  })

  test('轮的范围不被补充切开', () => {
    expect(turnRanges(items)).toEqual([
      { seq: 1, fromSeq: 1, toSeq: 3 },
      { seq: 4, fromSeq: 4, toSeq: Number.MAX_SAFE_INTEGER },
    ])
  })
})

describe('PRD-M13-001 AC-7 · 退回的补充放回草稿', () => {
  test('拼在正在打的字前面，不覆盖', () => {
    expect(mergeDraft(['没送到的'], '正在打的')).toBe('没送到的\n\n正在打的')
    expect(mergeDraft(['甲', '乙'], '')).toBe('甲\n\n乙')
    expect(mergeDraft([], '原样')).toBe('原样')
  })
})

describe('PRD-M13-002 AC-6 · 停止按钮', () => {
  test('忙时出现「停止」；闲时没有', () => {
    const busy = createSessionStore()
    busy.setBusy(true)
    expect(view(busy)).toContain('data-action="interrupt"')
    expect(view(createSessionStore())).not.toContain('data-action="interrupt"')
  })
})
