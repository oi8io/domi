/**
 * TUI 弹层与快捷键 —— PRD-M8-015 AC-1…AC-5
 *
 * 按键路由是纯函数（routeKey）；弹层用假 stdin 驱动（render.tsx 的 press）。
 * 断言的是「输入框非空时 p 是普通字符」这种真行为，不是组件里写了什么。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, type DomiClient } from '@domi/client-core'
import { atom } from 'nanostores'
import { COMMANDS, completeSlash } from '../src/commands.ts'
import { moveOf, routeKey } from '../src/keys.ts'
import { Root } from '../src/main.tsx'
import {
  describeCron,
  type OverlayState,
  Overlays,
  projectItems,
  sessionItems,
  taskItems,
} from '../src/overlays/Overlays.tsx'
import { makeTheme } from '../src/theme.ts'
import { KEYS, renderAt } from './render.tsx'

const now = Date.now()
const projects = [
  { id: 'p1', name: 'domi', path: '~/Develop/domi', taskCount: 47, recentTasks: [] },
  { id: 'p2', name: 'iCleaner', path: '~/Develop/cleaner', taskCount: 3, recentTasks: [] },
]
const sessions = [
  {
    id: 's1',
    title: '修复跨端同步',
    model: 'm',
    updatedAt: now,
    eventCount: 3,
    deleted: false,
    kind: 'task',
    projectId: 'p1',
    busy: true,
  },
  {
    id: 's2',
    title: '设计 Soul 导出格式',
    model: 'm',
    updatedAt: now - 86_400_000,
    eventCount: 3,
    deleted: false,
    kind: 'chat',
    unread: true,
  },
  {
    id: 's3',
    title: '清理缓存规则',
    model: 'm',
    updatedAt: now - 7 * 86_400_000,
    eventCount: 3,
    deleted: false,
    kind: 'task',
    projectId: 'p2',
  },
]
const schedules = [
  {
    id: 'c1',
    projectId: 'p1',
    goal: '每日 Soul 回顾',
    cron: '0 23 * * *',
    tz: 'UTC',
    paused: false,
    createdAt: 0,
    nextRun: now + 3600_000,
  },
]

function fakeClient(calls: unknown[][] = []) {
  return {
    $state: atom('open'),
    getSettings: async () => ({ values: {} }),
    listProjects: async () => projects,
    listSessions: async () => ({ sessions }),
    listSchedules: async () => schedules,
    listFiles: async () => ({ files: [], truncated: false }),
    markRead: async () => false,
    watchedSeq: () => 0,
    updateSchedule: async (p: unknown) => {
      calls.push(['update', p])
      return {}
    },
    runScheduleNow: async (id: string) => {
      calls.push(['runNow', id])
      return 's9'
    },
    previewSchedule: async (cron: string) => {
      if (cron.split(' ').length !== 5)
        throw new Error(`要 5 段（分 时 日 月 周），这里是 ${cron.split(' ').length} 段`)
      return { nextRuns: [now], tz: 'UTC' }
    },
    createTask: async (projectId: string, goal: string) => {
      calls.push(['createTask', projectId, goal])
      return { sessionId: 's10' }
    },
    createSchedule: async (p: unknown) => {
      calls.push(['createSchedule', p])
      return {}
    },
    watch: async () => undefined,
    unwatch: () => undefined,
    submit: async (...args: unknown[]) => {
      calls.push(['submit', ...args])
      return { accepted: true }
    },
  } as unknown as DomiClient
}

describe('PRD-M8-015 AC-1 · 单键只在输入框为空时生效；Ctrl 组合随时可用', () => {
  test('p / s / t / ? 开对应的弹层', () => {
    for (const [key, overlay] of [
      ['p', 'projects'],
      ['s', 'sessions'],
      ['t', 'tasks'],
      ['?', 'help'],
    ] as const) {
      expect(routeKey(key, {}, { inputEmpty: true, overlay: null })).toEqual({ kind: 'open', overlay })
    }
  })

  test('输入框非空时单键就是普通字符', () => {
    for (const key of ['p', 's', 't', '?']) {
      expect(routeKey(key, {}, { inputEmpty: false, overlay: null })).toBeNull()
    }
  })

  test('Ctrl+P / Ctrl+R / Ctrl+T 任何时候都行；不占 Ctrl+S', () => {
    expect(routeKey('p', { ctrl: true }, { inputEmpty: false, overlay: null })).toEqual({
      kind: 'open',
      overlay: 'projects',
    })
    expect(routeKey('r', { ctrl: true }, { inputEmpty: false, overlay: null })).toEqual({
      kind: 'open',
      overlay: 'sessions',
    })
    expect(routeKey('t', { ctrl: true }, { inputEmpty: false, overlay: null })).toEqual({
      kind: 'open',
      overlay: 'tasks',
    })
    expect(routeKey('s', { ctrl: true }, { inputEmpty: true, overlay: null })).toBeNull()
  })

  test('弹层里：Ctrl+P 让给「上移」，再按一次同一个 Ctrl 键关掉，Esc 归弹层自己处理', () => {
    expect(routeKey('p', { ctrl: true }, { inputEmpty: true, overlay: 'projects' })).toBeNull()
    expect(routeKey('t', { ctrl: true }, { inputEmpty: true, overlay: 'tasks' })).toEqual({ kind: 'close' })
    expect(routeKey('r', { ctrl: true }, { inputEmpty: true, overlay: 'tasks' })).toEqual({
      kind: 'open',
      overlay: 'sessions',
    })
    expect(routeKey('p', {}, { inputEmpty: true, overlay: 'sessions' })).toBeNull()
  })

  test('上下移动：↑↓ 与 Ctrl+P / Ctrl+N', () => {
    expect(moveOf('', { upArrow: true })).toBe(-1)
    expect(moveOf('', { downArrow: true })).toBe(1)
    expect(moveOf('p', { ctrl: true })).toBe(-1)
    expect(moveOf('n', { ctrl: true })).toBe(1)
    expect(moveOf('n', {})).toBe(0)
  })
})

describe('PRD-M8-015 AC-2 / AC-3 / AC-4 · 三个弹层的内容', () => {
  test('项目：名字、路径、任务数', () => {
    const items = projectItems(projects as never, 'p1')
    expect(items.map((i) => i.label)).toEqual(['domi', 'iCleaner'])
    expect(items[0]?.meta).toContain('47 任务')
    expect(items[0]?.dot).toBe('accent')
  })

  test('会话：按「无项目 / 各项目」分组，状态点区分运行中与未读', () => {
    const items = sessionItems(sessions as never, projects as never, now)
    expect(items[0]?.group).toBe('无项目')
    expect(items.find((i) => i.key === 's1')?.dot).toBe('running')
    expect(items.find((i) => i.key === 's2')?.dot).toBe('warn')
    expect(items.find((i) => i.key === 's2')?.meta).toContain('未读')
    expect(items.find((i) => i.key === 's3')?.group).toBe('iCleaner')
  })

  test('任务：进行中与定时两组；cron 说人话', () => {
    const items = taskItems(sessions as never, schedules as never, now)
    expect(items[0]).toMatchObject({ group: '进行中', dot: 'running' })
    expect(items[1]).toMatchObject({ group: '定时', label: '每日 Soul 回顾' })
    expect(items[1]?.meta).toBe('每天 23:00')
    expect(describeCron('30 9 * * 1-5')).toBe('工作日 09:30')
    expect(describeCron('0 2 * * 0')).toBe('每周日 02:00')
    expect(describeCron('0 0 1 * *')).toBe('每月 1 日 00:00')
    expect(describeCron('*/5 * * * *')).toBe('*/5 * * * *')
  })

  test('会话弹层：打字即搜索，回车打开选中的会话', async () => {
    const calls: unknown[][] = []
    const opened: string[] = []
    const h = renderAt(
      80,
      <Overlays
        client={fakeClient(calls)}
        state={{ id: 'sessions' }}
        sessionId="s2"
        onChange={() => undefined}
        onOpenSession={(id) => opened.push(id)}
      />,
    )
    await h.waitFor((f) => f.includes('设计 Soul 导出格式'), 2000)
    await h.press('清')
    await h.flush()
    expect(h.lastFrame()).toContain('清理缓存规则')
    expect(h.lastFrame()).not.toContain('设计 Soul 导出格式')
    await h.press(KEYS.enter)
    await h.flush()
    expect(opened).toEqual(['s3'])
    h.unmount()
  })

  test('任务弹层：p 暂停 / 恢复定时任务，n 进新建表单，cron 非法当场提示', async () => {
    const calls: unknown[][] = []
    let state: OverlayState | null = { id: 'tasks' }
    const h = renderAt(
      80,
      <Overlays
        client={fakeClient(calls)}
        state={state}
        sessionId="s2"
        onChange={(next) => {
          state = next
          h.rerender(
            <Overlays
              client={fakeClient(calls)}
              state={next ?? { id: 'tasks' }}
              sessionId="s2"
              onChange={() => undefined}
              onOpenSession={() => undefined}
            />,
          )
        }}
        onOpenSession={() => undefined}
      />,
    )
    await h.waitFor((f) => f.includes('每日 Soul 回顾'), 2000)
    await h.press(KEYS.down, 'p')
    await h.flush()
    expect(calls.at(-1)).toEqual(['update', { id: 'c1', paused: true }])

    await h.press('n')
    await h.flush()
    expect(h.lastFrame()).toContain('新建任务')
    await h.press(KEYS.tab, '改', KEYS.tab, '0', ' ', '9', KEYS.tab)
    await h.flush()
    await h.waitFor((f) => f.includes('要 5 段'), 2000)
    await h.press(KEYS.enter)
    await h.flush()
    expect(calls.some((c) => c[0] === 'createTask' || c[0] === 'createSchedule')).toBe(false)
    h.unmount()
  })
})

