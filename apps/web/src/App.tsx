/**
 * Web 端的壳 —— PRD-M8-002（原型 .shell：260px 侧栏 + 主区）。
 *
 * 视图由 hash 路由决定；会话的订阅跟着路由走。**只渲染**：
 * 状态全在 client-core 的 atom 与 daemon 里，这个文件里没有一行是在算「事件意味着什么」（INV-04）。
 * 与 TUI 的逐项对等见 docs/parity-checklist.md。
 */

import { createSessionStore, type DomiClient, PALETTES, type PaletteId, type SessionStore } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import type { ProjectRow, SessionRow } from './layout/data.ts'
import { Sidebar } from './layout/Sidebar.tsx'
import { syncLocale } from './locale.ts'
import { $route, navigate, type Route } from './router.ts'
import type { PendingRef } from './session/Composer.tsx'
import { SessionView } from './session/SessionView.tsx'
import { setAccent } from './theme/store.ts'
import { HomeView } from './views/HomeView.tsx'
import { ProjectsView, ProjectView } from './views/ProjectsView.tsx'
import { AddProjectDialog, ToTaskDialog } from './views/projectDialogs.tsx'
import { SessionsView } from './views/SessionsView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { TasksView } from './views/TasksView.tsx'

export { ModeToggle, SessionTools, SessionView } from './session/SessionView.tsx'

