/**
 * 页面渲染 —— PRD-M8-003 AC-5（项目详情与全部项目）· PRD-M8-004 AC-6（全部会话）·
 * PRD-M8-005 AC-4（任务页）· PRD-M8-006 AC-2（改动条）· PRD-M8-012 AC-1 / AC-3（设置页 tab）
 *
 * 都是 SSR 成字符串来断言（不起浏览器）。客户端只连不上的替身：这些视图首屏不需要 daemon。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DomiClient, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectRow, SessionRow } from '../src/layout/data.ts'
import { ChangesBar, ChangesView, undoable } from '../src/session/ChangesBar.tsx'
import { ProjectsView, ProjectView } from '../src/views/ProjectsView.tsx'
import { groupSessions, SessionsView } from '../src/views/SessionsView.tsx'
import { SettingsView } from '../src/views/SettingsView.tsx'
import { TasksView } from '../src/views/TasksView.tsx'

const neverConnects = (): WireSocket => {
  throw new Error('渲染测试不该发起连接')
}
const client = new DomiClient({ clientName: 't', connect: neverConnects })

const projects: ProjectRow[] = [
  { id: 'p1', name: 'domi', path: '/home/d/domi', taskCount: 2, recentTasks: [], lastActivity: 2 },
  { id: 'p2', name: 'iCleaner', path: '/home/d/cleaner', taskCount: 0, recentTasks: [], archived: true },
]
const tasks: SessionRow[] = [
  {
    id: 't1',
    title: '重构 Web UI',
    model: 'claude',
    eventCount: 42,
    deleted: false,
    kind: 'task',
    projectId: 'p1',
    busy: true,
  },
  { id: 't2', title: '接手 M3', model: 'gpt-4o', eventCount: 9, deleted: false, kind: 'task', projectId: 'p1' },
]
const chats: SessionRow[] = [
  { id: 'c1', title: '聊聊 cron', model: 'gpt-4o', eventCount: 3, deleted: false, kind: 'chat' },
  { id: 'd1', title: '删掉的', model: 'gpt-4o', eventCount: 1, deleted: true, kind: 'chat' },
]

describe('PRD-M8-003 AC-5 · 项目详情与全部项目', () => {
  const detail = renderToStaticMarkup(
    <ProjectView
      client={client}
      project={projects[0] as ProjectRow}
      tasks={tasks}
      online
      onChanged={() => undefined}
    />,
  )

  test('项目详情：名字、路径、开始任务的输入框、历史任务', () => {
    expect(detail).toContain('domi')
    expect(detail).toContain('/home/d/domi')
    expect(detail).toContain('在这个项目里开始新任务…')
    expect(detail).toContain('重构 Web UI')
    expect(detail).toContain('接手 M3')
  })

  test('项目设置在详情页里：隔离策略与计划审阅策略（PRD-M8-005 AC-3 / M8-006 AC-1）', () => {
    expect(detail).toContain('在单独的工作区里改')
    expect(detail).toContain('计划先给我审')
    // 界面上不出现「隔离会话」（PRD-M8-006 AC-2）
    expect(detail).not.toContain('隔离会话')
  })

  test('归档的项目取消归档后才能建任务', () => {
    const archived = renderToStaticMarkup(
      <ProjectView client={client} project={projects[1] as ProjectRow} tasks={[]} online onChanged={() => undefined} />,
    )
    expect(archived).toContain('项目已归档，取消归档后才能开始新任务')
  })

  test('全部项目页：可按名字或路径筛选，归档的默认不出现', () => {
    const list = renderToStaticMarkup(
      <ProjectsView
        projects={projects}
        showArchived={false}
        onShowArchived={() => undefined}
        onUnarchive={() => undefined}
      />,
    )
    expect(list).toContain('筛选项目…')
    expect(list).toContain('domi')
    expect(list).toContain('/home/d/cleaner')
    expect(list).toContain('显示已归档')
  })
})

describe('PRD-M8-004 AC-6 · 全部会话页按「无项目 / 各项目」分组，含回收站', () => {
  const html = renderToStaticMarkup(
    <SessionsView
      sessions={[...chats, ...tasks]}
      projects={projects}
      showDeleted
      onShowDeleted={() => undefined}
      onRestore={() => undefined}
    />,
  )

  test('分组：没有项目的排在前面', () => {
    const groups = groupSessions([...chats, ...tasks], projects, '')
    expect(groups.map((g) => g.label)).toEqual(['无项目', 'domi'])
    expect(groups[0]?.rows.map((r) => r.id)).toContain('c1')
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(['t1', 't2'])
  })

  test('筛选按标题、模型与项目名', () => {
    const ids = (q: string) => groupSessions([...chats, ...tasks], projects, q).flatMap((g) => g.rows.map((r) => r.id))
    expect(ids('cron')).toEqual(['c1'])
    expect(ids('claude')).toEqual(['t1'])
    expect(ids('domi')).toEqual(['t1', 't2'])
    expect(ids('没有这个')).toEqual([])
  })

  test('回收站：已删除的划掉、带「恢复」按钮；勾选框控制列表要不要带上它们（App 那边 includeDeleted）', () => {
    expect(html).toContain('删掉的')
    expect(html).toContain('已删除')
    expect(html).toContain('恢复')
    expect(html).toContain('显示已删除（回收站）')
    const app = readFileSync(join(import.meta.dir, '..', 'src/App.tsx'), 'utf8')
    expect(app).toContain('listSessions({ includeDeleted: showDeleted })')
  })
})

describe('PRD-M8-005 AC-4 · 任务页列出进行中与最近任务', () => {
  const html = renderToStaticMarkup(
    <TasksView
      client={client}
      online={false}
      create={false}
      schedule={false}
      projects={projects}
      tasks={tasks}
      onCreated={() => undefined}
    />,
  )

  test('进行中与最近任务两块，带项目名', () => {
    expect(html).toContain('进行中')
    expect(html).toContain('最近任务')
    expect(html).toContain('重构 Web UI')
    expect(html).toContain('domi')
  })

  test('新建表单先选项目再写目标（PRD-M8-005 AC-1）', () => {
    const form = renderToStaticMarkup(
      <TasksView
        client={client}
        online
        create
        schedule={false}
        projects={projects}
        tasks={[]}
        onCreated={() => undefined}
      />,
    )
    expect(form).toContain('新建任务')
    expect(form).toContain('任务一定属于某个项目')
    expect(form).toContain('这个任务要达成什么？')
  })

  test('定时任务表单多出 cron 与时区（PRD-M8-007 AC-1）', () => {
    const form = renderToStaticMarkup(
      <TasksView client={client} online create schedule projects={projects} tasks={[]} onCreated={() => undefined} />,
    )
    expect(form).toContain('新建定时任务')
    expect(form).toContain('0 9 * * 1-5')
    expect(form).toContain('创建定时任务')
  })
})

describe('PRD-M8-006 AC-2 · 改动条：N 个文件改动 · 查看 · 带回', () => {
  const diff = {
    repo: '/home/d/domi',
    branch: 'domi/t1',
    base: 'abcdef1234567890',
    files: [
      { path: 'src/a.ts', status: 'modified' as const, patch: '@@ -1 +1 @@\n-a\n+b', truncated: false },
      { path: 'src/b.ts', status: 'added' as const, patch: '+new', truncated: false },
    ],
  }

  test('逐文件审阅：每个文件一行，可丢弃', () => {
    const html = renderToStaticMarkup(<ChangesView diff={diff} busy={false} onDiscard={() => undefined} />)
    expect(html).toContain('src/a.ts')
    expect(html).toContain('修改')
    expect(html).toContain('新增')
    expect(html).toContain('丢弃')
    expect(html).toContain('domi/t1')
  })

  test('界面上没有「隔离」字样', () => {
    const html = renderToStaticMarkup(<ChangesView diff={diff} busy={false} />)
    expect(html).not.toContain('隔离')
  })

  test('没有改动、也没有可撤销的丢弃时整条不出现', () => {
    const html = renderToStaticMarkup(<ChangesBar client={client} sessionId="t1" busy={false} items={[]} />)
    expect(html).toBe('')
  })

  test('丢弃过的可以撤销：从事件投影出来', () => {
    const items = [
      { seq: 1, kind: 'context' as const, text: '丢弃了 src/a.ts 的改动', summary: '回收站 12' },
      { seq: 2, kind: 'context' as const, text: '丢弃了 src/b.ts 的改动', summary: '回收站 13' },
      { seq: 3, kind: 'context' as const, text: '恢复了 src/b.ts 的改动' },
    ]
    expect(undoable(items)).toEqual([{ path: 'src/a.ts', trash: '12' }])
  })
})

describe('PRD-M8-012 AC-1 / AC-3 · 设置页 7 个 tab，通讯工具是「即将支持」', () => {
  test('左侧 7 个 tab，地址里带 tab', () => {
    const html = renderToStaticMarkup(<SettingsView client={client} tab="general" online={false} />)
    for (const label of ['通用', '模型供应商', '通讯工具', '记忆管理', 'Soul 与人格', '插件', '用量统计']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('href="#/settings/plugins"')
    expect(html).toContain('aria-current="page"')
  })

  test('通讯工具：两项不可操作', () => {
    const html = renderToStaticMarkup(<SettingsView client={client} tab="messaging" online />)
    expect(html).toContain('即将支持')
    expect(html).toContain('Telegram')
    expect(html).toContain('微信')
  })

  test('没连上 daemon 的 tab 说清楚要先连上', () => {
    const html = renderToStaticMarkup(<SettingsView client={client} tab="models" online={false} />)
    expect(html).toContain('连上 daemon 后显示')
  })
})
