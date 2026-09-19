/**
 * hash 路由 —— PRD-M8-002 AC-2 · SPEC-M8-002 · 取舍-11
 *
 * 视图完全由 location.hash 决定：刷新、前进后退都回到同一视图。
 * parseHash / formatRoute 是纯函数，测试直接调。
 */
import { atom } from 'nanostores'

export const SETTINGS_TABS = [
  'general',
  'models',
  'messaging',
  'memory',
  'soul',
  'plugins',
  'usage',
  'runtime',
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export type Route =
  | { view: 'home' }
  | { view: 'session'; id: string; tab: 'chat' | 'trajectory' }
  | { view: 'project'; id: string; create?: boolean }
  | { view: 'projects' }
  | { view: 'sessions' }
  | { view: 'tasks'; runId?: string; create?: boolean; schedule?: boolean; projectId?: string }
  | { view: 'settings'; tab: SettingsTab }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [path = '', query = ''] = raw.split('?')
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const [head, a, b] = parts
  switch (head) {
    case 's':
      if (a) return { view: 'session', id: a, tab: b === 'trajectory' ? 'trajectory' : 'chat' }
      break
    case 'p':
      if (a) return params.get('new') === '1' ? { view: 'project', id: a, create: true } : { view: 'project', id: a }
      break
    case 'projects':
      return { view: 'projects' }
    case 'sessions':
      return { view: 'sessions' }
    case 'tasks':
      if (a === 'new') {
        const projectId = params.get('project')
        return {
          view: 'tasks',
          create: true,
          schedule: params.get('schedule') === '1',
          ...(projectId ? { projectId } : {}),
        }
      }
      return a ? { view: 'tasks', runId: a } : { view: 'tasks' }
    case 'settings': {
      const tab = SETTINGS_TABS.find((t) => t === a) ?? 'general'
      return { view: 'settings', tab }
    }
  }
  return { view: 'home' }
}

export function formatRoute(r: Route): string {
  const e = encodeURIComponent
  switch (r.view) {
    case 'home':
      return '#/'
    case 'session':
      return `#/s/${e(r.id)}${r.tab === 'trajectory' ? '/trajectory' : ''}`
    case 'project':
      return `#/p/${e(r.id)}${r.create ? '?new=1' : ''}`
    case 'projects':
      return '#/projects'
    case 'sessions':
      return '#/sessions'
    case 'tasks':
      if (r.create) {
        const q = new URLSearchParams()
        if (r.schedule) q.set('schedule', '1')
        if (r.projectId) q.set('project', r.projectId)
        const qs = q.toString()
        return `#/tasks/new${qs === '' ? '' : `?${qs}`}`
      }
      return r.runId ? `#/tasks/${e(r.runId)}` : '#/tasks'
    case 'settings':
      return `#/settings/${r.tab}`
  }
}

const initial = typeof location === 'undefined' ? '' : location.hash
export const $route = atom<Route>(parseHash(initial))

export function navigate(r: Route): void {
  const hash = formatRoute(r)
  if (typeof location !== 'undefined' && location.hash !== hash) location.hash = hash
  else $route.set(r)
}

/** 浏览器里调一次 */
export function startRouter(): () => void {
  const on = (): void => $route.set(parseHash(location.hash))
  addEventListener('hashchange', on)
  on()
  return () => removeEventListener('hashchange', on)
}
