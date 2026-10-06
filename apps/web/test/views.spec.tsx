/**
 * 页面渲染 —— PRD-M8-003 AC-5（项目详情与全部项目）· PRD-M8-004 AC-6（全部会话）·
 * PRD-M8-005 AC-4（任务页）· PRD-M8-006 AC-2（改动条）· PRD-M8-012 AC-1 / AC-3（设置页 tab）
 *
 * 都是 SSR 成字符串来断言（不起浏览器）。客户端只连不上的替身：这些视图首屏不需要 daemon。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSessionStore, DomiClient, planView, type StepActivity, type WireSocket } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectRow, SessionRow } from '../src/layout/data.ts'
import { CredentialNotice } from '../src/session/CredentialNotice.tsx'
import { ChangesTab, worktreeUndoable } from '../src/session/changesTab.tsx'
import { ProgressTab, StepRow } from '../src/session/progressTab.tsx'
import { groupFindings, ReviewFindings } from '../src/session/ReviewFindings.tsx'
import { Transcript } from '../src/Transcript.tsx'
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

  test('项目设置在详情页里：隔离策略（PRD-M8-006 AC-1）；计划审阅策略已移除，审批跟会话确认模式走（PRD v1.15）', () => {
    expect(detail).toContain('在单独的工作区里改')
    expect(detail).not.toContain('计划先给我审')
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

describe('PRD-M14-005 AC-2 · 改动 tab：逐文件审阅 · 丢弃 · 撤销投影', () => {
  const diff = {
    repo: '/home/d/domi',
    branch: 'domi/t1',
    base: 'abcdef1234567890',
    files: [
      {
        path: 'src/a.ts',
        status: 'modified' as const,
        patch: '@@ -1 +1 @@\n-a\n+b',
        added: 1,
        removed: 1,
        truncated: false,
      },
      { path: 'src/b.ts', status: 'added' as const, patch: '+new', added: 1, removed: 0, truncated: false },
    ],
  }

  test('逐文件审阅：每个文件一行，可丢弃（改动 tab 首渲染打底数据来自 $changesDiff）', () => {
    const store = createSessionStore({ kind: 'task' })
    store.setChangesDiff({ range: 'turn', diff: { available: true, files: diff.files }, fallbackNames: [] })
    const html = renderToStaticMarkup(
      <ChangesTab client={client} sessionId="t1" store={store} busy={false} items={[]} onNotice={() => undefined} />,
    )
    expect(html).toContain('src/a.ts')
    expect(html).toContain('修改')
    expect(html).toContain('新增')
    expect(html).toContain('丢弃')
    expect(html).toContain('+1')
    expect(html).toContain('−1')
  })

  test('PRD-M7-006 AC-2 · Web 渲染快照：改动清单的结构固定下来', () => {
    const store = createSessionStore({ kind: 'task' })
    store.setChangesDiff({ range: 'turn', diff: { available: true, files: diff.files }, fallbackNames: [] })
    expect(
      renderToStaticMarkup(
        <ChangesTab client={client} sessionId="t1" store={store} busy={false} items={[]} onNotice={() => undefined} />,
      ),
    ).toMatchSnapshot()
  })

  test('界面上没有「隔离」字样', () => {
    const store = createSessionStore({ kind: 'task' })
    store.setChangesDiff({ range: 'turn', diff: { available: true, files: diff.files }, fallbackNames: [] })
    const html = renderToStaticMarkup(
      <ChangesTab client={client} sessionId="t1" store={store} busy={false} items={[]} onNotice={() => undefined} />,
    )
    expect(html).not.toContain('隔离')
  })

  test('没有快照、也没有回退名时如实说空态（不再整条不出现：改动 tab 是常驻面板）', () => {
    const store = createSessionStore({ kind: 'task' })
    store.setChangesDiff({ range: 'turn', diff: null, fallbackNames: [] })
    const html = renderToStaticMarkup(
      <ChangesTab client={client} sessionId="t1" store={store} busy={false} items={[]} onNotice={() => undefined} />,
    )
    expect(html).toContain('还没有改动')
  })

  test('丢弃过的可以撤销：从事件投影出来', () => {
    const items = [
      { seq: 1, kind: 'context' as const, text: '丢弃了 src/a.ts 的改动', summary: '回收站 12' },
      { seq: 2, kind: 'context' as const, text: '丢弃了 src/b.ts 的改动', summary: '回收站 13' },
      { seq: 3, kind: 'context' as const, text: '恢复了 src/b.ts 的改动' },
    ]
    expect(worktreeUndoable(items)).toEqual([{ path: 'src/a.ts', trash: '12' }])
  })
})

describe('PRD-M8-012 AC-1 / AC-3 · 设置页 8 个 tab（M10-003 加运行时），通讯工具是「即将支持」', () => {
  test('左侧 8 个 tab，地址里带 tab', () => {
    const html = renderToStaticMarkup(<SettingsView client={client} tab="general" online={false} />)
    for (const label of ['通用', '模型供应商', '通讯工具', '记忆管理', 'Soul 与人格', '插件', '用量统计', '运行时']) {
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

describe('OPT-M8-001 · 缺 key 的引导', () => {
  test('提示点名是哪一家，并链到设置 › 模型供应商', () => {
    const html = renderToStaticMarkup(<CredentialNotice provider="deepseek" />)
    expect(html).toContain('deepseek')
    expect(html).toContain('href="#/settings/models"')
    // 不知道是哪一家时也说得通
    expect(renderToStaticMarkup(<CredentialNotice provider="" />)).toContain('还没有配置模型的 API key')
  })
})

describe('PRD-M7-010 AC-2 · 审阅发现在 Web 里按文件展示', () => {
  const findings = [
    { file: 'src/pay.ts', line: 9, severity: 'low' as const, problem: '命名', basis: '代码事实' },
    { file: 'src/a.ts', line: 2, severity: 'medium' as const, problem: '没处理空值', basis: 'spec 第 1 条' },
    { file: 'src/pay.ts', line: 3, severity: 'high' as const, problem: '金额没校验', basis: 'spec 第 2 条' },
  ]

  test('按文件分组（文件名排序），组内按行号排序', () => {
    expect(groupFindings(findings).map(([f, l]) => [f, l.map((x) => x.line)])).toEqual([
      ['src/a.ts', [2]],
      ['src/pay.ts', [3, 9]],
    ])
  })

  test('每个文件一块，问题、依据、严重程度都在；没有发现时如实说', () => {
    const html = renderToStaticMarkup(<ReviewFindings findings={findings} />)
    expect(html.match(/data-file="/g)).toHaveLength(2)
    expect(html).toContain('金额没校验')
    expect(html).toContain('spec 第 2 条')
    expect(html).toContain('data-severity="high"')
    expect(renderToStaticMarkup(<ReviewFindings findings={[]} />)).toContain('没有发现问题')
  })
})

describe('PRD-M14-004 · 进度 tab（右侧栏）', () => {
  const env = (seq: number, ts: number, ev: Record<string, unknown>) => ({
    seq,
    sessionId: 't1',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts,
    schemaVersion: 16,
    ev: ev as never,
  })
  const plan = (seq: number, ts: number, steps: Array<Record<string, unknown>>) =>
    env(seq, ts, { t: 'plan.update', steps })
  const renderTab = (store: ReturnType<typeof createSessionStore>): string =>
    renderToStaticMarkup(
      <ProgressTab
        store={store}
        status={store.$status.get()}
        ask={null}
        onContinue={() => undefined}
        onOpenStep={() => undefined}
        onOpenSubsession={() => undefined}
      />,
    )

  test('AC-1 · 最后一条计划的状态映射：done 划线 / in_progress 高亮 / pending 灰 / skipped 标跳过 + 缩进', () => {
    const store = createSessionStore({ kind: 'task' })
    store.$events.set([
      plan(1, 1000, [
        { id: 'a', text: '第一步', status: 'done' },
        { id: 'b', text: '第二步', status: 'in_progress', dependsOn: ['a'] },
        { id: 'c', text: '第三步', status: 'pending', dependsOn: ['a', 'b'] },
        { id: 'd', text: '跳过步', status: 'skipped' },
      ]),
    ])
    const html = renderTab(store)
    expect(html).toContain('第一步')
    expect(html).toContain('第二步')
    expect(html).toContain('跳过')
    expect(html).toContain('data-status="done"')
    expect(html).toContain('data-status="in_progress"')
    expect(html).toContain('data-status="skipped"')
    // dependsOn 缩进：c 比 b 深（style 里有更大的 paddingLeft）
    const pad = [...html.matchAll(/padding-left:(\d+)px/g)].map((m) => Number(m[1]))
    expect(Math.max(...pad)).toBeGreaterThan(Math.min(...pad))
  })

  test('AC-2 · 步骤区间可跳改动 tab；展开详情渲染工具 / 文件 / 子 agent', () => {
    const store = createSessionStore({ kind: 'task' })
    store.$events.set([
      plan(1, 1000, [{ id: 's', text: '做事', status: 'in_progress' }]),
      env(2, 2000, { t: 'tool.call', id: 'c1', name: 'fs.write', args: { path: 'a.txt' } }),
      env(3, 3000, { t: 'fs.snapshot', path: 'a.txt', phase: 'before', sha256: null, bytes: 1 }),
      env(4, 4000, { t: 'task.spawn', childSessionId: 'sub1', goal: '写个测试' }),
      plan(5, 5000, [{ id: 's', text: '做事', status: 'done' }]),
    ])
    const html = renderTab(store)
    // 跑过的步骤带「查看这一步的改动」定位按钮
    expect(html).toContain('data-action="open-step-changes"')

    // 展开态详情（StepRow 直接渲染）：工具调用 / 文件 / 子 agent 都出来
    const v = planView(store.$events.get(), 5)
    if (v.kind !== 'plan') throw new Error('应有计划')
    const detail = renderToStaticMarkup(
      <StepRow
        s={v.steps[0] as StepActivity}
        open
        onToggle={() => undefined}
        onOpenStep={() => undefined}
        onOpenSubsession={() => undefined}
      />,
    )
    expect(detail).toContain('fs.write×1')
    expect(detail).toContain('a.txt')
    expect(detail).toContain('写个测试')
    expect(detail).toContain('data-action="open-subsession"')
  })

  test('AC-4 · 底部固定区：verify（第几次 / 是否最后一次）+ 剩余步数 + 继续', () => {
    const store = createSessionStore({ kind: 'task' })
    store.$events.set([
      plan(1, 1000, [
        { id: 'a', text: 'A', status: 'done' },
        { id: 'b', text: 'B', status: 'pending' },
      ]),
      env(2, 2000, { t: 'verify.required', attempt: 2, message: '先验证', final: true }),
    ])
    const html = renderTab(store)
    expect(html).toContain('验证第 2 次')
    expect(html).toContain('最后一次')
    expect(html).toContain('计划还剩 1 步')
    expect(html).toContain('data-action="continue-plan"')
  })

  test('AC-5 · 没有计划 → 本轮动作摘要（类别计数 + 最近动作）', () => {
    const store = createSessionStore()
    store.$events.set([
      env(1, 1000, { t: 'user.input', text: 'hi' }),
      env(2, 2000, { t: 'tool.call', id: 'c1', name: 'shell.exec', args: { command: 'bun test' } }),
      env(3, 3000, { t: 'tool.call', id: 'c2', name: 'fs.write', args: { path: 'a.ts' } }),
    ])
    const html = renderTab(store)
    expect(html).toContain('data-part="turn-summary"')
    expect(html).toContain('2 次工具调用')
    expect(html).toContain('shell.exec')
    expect(html).toContain('bun test')
  })

  test('空计划 → 如实说空态；AC-6 · 对话里的计划卡片保留（不搬走）', () => {
    const empty = createSessionStore({ kind: 'task' })
    empty.$events.set([plan(1, 1000, [])])
    expect(renderTab(empty)).toContain('还没有计划')

    // AC-6 回归：plan.update 仍然进对话流（Transcript 的计划卡片 data-part="plan"）
    const s = createSessionStore({ kind: 'task' })
    s.applyEvents([plan(1, 1000, [{ id: 'a', text: '第一步', status: 'in_progress' }])])
    const items = s.$items.get()
    expect(items.some((i) => i.kind === 'plan' && (i as { plan?: unknown[] }).plan?.length === 1)).toBe(true)
    const html = renderToStaticMarkup(<Transcript items={items} onBranch={() => undefined} onQuote={() => undefined} />)
    expect(html).toContain('data-part="plan"')
    expect(html).toContain('第一步')
  })
})
