/**
 * Composer —— PRD-M8-010 AC-1（Enter 发送 / chip / 忙时不可点）· AC-2（@ 文件）· AC-3（附件）·
 * AC-4（/ 技能）· AC-6（模型下拉与确认模式；AC-5 的模式按钮随计划模式取消，v1.14 划掉）
 *
 * SSR 渲染 + 纯函数断言；`@` / `/` 的触发判断是 `triggerAt`，这里逐例覆盖。
 */
import { describe, expect, test } from 'bun:test'
import { DomiClient, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { Composer, ModelSwitch, PendingRefs, PermissionsModeSwitch, triggerAt } from '../src/session/Composer.tsx'

const client = new DomiClient({
  clientName: 't',
  connect: (): WireSocket => {
    throw new Error('渲染测试不该发起连接')
  },
})
const noop = async () => undefined

describe('PRD-M8-010 AC-1 · Enter 发送、忙时不可点、引用以 chip 显示', () => {
  const sendButton = (html: string): string => {
    const at = html.indexOf('data-action="send"')
    return html.slice(Math.max(0, at - 300), at + 40)
  }

  test('忙的时候发送按钮不可点（M3-004 AC-3 不变）', () => {
    const busy = renderToStaticMarkup(
      <Composer busy placeholder="说点什么…" tools={{ client, sessionId: 's-1' }} onSubmit={noop} />,
    )
    expect(sendButton(busy)).toContain('disabled=""')
    const idle = renderToStaticMarkup(
      <Composer busy={false} placeholder="说点什么…" tools={{ client, sessionId: 's-1' }} onSubmit={noop} />,
    )
    expect(sendButton(idle)).not.toContain('disabled=""')
  })

  test('占位文字里写清楚 Enter 发送、Shift+Enter 换行', () => {
    const html = renderToStaticMarkup(
      <Composer busy={false} placeholder="说点什么…  (Enter 发送，Shift+Enter 换行)" onSubmit={noop} />,
    )
    expect(html).toContain('Enter 发送，Shift+Enter 换行')
  })

  test('待发送的引用是 chip，可以去掉', () => {
    const refs = [{ sessionId: 'A', fromSeq: 1, toSeq: 4, label: '第一问' }]
    const html = renderToStaticMarkup(
      <Composer busy={false} placeholder="x" refs={refs} onRemoveRef={() => undefined} onSubmit={noop} />,
    )
    expect(html).toContain('引用 A')
    expect(html).toContain('第一问')
    expect(html).toContain('去掉')
    expect(renderToStaticMarkup(<PendingRefs refs={[]} onRemove={() => undefined} />)).toBe('')
  })
})

describe('PRD-M8-010 AC-2 / AC-4 · `@` 引用文件、`/` 指定技能', () => {
  test('行首或空格之后的 @ / 才触发，路径里的 / 不触发', () => {
    expect(triggerAt('@a', 2)).toMatchObject({ kind: 'files', query: 'a', at: 0 })
    expect(triggerAt('看看 @src', 7)).toMatchObject({ kind: 'files', query: 'src' })
    expect(triggerAt('/code', 5)).toMatchObject({ kind: 'skills', query: 'code' })
    expect(triggerAt('读 src/app.ts', 12)).toBeNull()
    expect(triggerAt('a@b.com', 7)).toBeNull()
    expect(triggerAt('', 0)).toBeNull()
  })

  test('光标在中间时看的是光标前面那一段', () => {
    expect(triggerAt('@ap 后面还有字', 3)).toMatchObject({ kind: 'files', query: 'ap' })
    expect(triggerAt('@ap 后面还有字', 8)).toBeNull()
  })

  test('有会话时两个按钮都能点；没有会话（新建任务）时是灰的', () => {
    const live = renderToStaticMarkup(
      <Composer busy={false} placeholder="x" tools={{ client, sessionId: 's-1' }} onSubmit={noop} />,
    )
    expect(live).toContain('data-action="files"')
    expect(live).toContain('data-action="skills"')
    expect(live).not.toContain('disabled=""')

    const offline = renderToStaticMarkup(<Composer busy={false} placeholder="x" onSubmit={noop} />)
    expect(offline).toContain('开始之后可以引用文件、上传附件')
    expect(offline).toContain('disabled=""')
  })

  test('首页只给技能（附件挂在会话上，会话还没建）', () => {
    const html = renderToStaticMarkup(
      <Composer
        busy={false}
        placeholder="x"
        tools={{ client, hint: '附件与文件引用在对话开始之后可用' }}
        onSubmit={noop}
      />,
    )
    expect(html).toContain('这一轮指定一个技能')
    expect(html).toContain('附件与文件引用在对话开始之后可用')
  })
})

describe('PRD-M8-010 AC-3 · 附件：可上传、可粘贴、可拖入', () => {
  test('输入框里有隐藏的文件选择器，工具栏文件按钮的提示里写了粘贴与拖入', () => {
    const html = renderToStaticMarkup(
      <Composer busy={false} placeholder="x" tools={{ client, sessionId: 's-1' }} onSubmit={noop} />,
    )
    expect(html).toContain('type="file"')
    expect(html).toContain('multiple')
    expect(html).toContain('引用工作目录里的文件，或上传附件')
  })
})

describe('PRD-M8-010 AC-6 · 模型下拉与确认模式', () => {
  test('模型清单没到之前先显示当前模型，可以点开换', () => {
    const html = renderToStaticMarkup(
      <ModelSwitch
        client={client}
        sessionId="s-1"
        busy={false}
        current="claude-sonnet-4-5"
        onNotice={() => undefined}
      />,
    )
    expect(html).toContain('claude-sonnet-4-5')
    expect(html).toContain('切换模型')
  })
})

describe('PRD-M8-010 AC-6 / PRD-M12-002 AC-2 · Composer 工具栏的确认模式三档', () => {
  const render = (mode: 'always-ask' | 'on-demand' | 'allow-all', busy = false) =>
    renderToStaticMarkup(
      <PermissionsModeSwitch client={client} sessionId="s-1" busy={busy} mode={mode} onNotice={() => undefined} />,
    )

  test('三档都在，当前档位是选中的那一个', () => {
    const html = render('allow-all')
    expect(html).toContain('aria-label="确认模式"')
    expect(html).toContain('data-permissions-mode="allow-all"')
    for (const v of ['on-demand', 'always-ask', 'allow-all']) expect(html).toContain(`value="${v}"`)
    expect(html).toMatch(/<option value="allow-all" selected="">/)
  })

  test('全部放行的说明写明「跳过所有确认」，不再说危险操作仍问', () => {
    const html = render('allow-all')
    expect(html).toContain('跳过所有确认')
    expect(html).not.toContain('危险操作仍问')
  })

  test('忙时不能切', () => {
    expect(render('on-demand', true)).toContain('disabled=""')
  })
})
