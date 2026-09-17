/**
 * Web 端的壳 —— PRD-M8-002（原型 .shell：260px 侧栏 + 主区）。
 *
 * 视图由 hash 路由决定；会话的订阅跟着路由走。**只渲染**：
 * 状态全在 client-core 的 atom 里，这个文件里没有一行是在算「事件意味着什么」（INV-04）。
 * 与 TUI 的逐项对等见 docs/parity-checklist.md。
 */
import { createSessionStore, type DomiClient, type SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import type { ProjectRow, SessionRow } from './layout/data.ts'
import { Sidebar } from './layout/Sidebar.tsx'
import type { PendingRef } from './PendingRefs.tsx'
import { $route, navigate, type Route } from './router.ts'
import { SessionView } from './session/SessionView.tsx'
import { HomeView } from './views/HomeView.tsx'
import { ProjectsView, ProjectView } from './views/ProjectsView.tsx'
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
  // 项目接口（TASK-M8-004）落地前一直是空的
  const [projects] = useState<ProjectRow[]>([])
  const projectsAvailable = false
  // 跨会话引用：在哪个会话里点的都攒在这里，切到别的会话发送时带上（PRD-M3-005）
  const [refs, setRefs] = useState<PendingRef[]>([])

  useEffect(() => {
    client.start().catch(() => undefined)
    return () => client.close()
  }, [client])

  const refresh = useCallback(async (): Promise<void> => {
    const r = await client.listSessions({ includeDeleted: showDeleted })
    setSessions(r.sessions as SessionRow[])
  }, [client, showDeleted])

  useEffect(() => {
    if (!online) return
    refresh().catch(() => undefined)
  }, [online, refresh])

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
  const activeRow = sessions.find((s) => s.id === sessionId)

  const chats = sessions.filter((s) => !s.deleted && s.kind !== 'task')
  const opened = (): void => {
    refresh().catch(() => undefined)
  }

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
            tab={route.tab}
            connection={state}
            onDeleted={() => {
              refresh().catch(() => undefined)
              navigate({ view: 'home' })
            }}
            onBranched={(id) => {
              opened()
              navigate({ view: 'session', id, tab: 'chat' })
            }}
            refs={refs}
            onRefsChange={setRefs}
          />
        ) : (
          <p className="m-auto text-[13px] text-mut">{online ? '正在打开会话…' : '连上 daemon 后打开会话。'}</p>
        )
      break
    case 'project':
      main = <ProjectView project={projects.find((p) => p.id === route.id)} available={projectsAvailable} />
      break
    case 'projects':
      main = <ProjectsView projects={projects} available={projectsAvailable} />
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
          {...(active === null ? {} : { active: { id: active.id, busy: activeStatus.busy } })}
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
          onCreated={opened}
        />
      )
      break
    case 'settings':
      main = <SettingsView client={client} tab={route.tab} online={online} />
      break
    default:
      main = <HomeView client={client} online={online} recent={chats} onCreated={opened} />
  }

  return (
    <div className="grid h-screen grid-cols-[var(--sidebar-w)_1fr] overflow-hidden">
      <Sidebar
        state={state}
        lastError={lastError}
        daemonUrl={daemonUrl}
        route={route}
        projects={projects}
        projectsAvailable={projectsAvailable}
        chats={chats}
        active={
          active === null || sessionId === null
            ? undefined
            : { id: active.id, busy: activeStatus.busy, projectId: activeRow?.projectId }
        }
        onNewChat={() => navigate({ view: 'home' })}
      />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg">{main}</main>
    </div>
  )
}

const EMPTY = createSessionStore()
