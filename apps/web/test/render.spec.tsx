/**
 * PRD-M3-003（骨架）· Web 端只渲染
 *
 * 服务端渲染成字符串断言，不起浏览器——这一轮不做 Playwright（docs/prd/M3.md §3）。
 * parity 的逐项 e2e 在 docs/parity-checklist.md 里列着，下一轮补。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, DomiClient, type TranscriptItem, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { App, SessionTools, SessionView } from '../src/App.tsx'
import { ConfirmDialog } from '../src/ConfirmDialog.tsx'
import { PendingRefs } from '../src/PendingRefs.tsx'
import { StatusBar } from '../src/StatusBar.tsx'
import { groupRows, Transcript, turnRanges } from '../src/Transcript.tsx'

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

describe('工具确认（parity 第 3 项）', () => {
  test('显示完整待执行内容；默认焦点在拒绝上', () => {
    const detail = JSON.stringify({ path: 'a.txt', content: 'x'.repeat(200) }, null, 2)
    const html = renderToStaticMarkup(
      <ConfirmDialog ask={{ askId: 'k', capabilityId: 'fs.write', detail }} onAnswer={() => undefined} />,
    )
    expect(html).toContain('fs.write')
    expect(html).toContain('x'.repeat(200)) // 不截断
    // autoFocus 在 SSR 里不出属性，所以断言按钮顺序：拒绝排在前面、且是第一个按钮
    expect(html.indexOf('拒绝')).toBeLessThan(html.indexOf('允许'))
  })

  test('store 里有询问时，会话视图里出现确认框', () => {
    const store = createSessionStore()
    store.setAsk({ askId: 'k', capabilityId: 'shell.exec', detail: 'bun test' })
    const client = new DomiClient({ clientName: 't', connect: neverConnects })
    const html = renderToStaticMarkup(<SessionView client={client} sessionId="s" store={store} />)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('bun test')
  })
})

describe('状态栏（parity 第 9 项）', () => {
  test('与 TUI 同样的几段；上下文 ≥70% 标 warn', () => {
    const store = createSessionStore({ provider: 'anthropic', model: 'glm' })
    store.setMetrics({
      tokens: { input: 1200, output: 30, cacheRead: 0 },
      cost: '—',
      contextPercent: 72,
      contextLevel: 'warn',
      unpricedModels: ['glm'],
    })
    const html = renderToStaticMarkup(<StatusBar status={store.$status.get()} />)
    expect(html).toContain('anthropic/glm')
    expect(html).toContain('1.2k/30 tok')
    expect(html).toContain('0 次工具')
    expect(html).toContain('class="ctx ctx-warn"')
    expect(html).toContain('ctx 72%')
  })

  test('BUG-M3-003 · 本轮耗时，与 TUI 同一个格式', () => {
    const store = createSessionStore({ provider: 'anthropic', model: 'glm' })
    store.setMetrics({
      tokens: { input: 1, output: 1, cacheRead: 0 },
      cost: '—',
      contextPercent: 1,
      contextLevel: 'ok',
      unpricedModels: [],
      turnMs: 2_340,
    })
    expect(renderToStaticMarkup(<StatusBar status={store.$status.get()} />)).toContain('本轮 2.3s')
  })

  test('还没有指标时不瞎编数字', () => {
    const html = renderToStaticMarkup(<StatusBar status={createSessionStore().$status.get()} />)
    expect(html).toContain('— tok')
    expect(html).not.toContain('$0')
  })
})

describe('会话级操作（parity 第 8、10 项）', () => {
  test('有切换模型与删除入口；忙的时候都不可用', () => {
    const client = new DomiClient({ clientName: 't', connect: neverConnects })
    const idle = renderToStaticMarkup(
      <SessionTools client={client} sessionId="s" busy={false} onNotice={() => undefined} />,
    )
    expect(idle).toContain('切换模型')
    expect(idle).toContain('删除会话')
    const busy = renderToStaticMarkup(
      <SessionTools client={client} sessionId="s" busy={true} onNotice={() => undefined} />,
    )
    expect(busy.match(/disabled=""/g)?.length).toBe(3)
  })
})

describe('表单型询问（TASK-M3-016）', () => {
  test('按 schema 画出输入项：文本、数字、布尔、枚举；按钮是「拒绝 / 提交」', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        ask={{
          askId: 'f',
          capabilityId: 'mcp.x.input',
          detail: '部署参数',
          form: {
            message: '部署参数',
            schema: {
              type: 'object',
              properties: {
                env: { type: 'string', title: '环境', enum: ['staging', 'prod'] },
                replicas: { type: 'integer', title: '副本数' },
                note: { type: 'string', description: '备注' },
                confirm: { type: 'boolean', title: '确认' },
              },
              required: ['env'],
            },
          },
        }}
        onAnswer={() => undefined}
      />,
    )
    expect(html).toContain('部署参数')
    expect(html).toMatch(/<select[^>]*name="env"/)
    expect(html).toContain('<option value="prod">prod</option>')
    expect(html).toMatch(/type="number"[^>]*name="replicas"/)
    expect(html).toContain('name="note"')
    expect(html).toMatch(/type="checkbox"[^>]*name="confirm"/)
    expect(html).toContain('提交')
    expect(html.indexOf('拒绝')).toBeLessThan(html.indexOf('提交'))
  })

  test('formValues：按 schema 把表单值转成正确的类型', async () => {
    const { formValues } = await import('../src/ConfirmDialog.tsx')
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'integer' },
        x: { type: 'number' },
        ok: { type: 'boolean' },
        s: { type: 'string' },
        empty: { type: 'string' },
      },
    }
    expect(formValues(schema, { n: '3', x: '1.5', ok: 'on', s: 'hi', empty: '' })).toEqual({
      n: 3,
      x: 1.5,
      ok: true,
      s: 'hi',
    })
    expect(formValues(schema, {})).toEqual({ ok: false })
  })
})

describe('跨会话引用（PRD-M3-005）', () => {
  test('用户那一行有「引用这一轮」，带着这一轮的起止 seq', () => {
    const items: TranscriptItem[] = [
      { seq: 1, kind: 'user', text: '第一问' },
      { seq: 3, kind: 'assistant', text: '答' },
      { seq: 5, kind: 'user', text: '第二问' },
      { seq: 7, kind: 'assistant', text: '答' },
    ]
    expect(turnRanges(items)).toEqual([
      { seq: 1, fromSeq: 1, toSeq: 4 },
      { seq: 5, fromSeq: 5, toSeq: Number.MAX_SAFE_INTEGER },
    ])
    const html = renderToStaticMarkup(<Transcript items={items} onQuote={() => undefined} />)
    expect(html.match(/class="quote"/g)?.length).toBe(2)
    expect(renderToStaticMarkup(<Transcript items={items} />)).not.toContain('class="quote"')
  })

  test('待发送的引用显示在输入框上方，可以去掉', () => {
    const html = renderToStaticMarkup(
      <PendingRefs refs={[{ sessionId: 'A', fromSeq: 1, toSeq: 4, label: '第一问' }]} onRemove={() => undefined} />,
    )
    expect(html).toContain('引用 A')
    expect(html).toContain('第一问')
    expect(html).toContain('去掉')
    expect(renderToStaticMarkup(<PendingRefs refs={[]} onRemove={() => undefined} />)).toBe('')
  })
})

describe('会话分支（parity 第 7 项）', () => {
  test('每条事件旁有「从这里分支」，点下去带着这条的 seq', () => {
    const items: TranscriptItem[] = [
      { seq: 1, kind: 'user', text: '问' },
      { seq: 3, kind: 'assistant', text: '答' },
    ]
    const html = renderToStaticMarkup(<Transcript items={items} onBranch={() => undefined} />)
    expect(html.match(/class="branch"/g)?.length).toBe(2)
    expect(html).toContain('title="从第 3 条分支出一个新会话"')
    // 不给回调就不画按钮（比如只读视图）
    expect(renderToStaticMarkup(<Transcript items={items} />)).not.toContain('class="branch"')
  })
})
