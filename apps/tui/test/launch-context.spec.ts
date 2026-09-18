/**
 * TUI 启动上下文的端上那一半 —— PRD-M8-017 AC-2
 *
 * `--chat` / `-p` 的参数表，以及 `-p` 的值怎么落到项目 id 上（名字 → 路径 → 相近的名字）。
 * 目录判断那一半在 daemon（packages/daemon/test/launch-context.spec.ts）。
 */
import { describe, expect, test } from 'bun:test'
import { parseCli } from '@domi/cli'
import { editDistance, findProject, ProjectArgError } from '../src/connect.ts'

describe('PRD-M8-017 AC-2 · --chat 与 -p', () => {
  test('参数表认得 --chat 与 -p / --in', () => {
    expect(parseCli(['--chat']).flags.chat).toBe(true)
    expect(parseCli(['-p', 'domi']).flags.inProject).toBe('domi')
    expect(parseCli(['--in', '~/Develop/domi']).flags.inProject).toBe('~/Develop/domi')
    expect(parseCli([]).flags.chat).toBe(false)
    expect(parseCli([]).flags.inProject).toBeUndefined()
  })

  test('-p 按名字精确匹配；重名时要求给路径', async () => {
    const client = {
      listProjects: async () => [
        { id: 'p1', name: 'domi', path: '/a/domi' },
        { id: 'p2', name: 'iCleaner', path: '/a/cleaner' },
      ],
      createProject: async () => ({ id: 'new' }),
      resolveProject: async () => ({ project: null, root: '/x', projectLike: true }),
    } as never
    expect(await findProject(client, 'domi', '/cwd')).toBe('p1')
    const dup = {
      listProjects: async () => [
        { id: 'p1', name: 'domi', path: '/a/domi' },
        { id: 'p2', name: 'domi', path: '/b/domi' },
      ],
    } as never
    await expect(findProject(dup, 'domi', '/cwd')).rejects.toThrow(/都叫/)
  })

  test('-p 给路径：已登记就用它，没登记就登记一个', async () => {
    const calls: string[] = []
    const client = {
      listProjects: async () => [],
      resolveProject: async (path: string) => {
        calls.push(path)
        return { project: null, root: '/a/new', projectLike: true }
      },
      createProject: async (root: string) => {
        calls.push(`create:${root}`)
        return { id: 'made' }
      },
    } as never
    expect(await findProject(client, './sub', '/cwd')).toBe('made')
    expect(calls).toEqual(['/cwd/./sub', 'create:/a/new'])
  })

  test('项目不存在时如实报错，并列出相近的名字', async () => {
    const client = {
      listProjects: async () => [
        { id: 'p1', name: 'domi', path: '/a/domi' },
        { id: 'p2', name: 'iCleaner', path: '/a/cleaner' },
      ],
    } as never
    let err: ProjectArgError | null = null
    try {
      await findProject(client, 'domo', '/cwd')
    } catch (e) {
      err = e as ProjectArgError
    }
    expect(err).toBeInstanceOf(ProjectArgError)
    expect(err?.message).toContain('是不是：domi')
    expect(editDistance('domi', 'domo')).toBe(1)
    expect(editDistance('domi', 'iCleaner')).toBeGreaterThan(3)
  })
})
