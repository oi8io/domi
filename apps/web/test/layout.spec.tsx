/**
 * 布局骨架与导航 —— PRD-M8-002 AC-1 / AC-2 / AC-3 / AC-5 / AC-6，以及 PRD-M8-009 AC-3 的状态点
 *
 * 侧栏用 SSR 渲染成字符串来断言（和 render.spec 一样，不起浏览器）；路由是纯函数，直接调。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { dotOf, type ProjectRow, type SessionRow } from '../src/layout/data.ts'
import { ProjectNode, Sidebar } from '../src/layout/Sidebar.tsx'
import { formatRoute, parseHash, type Route, SETTINGS_TABS } from '../src/router.ts'

const projects: ProjectRow[] = [
  {
    id: 'p1',
    name: 'domi',
    path: '~/Develop/domi',
    taskCount: 7,
    recentTasks: [
      { id: 't1', title: '重构 Web UI', busy: true },
      { id: 't2', title: '接手 M3', unread: true },
      { id: 't3', title: '插件沙箱' },
      { id: 't4', title: '评估集' },
      { id: 't5', title: 'MCP 迁移' },
      { id: 't6', title: '更早的' },
    ],
  },
  { id: 'p2', name: 'iCleaner', path: '~/Develop/cleaner', taskCount: 0, recentTasks: [] },
]
const chats: SessionRow[] = [
  { id: 'c1', title: '聊聊 cron', model: 'gpt-4o', eventCount: 12, deleted: false },
  { id: 'c2', title: '', model: 'claude', eventCount: 3, deleted: false, unread: true },
]

const sidebar = (route: Route, extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    <Sidebar
      state="open"
      lastError={null}
      route={route}
      projects={projects}
      projectsAvailable
      chats={chats}
      onNewChat={() => undefined}
      onAddProject={() => undefined}
      {...extra}
    />,
  )

describe('PRD-M8-002 AC-1 · 侧栏自上而下的顺序', () => {
  const html = sidebar({ view: 'home' })
  const at = (s: string): number => html.indexOf(s)

  test('品牌 → 新对话 → 新任务 / 定时任务 → 项目 → 会话 → 设置', () => {
    expect(at('domi')).toBeGreaterThanOrEqual(0)
    expect(at('新对话')).toBeGreaterThan(at('domi'))
    expect(at('新任务')).toBeGreaterThan(at('新对话'))
    expect(at('定时任务')).toBeGreaterThan(at('新任务'))
    expect(at('>项目<')).toBeGreaterThan(at('定时任务'))
    expect(at('>会话<')).toBeGreaterThan(at('>项目<'))
    expect(at('设置')).toBeGreaterThan(at('>会话<'))
  })

  test('宽度是 260px 的 token（--sidebar-w），不是写死在组件里', () => {
    const css = readFileSync(join(import.meta.dir, '..', 'src/globals.css'), 'utf8')
    expect(css).toContain('--sidebar-w: 260px')
  })
})

describe('PRD-M8-002 AC-2 · 视图由 hash 决定，刷新与前进后退回到同一视图', () => {
  const routes: Route[] = [
    { view: 'home' },
    { view: 'session', id: 's-1', tab: 'chat' },
    { view: 'session', id: 's-1', tab: 'trajectory' },
    { view: 'project', id: 'p1' },
    { view: 'project', id: 'p1', create: true },
    { view: 'projects' },
    { view: 'sessions' },
    { view: 'tasks' },
    { view: 'tasks', runId: 'run-9' },
    { view: 'tasks', create: true, schedule: false },
    { view: 'tasks', create: true, schedule: true, projectId: 'p1' },
    ...SETTINGS_TABS.map((tab) => ({ view: 'settings' as const, tab })),
  ]

  test.each(routes.map((r) => [formatRoute(r), r] as const))('%s 解析回同一个视图', (hash, route) => {
    const back = parseHash(hash)
    expect({ schedule: false, ...back }).toMatchObject({ schedule: false, ...route })
  })

  test('认不出的 hash 回首页；设置的未知 tab 回通用', () => {
    expect(parseHash('#/nope')).toEqual({ view: 'home' })
    expect(parseHash('')).toEqual({ view: 'home' })
    expect(parseHash('#/settings/nope')).toEqual({ view: 'settings', tab: 'general' })
  })

  test('会话 id 里的特殊字符原样带回来', () => {
    const r: Route = { view: 'session', id: 's/奇怪 id', tab: 'chat' }
    expect(parseHash(formatRoute(r))).toEqual(r)
  })
})

describe('PRD-M8-002 AC-3 · 栏目可折叠，标题 hover 出操作', () => {
  const html = sidebar({ view: 'home' })

  test('项目栏三个操作、会话栏一个', () => {
    expect(html).toContain('添加项目')
    expect(html).toContain('全部项目')
    expect(html).toContain('全部会话')
  })

  test('折叠按钮带 aria-expanded（折叠状态存 localStorage，见 data.ts 的 loadSet/saveSet）', () => {
    expect(html).toContain('aria-expanded="true"')
  })
})

describe('PRD-M8-002 AC-5 · 入口映射', () => {
  const html = sidebar({ view: 'home' })

  test('新任务 → #/tasks/new；定时任务 → 同一个页面带 schedule=1', () => {
    expect(html).toContain('href="#/tasks/new"')
    expect(html).toContain('href="#/tasks/new?schedule=1"')
    expect(parseHash('#/tasks/new?schedule=1')).toMatchObject({ view: 'tasks', create: true, schedule: true })
  })

  test('新对话是个按钮（建完会话再跳转），离线时不可点', () => {
    expect(html).toContain('新对话')
    expect(sidebar({ view: 'home' }, { state: 'closed' })).toContain('disabled=""')
  })
})

describe('PRD-M8-002 AC-6 · 项目是一棵树', () => {
  const expanded = renderToStaticMarkup(
    <ProjectNode
      project={projects[0] as ProjectRow}
      expanded
      current
      activeId="t1"
      active={{ id: 't1', busy: true }}
      onToggle={() => undefined}
    />,
  )
  const collapsed = renderToStaticMarkup(
    <ProjectNode project={projects[0] as ProjectRow} expanded={false} current={false} onToggle={() => undefined} />,
  )

  test('展开后最多 5 个最近任务，超出的走「查看全部 (N)」', () => {
    expect(expanded).toContain('重构 Web UI')
    expect(expanded).toContain('MCP 迁移')
    expect(expanded).not.toContain('更早的')
    expect(expanded).toContain('查看全部 (7)')
    expect(expanded).toContain('href="#/p/p1"')
  })

  test('收起时不画子项', () => {
    expect(collapsed).not.toContain('重构 Web UI')
    expect(collapsed).toContain('aria-expanded="false"')
  })

  test('hover 出 ↗（项目详情）与笔（在该项目下新建任务）', () => {
    expect(expanded).toContain('domi 项目详情')
    expect(expanded).toContain('在 domi 下新建任务')
    expect(expanded).toContain('href="#/p/p1?new=1"')
  })

  test('当前任务所在的项目高亮，当前任务那一行也高亮', () => {
    expect(expanded).toContain('text-accent')
    expect(expanded).toContain('bg-accent-d')
  })

  test('PRD-M8-009 AC-3 · 状态点：运行中蓝、未读黄、其他灰', () => {
    expect(dotOf({ id: 't1', busy: true })).toBe('running')
    expect(dotOf({ id: 't2', unread: true })).toBe('unread')
    expect(dotOf({ id: 't3' })).toBe('idle')
    // 正在看的那个会话不算未读
    expect(dotOf({ id: 't2', unread: true }, { id: 't2', busy: false })).toBe('idle')
    // 本地 store 的忙闲优先于列表里的
    expect(dotOf({ id: 't3', busy: false }, { id: 't3', busy: true })).toBe('running')
    expect(expanded).toContain('data-state="running"')
  })
})

describe('PRD-M11-006 · 连不上 daemon 时侧栏给出启动指引', () => {
  test('lastError 出现时，附一行启动 daemon 的命令（Web 无 Node，只能指引用户自己起）', () => {
    const html = sidebar({ view: 'home' }, { lastError: '连不上 daemon' })
    expect(html).toContain('pnpm domid')
  })
})