export function App({
  client,
  daemonUrl,
  route: fixedRoute,
}: {
  client: DomiClient
  daemonUrl?: string
  /** 测试用：固定路由，不读 location */
  route?: Route
}) {
  const state = useStore(client.$state)
  const lastError = useStore(client.$lastError)
  const liveRoute = useStore($route)
  const route = fixedRoute ?? liveRoute
  const online = state === 'open'
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [showArchived, setShowArchived] = useState(false)
  // 老 daemon 没有项目接口时为 false
  const [projectsAvailable, setProjectsAvailable] = useState(true)
  const [dialog, setDialog] = useState<null | 'add-project' | 'to-task'>(null)
  // 跨会话引用：在哪个会话里点的都攒在这里，切到别的会话发送时带上（PRD-M3-005）
  const [refs, setRefs] = useState<PendingRef[]>([])

  useEffect(() => {
    client.start().catch(() => undefined)
    return () => client.close()
  }, [client])

  const refresh = useCallback(async (): Promise<void> => {
    const [r, p] = await Promise.all([
      client.listSessions({ includeDeleted: showDeleted }),
      client.listProjects({ includeArchived: showArchived }).then(
        (list) => list,
        () => null,
      ),
    ])
    setSessions(r.sessions as SessionRow[])
    setProjectsAvailable(p !== null)
    setProjects((p ?? []) as ProjectRow[])
  }, [client, showDeleted, showArchived])
  const refreshSoon = useCallback((): void => {
    refresh().catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    if (online) refreshSoon()
  }, [online, refreshSoon])

  // 主题色存在 daemon（与 TUI 共用，PRD-M8-001 AC-5）；连上时以它为准。老 daemon 没有这个接口就用本地的
  useEffect(() => {
    if (!online) return
    client.getSettings().then(
      (d) => {
        const a = d.values['ui.accent']
        if (typeof a === 'string' && PALETTES.some((p) => p.id === a)) setAccent(a as PaletteId)
        // 界面语言同样以 daemon 为准（PRD-M9-004 AC-1）
        syncLocale(d.values['ui.locale'])
      },
      () => undefined,
    )
  }, [client, online])

  // 会话订阅跟着路由走
  const sessionId = route.view === 'session' ? route.id : null
  const [active, setActive] = useState<{ id: string; store: SessionStore } | null>(null)
  useEffect(() => {
    if (sessionId === null || !online) return
    const store = createSessionStore()
    setActive({ id: sessionId, store })
    client.watch(sessionId, store).catch(() => undefined)
    return () => client.unwatch(sessionId)
  }, [client, sessionId, online])
  const activeStatus = useStore((active?.store ?? EMPTY).$status)
  // 列表由 daemon 推送变化（sessions.changed，PRD-M8-009 AC-1）；正在看的会话忙闲翻转时也刷一次（老 daemon 不推）
  const listVersion = useStore(client.$sessionsVersion)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 版本号与 busy 翻转是刷新的触发条件
  useEffect(() => {
    if (online) refreshSoon()
  }, [listVersion, activeStatus.busy])
  // 切视图时也刷新一次
  // biome-ignore lint/correctness/useExhaustiveDependencies: 路由变化是刷新的触发条件
  useEffect(() => {
    if (online) refreshSoon()
  }, [route.view])

  const activeRow = sessions.find((s) => s.id === sessionId)
  const activeRef = active === null ? undefined : { id: active.id, busy: activeStatus.busy }
  const live = sessions.filter((s) => !s.deleted)
  // 老 daemon 不给 kind：全当会话显示
  const chats = live.filter((s) => s.kind !== 'task')
  const tasks = live.filter((s) => s.kind === 'task')
  // 项目树里的状态点：正在看的任务以本地 store 为准，其余看列表
  const byId = new Map(live.map((s) => [s.id, s]))
  const tree = projects
    .filter((p) => !p.archived)
    .map((p) => ({
      ...p,
      recentTasks: p.recentTasks.map((t) => ({
        ...t,
        busy: byId.get(t.id)?.busy ?? t.busy,
        unread: byId.get(t.id)?.unread === true,
      })),
    }))

  let main: React.ReactNode
  switch (route.view) {
    case 'session':
      main =
        active !== null && active.id === route.id ? (
          <SessionView
            key={active.id}
            client={client}
            sessionId={active.id}
            store={active.store}
            title={activeRow?.title}
            kind={activeRow?.kind}
            project={projects.find((p) => p.id === activeRow?.projectId)}
            tab={route.tab}
            connection={state}
            onRenamed={refreshSoon}
            onToTask={activeRow?.kind === 'chat' ? () => setDialog('to-task') : undefined}
            onDeleted={() => {
              refreshSoon()
              navigate({ view: 'home' })
            }}
            onBranched={(id) => {
              refreshSoon()
              navigate({ view: 'session', id, tab: 'chat' })
            }}
            refs={refs}
            onRefsChange={setRefs}
          />
        ) : (
          <p className="m-auto text-[13px] text-mut">
            {online ? tr('web.app.openingSession') : tr('web.app.connectToOpen')}
          </p>
        )
      break
    case 'project':
      main = (
        <ProjectView
          client={client}
          project={projects.find((p) => p.id === route.id)}
          tasks={tasks.filter((t) => t.projectId === route.id)}
          online={online}
          focusComposer={route.create === true}
          {...(activeRef === undefined ? {} : { active: activeRef })}
          onChanged={refreshSoon}
        />
      )
      break
    case 'projects':
      main = (
        <ProjectsView
          projects={projects}
          showArchived={showArchived}
          onShowArchived={setShowArchived}
          onUnarchive={(id) => {
            client
              .archiveProject(id, false)
              .then(refresh)
              .catch(() => undefined)
          }}
          {...(projectsAvailable && online ? { onAdd: () => setDialog('add-project') } : {})}
        />
      )
      break
    case 'sessions':
      main = (
        <SessionsView
          sessions={sessions}
          projects={projects}
          showDeleted={showDeleted}
          onShowDeleted={setShowDeleted}
          onRestore={(id) => {
            client
              .restoreSession(id)
              .then(refresh)
              .catch(() => undefined)
          }}
          {...(activeRef === undefined ? {} : { active: activeRef })}
        />
      )
      break
    case 'tasks':
      main = (
        <TasksView
          client={client}
          online={online}
          create={route.create === true}
          schedule={route.schedule === true}
          projects={projects.filter((p) => !p.archived)}
          projectId={route.projectId}
          tasks={tasks}
          active={activeRef}
          onCreated={refreshSoon}
        />
      )
      break
    case 'settings':
      main = <SettingsView client={client} tab={route.tab} online={online} />
      break
    default:
      main = <HomeView client={client} online={online} recent={chats} onCreated={refreshSoon} />
  }

  return (
    <div className="grid h-screen grid-cols-[var(--sidebar-w)_1fr] overflow-hidden">
      <Sidebar
        state={state}
        lastError={lastError}
        daemonUrl={daemonUrl}
        route={route}
        projects={tree}
        projectsAvailable={projectsAvailable}
        chats={chats}
        active={
          active === null || sessionId === null
            ? undefined
            : { id: active.id, busy: activeStatus.busy, projectId: activeRow?.projectId }
        }
        onNewChat={() => navigate({ view: 'home' })}
        {...(projectsAvailable && online ? { onAddProject: () => setDialog('add-project') } : {})}
      />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg">{main}</main>
      <AddProjectDialog
        client={client}
        open={dialog === 'add-project'}
        onClose={() => setDialog(null)}
        onAdded={(id) => {
          setDialog(null)
          refreshSoon()
          navigate({ view: 'project', id })
        }}
      />
      {sessionId !== null && (
        <ToTaskDialog
          client={client}
          sessionId={sessionId}
          projects={projects.filter((p) => !p.archived)}
          open={dialog === 'to-task'}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null)
            refreshSoon()
            navigate({ view: 'session', id, tab: 'chat' })
          }}
        />
      )}
    </div>
  )
}

const EMPTY = createSessionStore()
