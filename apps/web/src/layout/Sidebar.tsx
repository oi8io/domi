/**
 * 侧栏 —— PRD-M8-002 · SPEC-M8-002
 * 自上而下：品牌 → 新对话 → 新任务 / 定时任务 → 项目树 → 会话（只放自由会话）→ 设置。
 */

import type { ConnectionState } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { type ReactNode, useState } from 'react'
import { StatusDot } from '../components/StatusDot.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  IconArrowUpRight,
  IconCalendar,
  IconChevron,
  IconClock,
  IconFolder,
  IconFolderPlus,
  IconGear,
  IconList,
  IconPencil,
  IconPlus,
} from '../icons.tsx'
import { cn } from '../lib/cn.ts'
import { formatRoute, type Route } from '../router.ts'
import { dotOf, loadSet, type ProjectRow, type SessionRow, saveSet, titleOf } from './data.ts'

export const RECENT_TASKS = 5
export const RECENT_CHATS = 10
const COLLAPSED_KEY = 'domi.sidebar.collapsed'
const EXPANDED_KEY = 'domi.sidebar.expanded'

export const STATE_LABEL = (): Record<ConnectionState, string> => ({
  idle: tr('web.conn.offline'),
  connecting: tr('web.conn.connecting'),
  open: tr('web.conn.connected'),
  reconnecting: tr('web.conn.reconnecting'),
  incompatible: tr('web.conn.incompatible'),
  closed: tr('web.conn.closed'),
})

export interface SidebarProps {
  state: ConnectionState
  lastError: string | null
  daemonUrl?: string | undefined
  route: Route
  projects: readonly ProjectRow[]
  /** 项目接口还没有时为 false：项目栏显示说明而不是空列表 */
  projectsAvailable: boolean
  chats: readonly SessionRow[]
  active?: { id: string; busy: boolean; projectId?: string | undefined } | undefined
  onNewChat: () => void
  onAddProject?: () => void
}

function SectionHeader({
  title,
  collapsed,
  onToggle,
  actions,
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  actions: ReactNode
}) {
  return (
    <div className="group relative flex items-center px-3.5 py-2 hover:bg-panel-h">
      <button
        type="button"
        className="flex flex-1 items-center gap-1 text-left text-[13px] font-semibold"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {title}
        <IconChevron
          size={11}
          className={cn('text-mut2 transition-transform duration-150', collapsed && '-rotate-90')}
        />
      </button>
      <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {actions}
      </div>
    </div>
  )
}

function HeaderAction({
  href,
  title,
  onClick,
  disabled,
  children,
}: {
  href?: string
  title: string
  onClick?: (() => void) | undefined
  disabled?: boolean
  children: ReactNode
}) {
  const cls = 'grid size-6 place-items-center rounded-sm text-mut hover:bg-border hover:text-ink'
  if (href !== undefined && !disabled)
    return (
      <a href={href} className={cls} title={title} aria-label={title}>
        {children}
      </a>
    )
  return (
    <Button variant="icon" size="icon" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  )
}

