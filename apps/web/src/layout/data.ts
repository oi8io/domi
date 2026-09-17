/**
 * 侧栏与列表页用到的行数据。字段来自 daemon（session.list / project.list）；
 * 项目、kind、未读等字段要等 TASK-M8-004 / 005 / 010 的协议落地，在那之前都是可选的，缺了就按「没有」显示。
 */
import type { DotState } from '../components/StatusDot.tsx'

export interface SessionRow {
  id: string
  title: string
  model: string
  eventCount: number
  deleted: boolean
  updatedAt?: number
  parentId?: string | undefined
  kind?: 'chat' | 'task' | undefined
  projectId?: string | undefined
  cwd?: string | undefined
  busy?: boolean | undefined
  unread?: boolean | undefined
}

export interface ProjectTaskRow {
  id: string
  title: string
  busy?: boolean | undefined
  unread?: boolean | undefined
}

export interface ProjectRow {
  id: string
  name: string
  path: string
  taskCount: number
  archived?: boolean
  lastActivity?: number | null
  settings?: { isolation: 'auto' | 'always' | 'never'; planReview: 'auto' | 'always' | 'never' }
  recentTasks: ProjectTaskRow[]
}

/** 状态点：正在看的会话以本地 store 的 busy 为准（它比列表新） */
export function dotOf(
  row: { id: string; busy?: boolean | undefined; unread?: boolean | undefined },
  active?: { id: string; busy: boolean },
): DotState {
  const busy = active?.id === row.id ? active.busy : row.busy === true
  if (busy) return 'running'
  if (row.unread === true && active?.id !== row.id) return 'unread'
  return 'idle'
}

export function titleOf(row: { id: string; title: string }): string {
  return row.title.trim() === '' ? row.id : row.title
}

/** 侧栏展开 / 折叠状态的持久化（localStorage，读写失败就只在本次生效） */
export function loadSet(key: string): Set<string> {
  try {
    const v = globalThis.localStorage?.getItem(key)
    return new Set(v ? (JSON.parse(v) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function saveSet(key: string, set: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([...set]))
  } catch {
    // 忽略
  }
}
