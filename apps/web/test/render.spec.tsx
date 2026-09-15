/**
 * PRD-M3-003（骨架）· Web 端只渲染
 *
 * 服务端渲染成字符串断言，不起浏览器——这一轮不做 Playwright（docs/prd/M3.md §3）。
 * parity 的逐项 e2e 在 docs/parity-checklist.md 里列着，下一轮补。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, DomiClient, type TranscriptItem, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { App, SessionView } from '../src/App.tsx'
import { groupRows, Transcript } from '../src/Transcript.tsx'

const neverConnects = (): WireSocket => {
  throw new Error('渲染测试不该发起连接')
}

describe('轨迹：工具调用与结果配对', () => {
  const items: TranscriptItem[] = [
    { seq: 1, kind: 'user', text: '跑一下测试' },
    { seq: 2, kind: 'tool-call', text: 'shell.exec', summary: '{"cmd":"bun test"}' },
    { seq: 3, kind: 'tool-result', text: 'ok', ok: true, summary: '"3 pass"' },
    { seq: 4, kind: 'tool-call', text: 'fs.write', summary: '{"path":"a.ts"}' },
  ]

  test('相邻的 call / result 合成一组；还没返回的标成运行中', () => {
    const rows = groupRows(items)
    expect(rows.map((r) => r.kind)).toEqual(['item', 'tool', 'tool'])
    const html = renderToStaticMarkup(<Transcript items={items} />)
    expect(html).toContain('shell.exec')
    expect(html).toContain('{&quot;cmd&quot;:&quot;bun test&quot;}')
    expect(html).toContain('成功')
    expect(html).toContain('运行中')
    // 折叠用原生 details，不需要任何 JS 状态
    expect(html.match(/<details>/g)?.length).toBe(2)
  })

  test('孤立的 tool-result 不会被吞掉', () => {
    const rows = groupRows([{ seq: 9, kind: 'tool-result', text: 'failed', ok: false }])
    expect(rows).toEqual([{ kind: 'item', item: { seq: 9, kind: 'tool-result', text: 'failed', ok: false } }])
  })
})

describe('状态来自 client-core，页面不自己算', () => {
  test('store 里的事件原样出现在会话视图里', () => {
    const store = createSessionStore()
    store.applyEvents([
      { seq: 1, sessionId: 's', parentSeq: null, ts: 1, schemaVersion: 5, ev: { t: 'user.input', text: '你好' } },
      { seq: 2, sessionId: 's', parentSeq: 1, ts: 2, schemaVersion: 5, ev: { t: 'model.delta', text: '在的' } },
    ])
    const client = new DomiClient({ clientName: 't', connect: neverConnects })
    const html = renderToStaticMarkup(<SessionView client={client} sessionId="s" store={store} />)
    expect(html).toContain('你好')
    expect(html).toContain('在的')
    expect(html).toContain('data-seq="2"')
  })

  test('忙的时候发送按钮不可点（PRD-M3-004 AC-3 的前端那一半）', () => {
    const store = createSessionStore()
    store.setBusy(true)
    const client = new DomiClient({ clientName: 't', connect: neverConnects })
    const html = renderToStaticMarkup(<SessionView client={client} sessionId="s" store={store} />)
    expect(html).toMatch(/<button type="submit" disabled="">/)
  })

  test('连接状态与握手失败原因直接显示', () => {
    const client = new DomiClient({ clientName: 't', connect: neverConnects })
    client.$state.set('incompatible')
    client.$lastError.set('协议版本不匹配：客户端 v2，服务端 v1。')
    const html = renderToStaticMarkup(<App client={client} daemonUrl="ws://127.0.0.1:7437" />)
    expect(html).toContain('协议版本不兼容')
    expect(html).toContain('客户端 v2，服务端 v1')
  })
})