export function ProjectNode({
  project,
  expanded,
  current,
  activeId,
  active,
  onToggle,
}: {
  project: ProjectRow
  expanded: boolean
  current: boolean
  activeId?: string | undefined
  active?: { id: string; busy: boolean } | undefined
  onToggle: () => void
}) {
  const detail = formatRoute({ view: 'project', id: project.id })
  const tasks = project.recentTasks.slice(0, RECENT_TASKS)
  return (
    <li data-project={project.id}>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-sm px-2.5 py-[5px] text-[13px] text-ink2 hover:bg-panel-h',
          current && 'font-medium text-accent',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
          title={project.path}
        >
          <IconFolder size={13} className={cn('shrink-0', current ? 'opacity-100' : 'opacity-60')} />
          <span className="truncate">{project.name}</span>
        </button>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <a
            href={detail}
            className="rounded-[3px] p-0.5 text-mut hover:bg-panel-h hover:text-accent"
            title={tr('web.sidebar.projectDetails')}
            aria-label={tr('web.sidebar.projectDetailsOf', { name: project.name })}
          >
            <IconArrowUpRight size={12} />
          </a>
          <a
            href={formatRoute({ view: 'project', id: project.id, create: true })}
            className="rounded-[3px] p-0.5 text-mut hover:bg-panel-h hover:text-accent"
            title={tr('web.sidebar.newTaskHere')}
            aria-label={tr('web.sidebar.newTaskIn', { name: project.name })}
          >
            <IconPencil size={12} />
          </a>
        </span>
      </div>
      {expanded && (
        <ul className="ml-[17px] border-l border-border2 pl-1.5">
          {tasks.map((t) => (
            <li key={t.id}>
              <a
                href={formatRoute({ view: 'session', id: t.id, tab: 'chat' })}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-[3px] text-[12.5px] text-ink2 hover:bg-panel-h',
                  activeId === t.id && 'bg-accent-d text-ink',
                )}
              >
                <StatusDot state={dotOf(t, active)} />
                <span className="truncate">{titleOf(t)}</span>
              </a>
            </li>
          ))}
          {tasks.length === 0 && <li className="px-2 py-[3px] text-[11.5px] text-mut2">{tr('web.sidebar.noTasks')}</li>}
          {project.taskCount > tasks.length && (
            <li>
              <a
                href={detail}
                className="block rounded-sm px-2 py-[3px] text-[11.5px] text-mut hover:bg-panel-h hover:text-accent"
              >
                {tr('web.sidebar.viewAllTasks', { taskCount: project.taskCount })}
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function Sidebar(props: SidebarProps) {
  const { state, lastError, route, projects, chats, active } = props
  const [collapsed, setCollapsed] = useState(() => loadSet(COLLAPSED_KEY))
  const [expanded, setExpanded] = useState(() => loadSet(EXPANDED_KEY))
  const toggle = (set: Set<string>, key: string, save: string, apply: (s: Set<string>) => void): void => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    saveSet(save, next)
    apply(next)
  }
  const online = state === 'open'
  const activeId = route.view === 'session' ? route.id : undefined
  const currentProject = route.view === 'project' ? route.id : activeId !== undefined ? active?.projectId : undefined

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-bg2">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <a href="#/" className="flex items-center gap-2 text-base font-bold">
          <span className="grid size-[26px] place-items-center rounded-[7px] bg-accent-e font-mono text-sm font-bold text-white">
            d
          </span>
          domi
        </a>
      </div>
      {!online && (
        <p className="mx-3 mb-2 flex items-center gap-1.5 text-xs text-mut" title={props.daemonUrl}>
          <span className="size-[7px] rounded-full bg-warn" />
          {STATE_LABEL()[state]}
        </p>
      )}
      {lastError !== null && (
        <div className="mx-3 mb-2">
          <p className="text-xs text-bad">{lastError}</p>
          <p className="text-[11px] text-mut">{tr('core.client.startDaemonHint')}</p>
        </div>
      )}

      <div className="flex flex-col gap-[5px] px-2.5 pb-2">
        <Button
          variant="primary"
          size="md"
          className="justify-start gap-2"
          disabled={!online}
          onClick={props.onNewChat}
        >
          <IconPlus size={15} />
          {tr('web.sidebar.newChat')}
        </Button>
        <div className="flex gap-[5px]">
          <a
            href={formatRoute({ view: 'tasks', create: true })}
            className="flex flex-1 items-center gap-1.5 rounded-sm border border-border px-2.5 py-[7px] text-[12.5px] text-ink2 hover:bg-panel-h"
          >
            <IconCalendar size={13} />
            {tr('common.newTask')}
          </a>
          <a
            href={formatRoute({ view: 'tasks', create: true, schedule: true })}
            className="flex flex-1 items-center gap-1.5 rounded-sm border border-border px-2.5 py-[7px] text-[12.5px] text-ink2 hover:bg-panel-h"
          >
            <IconClock size={13} />
            {tr('web.sidebar.schedules')}
          </a>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionHeader
          title={tr('web.sidebar.projects')}
          collapsed={collapsed.has('projects')}
          onToggle={() => toggle(collapsed, 'projects', COLLAPSED_KEY, setCollapsed)}
          actions={
            <>
              <HeaderAction
                title={tr('web.sidebar.addProject')}
                onClick={props.onAddProject}
                disabled={!props.projectsAvailable || props.onAddProject === undefined}
              >
                <IconFolderPlus size={13} />
              </HeaderAction>
              <HeaderAction title={tr('web.sidebar.createTask')} href={formatRoute({ view: 'tasks', create: true })}>
                <IconPlus size={14} />
              </HeaderAction>
              <HeaderAction title={tr('web.sidebar.allProjects')} href={formatRoute({ view: 'projects' })}>
                <IconList size={12} />
              </HeaderAction>
            </>
          }
        />
        {!collapsed.has('projects') && (
          <ul className="px-1.5 py-0.5">
            {projects.map((p) => (
              <ProjectNode
                key={p.id}
                project={p}
                current={currentProject === p.id}
                expanded={expanded.has(p.id) || (active?.projectId === p.id && activeId !== undefined)}
                activeId={activeId}
                active={active}
                onToggle={() => toggle(expanded, p.id, EXPANDED_KEY, setExpanded)}
              />
            ))}
            {projects.length === 0 && (
              <li className="px-2.5 py-1 text-[11.5px] text-mut2">
                {props.projectsAvailable ? tr('web.sidebar.noProjects') : tr('web.sidebar.projectsSoon')}
              </li>
            )}
          </ul>
        )}

        <SectionHeader
          title={tr('web.sidebar.chats')}
          collapsed={collapsed.has('sessions')}
          onToggle={() => toggle(collapsed, 'sessions', COLLAPSED_KEY, setCollapsed)}
          actions={
            <HeaderAction title={tr('web.sidebar.allChats')} href={formatRoute({ view: 'sessions' })}>
              <IconList size={12} />
            </HeaderAction>
          }
        />
        {!collapsed.has('sessions') && (
          <ul className="px-1.5 py-1" data-list="chats">
            {chats.slice(0, RECENT_CHATS).map((s) => (
              <li key={s.id}>
                <a
                  href={formatRoute({ view: 'session', id: s.id, tab: 'chat' })}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2.5 py-1.5 transition-colors duration-150 hover:bg-panel-h',
                    activeId === s.id && 'bg-accent-d',
                  )}
                  aria-current={activeId === s.id ? 'page' : undefined}
                >
                  <StatusDot state={dotOf(s, active)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{titleOf(s)}</span>
                    <span className="block truncate text-[11px] text-mut">
                      {tr('web.sidebar.chatMeta', {
                        model: s.model,
                        eventCount: s.eventCount,
                        v: s.parentId === undefined ? '' : tr('common.branchSuffix'),
                      })}
                    </span>
                  </span>
                </a>
              </li>
            ))}
            {chats.length === 0 && <li className="px-2.5 py-1 text-[11.5px] text-mut2">{tr('web.sidebar.noChats')}</li>}
            {chats.length > RECENT_CHATS && (
              <li>
                <a
                  href={formatRoute({ view: 'sessions' })}
                  className="block rounded-sm px-2.5 py-1 text-[11.5px] text-mut hover:bg-panel-h hover:text-accent"
                >
                  {tr('web.sidebar.viewAllChats', { length: chats.length })}
                </a>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-2 py-1.5">
        <a
          href={formatRoute({ view: 'settings', tab: 'general' })}
          className={cn(
            'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-[13px] text-ink2 hover:bg-panel-h',
            route.view === 'settings' && 'bg-accent-d font-medium text-accent',
          )}
        >
          <IconGear size={14} className="opacity-70" />
          {tr('web.sidebar.settings')}
        </a>
      </div>
    </aside>
  )
}
