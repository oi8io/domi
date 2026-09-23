/**
 * 会话视图 —— PRD-M8-008 AC-1（Chat 流的各类条目）· AC-2（状态栏 pill）· AC-4（hover 操作、改名、删除、转任务）
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, DomiClient, type StatusSnapshot, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionTools, SessionView } from '../src/App.tsx'
import { ConfirmDialog } from '../src/ConfirmDialog.tsx'
import { StatusBar } from '../src/StatusBar.tsx'
import { Transcript } from '../src/Transcript.tsx'

const client = new DomiClient({
  clientName: 't',
  connect: (): WireSocket => {
    throw new Error('渲染测试不该发起连接')
  },
})

const items = [
  { seq: 1, kind: 'user' as const, text: '帮我修一下 dod 测试', ts: 1 },
  { seq: 2, kind: 'reason' as const, text: '先读测试文件', ts: 2, ms: 1500 },
  { seq: 3, kind: 'tool-call' as const, text: 'fs.read', summary: '{"path":"a.ts"}', ts: 3 },
  { seq: 4, kind: 'tool-result' as const, text: 'ok', ok: true, summary: '"内容"', ms: 120, ts: 4 },
  { seq: 5, kind: 'assistant' as const, text: '改好了', ts: 5 },
  { seq: 6, kind: 'error' as const, text: '模型超时', summary: '重试一次就好', ts: 6 },
]

const status: StatusSnapshot = {
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  busy: false,
  toolCalls: 3,
  lastUsage: null,
  metrics: {
    tokens: { input: 68_100, output: 1200, cacheRead: 56_000 },
    cost: '$0.21',
    contextPercent: 72,
    contextLevel: 'warn',
    unpricedModels: [],
    turnMs: 12_400,
    verify: 'unverified',
    mode: 'act',
    turns: 4,
    steps: 9,
    tokPerSec: 42,
    cacheHitPercent: 62,
  },
}

describe('PRD-M8-008 AC-1 · Chat 流按原型渲染', () => {
  const html = renderToStaticMarkup(<Transcript items={items} onBranch={() => undefined} onQuote={() => undefined} />)

  test('用户、思考（可折叠、带耗时）、工具卡（状态 pill + 耗时）、回答、错误各有各的样子', () => {
    expect(html).toContain('帮我修一下 dod 测试')
    expect(html).toContain('思考')
    expect(html).toContain('1.5s')
    expect(html).toContain('fs.read')
    expect(html).toContain('0.1s')
    expect(html).toContain('改好了')
    expect(html).toContain('模型超时')
    expect(html).toContain('重试一次就好')
  })

  test('思考默认折叠：summary 带「思考 · 摘要」，details 不带 open，全文仍在（PRD-M10-005 AC-1）', () => {
    // 折叠态：无 open 属性，summary 显示「思考 · 前 N 字…」；正文全文还在 body 里（details 语义，点击展开）
    expect(html).toContain('思考 · 先读测试文件')
    expect(html).not.toContain('<details open')
    expect(html).toContain('先读测试文件')
  })

  test('工具卡可展开看参数与结果', () => {
    expect(html).toContain('<details')
    expect(html).toContain('{&quot;path&quot;:&quot;a.ts&quot;}')
  })

  test('确认卡内嵌在流里，默认焦点在拒绝，允许 / 拒绝都在（PRD-M0-003 AC-1 的完整内容照旧）', () => {
    const ask = renderToStaticMarkup(
      <ConfirmDialog
        ask={{ askId: 'a1', capabilityId: 'fs.write', detail: 'fs.write · a.ts\n整段内容', grantable: true }}
        onAnswer={() => undefined}
      />,
    )
    expect(ask).toContain('fs.write')
    expect(ask).toContain('整段内容')
    expect(ask).toContain('拒绝')
    expect(ask).toContain('autofocus')
    // PRD-M8-016 AC-1：可授权时多一个「本会话始终允许」
    expect(ask).toContain('本会话始终允许')
  })

  test('不可授权的询问没有那个选项（PRD-M8-016 AC-3）', () => {
    const ask = renderToStaticMarkup(
      <ConfirmDialog
        ask={{ askId: 'a2', capabilityId: 'shell.exec', detail: 'rm -rf /' }}
        onAnswer={() => undefined}
      />,
    )
    expect(ask).not.toContain('本会话始终允许')
  })
})

describe('PRD-M8-008 AC-2 · 状态栏 pill：连接、turns / steps / tok/s、tokens 与 cache、上下文、花费、模式与验证', () => {
  const html = renderToStaticMarkup(<StatusBar status={status} connection="open" />)

  test('数都来自 metrics，界面一个都不算', () => {
    expect(html).toContain('已连接')
    expect(html).toContain('anthropic/claude-sonnet-4-5')
    expect(html).toContain('4 turns')
    expect(html).toContain('9 steps')
    expect(html).toContain('42 tok/s')
    expect(html).toContain('62%')
    expect(html).toContain('$0.21')
    expect(html).toContain('72%')
    expect(html).toContain('已改未验')
    // M12-004：plan/act 已取消，不再有模式 pill
  })

  test('上下文到 70% 以上是警告色', () => {
    expect(html).toContain('border-warn')
  })

  test('主题切换按钮在状态栏上（PRD-M8-001 AC-2）', () => {
    expect(html).toContain('切换主题')
  })
})

describe('PRD-M8-008 AC-4 · 每条消息 hover 出「分支」，用户输入 hover 出「引用这一轮」；标题可改、可删、可转任务', () => {
  const store = createSessionStore()
  store.applyEvents([
    { seq: 1, sessionId: 's', parentSeq: null, ts: 1, schemaVersion: 11, ev: { t: 'user.input', text: '你好' } },
  ])
  const view = renderToStaticMarkup(
    <SessionView
      client={client}
      sessionId="s-1"
      store={store}
      title="重构 Web UI"
      kind="task"
      project={{ id: 'p1', name: 'domi' }}
      tab="chat"
      connection="open"
      onBranched={() => undefined}
      onRefsChange={() => undefined}
      onToTask={() => undefined}
      onDeleted={() => undefined}
    />,
  )

  test('消息上的两个 hover 操作', () => {
    const html = renderToStaticMarkup(<Transcript items={items} onBranch={() => undefined} onQuote={() => undefined} />)
    expect(html).toContain('data-action="branch"')
    expect(html).toContain('从第 1 条分支出一个新会话')
    expect(html).toContain('引用这一轮')
  })

  test('会话头部：面包屑「项目 › 标题」、转为任务、删除', () => {
    expect(view).toContain('domi')
    expect(view).toContain('重构 Web UI')
    expect(view).toContain('转为任务')
    expect(view).toContain('data-action="delete"')
  })

  test('删除是两步：第一下只「武装」，不直接删', () => {
    const tools = renderToStaticMarkup(
      <SessionTools client={client} sessionId="s-1" busy={false} onNotice={() => undefined} />,
    )
    expect(tools).toContain('删除会话')
    expect(tools).not.toContain('确认删除')
  })

  test('Chat / Trajectory 两个 tab 都在地址里', () => {
    expect(view).toContain('href="#/s/s-1"')
    expect(view).toContain('href="#/s/s-1/trajectory"')
  })
})