describe('PRD-M8-015 AC-5 · `/` 命令补全', () => {
  test('按前缀给候选；命令表与 parseSlash 对得上', () => {
    expect(completeSlash('/s').map((c) => c.name)).toEqual(['/sessions', '/soul'])
    expect(completeSlash('/soul x')).toEqual([])
    expect(completeSlash('你好')).toEqual([])
    expect(COMMANDS().length).toBeGreaterThan(10)
  })

  test('输入 / 时列出候选，Tab 补全选中的那个；带参数的补完留一个空格', async () => {
    const calls: unknown[][] = []
    const store = createSessionStore({ provider: 'x', model: 'y' })
    const h = renderAt(80, <Root store={store} client={fakeClient(calls)} sessionId="s1" theme={makeTheme()} />)
    await h.flush()
    await h.press('/', 's')
    await h.flush()
    expect(h.lastFrame()).toContain('/sessions')
    expect(h.lastFrame()).toContain('/soul')
    await h.press(KEYS.down, KEYS.tab)
    await h.flush()
    expect(h.lastFrame()).toContain('/soul')
    h.unmount()
  })

  test('输入框非空时 p 是字符，不开弹层（AC-1 的断言）', async () => {
    const h = renderAt(
      80,
      <Root
        store={createSessionStore({ provider: 'x', model: 'y' })}
        client={fakeClient()}
        sessionId="s1"
        theme={makeTheme()}
      />,
    )
    await h.flush()
    await h.press('h', 'p')
    await h.flush()
    // PRD-M9-005 AC-6：输入区不再有 › 前缀
    expect(h.lastFrame()).toContain('hp')
    expect(h.lastFrame()).not.toContain('项目选择')
    h.unmount()
  })
})
