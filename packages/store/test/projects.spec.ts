/**
 * PRD-M10-001 AC-2 · 项目展开列表（recentTasks）空标题 fallback first_input
 *
 * session.list 的空标题回退（first_input 派生列）在 M10-001 已落地；项目展开的 recentTasks
 * 走的是另一条 SQL（projects.ts 的 recentQ），必须给同样口径，否则侧栏项目展开后任务行没有标题。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteEventLog } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function log(now = 1_756_000_000_000): SqliteEventLog {
  const d = mkdtempSync(join(tmpdir(), 'domi-proj-'))
  dirs.push(d)
  let t = now
  return new SqliteEventLog({ path: join(d, 'e.db'), cwd: '/tmp/work', clock: { now: () => (t += 1000) } })
}

describe('PRD-M10-001 AC-2 · recentTasks 空标题 fallback first_input', () => {
  const LONG = '帮我把这个项目里所有用到旧版配置格式的地方都找出来并且逐个迁移到新格式上去，注意保持向后兼容'

  test('空标题任务返回首条 user.input 前 40 字', async () => {
    const l = log()
    l.projects.insert({ id: 'proj1', name: 'domi', path: '/tmp/work', createdAt: 1 })
    await l.append('a', [
      { t: 'user.input', text: LONG },
      { t: 'model.delta', text: 'ok' },
    ])
    l.sessions.setKind('a', 'task', 'proj1')
    const p = l.projects.list({ recent: 5 }).find((x) => x.id === 'proj1')!
    expect(p.recentTasks[0]).toMatchObject({ id: 'a', title: '', firstInput: LONG.slice(0, 40) })
    l.close()
  })

  test('有标题时 title 原样，firstInput 不受影响', async () => {
    const l = log()
    l.projects.insert({ id: 'proj1', name: 'domi', path: '/tmp/work', createdAt: 1 })
    await l.append('a', [
      { t: 'user.input', text: '输入' },
      { t: 'model.delta', text: 'ok' },
    ])
    l.sessions.setKind('a', 'task', 'proj1')
    l.sessions.setTitle('a', '手动标题')
    const p = l.projects.list({ recent: 5 }).find((x) => x.id === 'proj1')!
    expect(p.recentTasks[0]).toMatchObject({ id: 'a', title: '手动标题', firstInput: '输入' })
    l.close()
  })
})
