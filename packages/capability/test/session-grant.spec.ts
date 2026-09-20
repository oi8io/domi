/**
 * 本会话内始终允许 —— PRD-M8-016 AC-1 / AC-2 / AC-3
 *
 * 授权只能把「要问」变成「允许」：越不过 deny，也越不过计划模式与父范围；
 * shell.exec / MCP / 插件工具不给这个选项；重开会话时从事件恢复。
 */
import { describe, expect, test } from 'bun:test'
import { grantable, grantFor, PermissionEngine, scopeOf } from '../src/index.ts'

const rules = [
  { name: 'ask-write', capability: 'fs.write', decision: 'ask' as const },
  { name: 'ask-shell', capability: 'shell.exec', decision: 'ask' as const },
  { name: 'deny-mcp', capability: 'mcp.github.*', decision: 'deny' as const },
]
const cwd = '/repo'

function engine(opts: { answers?: Array<{ allowed: boolean; grant?: boolean }> } = {}) {
  const asked: Array<{ capabilityId: string; grantable: boolean }> = []
  const answers = [...(opts.answers ?? [])]
  const e = new PermissionEngine({ rules, cwd }, async (capabilityId, _args, o) => {
    asked.push({ capabilityId, grantable: o?.grantable === true })
    const a = answers.shift() ?? { allowed: true }
    return { allowed: a.allowed, ...(a.grant === undefined ? {} : { grant: a.grant }) }
  })
  return { e, asked }
}

describe('PRD-M8-016 AC-1 · 同一能力、同一目录之后自动允许', () => {
  test('答了「本会话始终允许」之后，同目录及子目录的写不再问', async () => {
    const { e, asked } = engine({ answers: [{ allowed: true, grant: true }] })
    const first = await e.check('fs.write', { path: '/repo/src/a.ts' })
    expect(first).toMatchObject({ decision: 'allow', source: 'user' })
    expect(first.grant).toMatchObject({ capability: 'fs.write', scope: '/repo/src' })

    const again = await e.check('fs.write', { path: '/repo/src/b.ts' })
    expect(again).toMatchObject({ decision: 'allow', source: 'session-grant' })
    expect(asked).toHaveLength(1)
  })

  test('别的目录仍然要问', async () => {
    const { e, asked } = engine({ answers: [{ allowed: true, grant: true }, { allowed: true }] })
    await e.check('fs.write', { path: '/repo/src/a.ts' })
    const other = await e.check('fs.write', { path: '/repo/docs/x.md' })
    expect(other.source).toBe('user')
    expect(asked).toHaveLength(2)
  })

  test('只答「允许这一次」不留授权', async () => {
    const { e, asked } = engine({ answers: [{ allowed: true }, { allowed: true }] })
    await e.check('fs.write', { path: '/repo/src/a.ts' })
    await e.check('fs.write', { path: '/repo/src/a.ts' })
    expect(asked).toHaveLength(2)
  })
})

describe('PRD-M8-016 AC-2 · 越不过 deny，也不改变别的层', () => {
  test('规则是 deny 的，压根不会问，更不会有授权', async () => {
    const { e, asked } = engine()
    expect(await e.check('mcp.github.issue', {})).toMatchObject({ decision: 'deny', source: 'config' })
    expect(asked).toHaveLength(0)
  })

  test('计划模式里写操作照旧被拒（授权不越过模式范围）', async () => {
    const asked: string[] = []
    const e = new PermissionEngine({ rules, cwd, mode: () => 'plan' }, async (c) => {
      asked.push(c)
      return { allowed: true, grant: true }
    })
    expect(await e.check('fs.write', { path: '/repo/a.ts' })).toMatchObject({ decision: 'deny', source: 'mode' })
    expect(asked).toEqual([])
  })

  test('父范围之外的能力也一样（子 agent）', async () => {
    const e = new PermissionEngine({ rules, cwd, scope: scopeOf(['fs.read']) }, async () => ({
      allowed: true,
      grant: true,
    }))
    expect(await e.check('fs.write', { path: '/repo/a.ts' })).toMatchObject({ decision: 'deny', source: 'default' })
  })

  test('没有人可问时仍然是拒绝，不是放行', async () => {
    const e = new PermissionEngine({ rules, cwd })
    expect(await e.check('fs.write', { path: '/repo/a.ts' })).toMatchObject({ decision: 'deny', source: 'default' })
  })
})

describe('PRD-M8-016 AC-3 · 哪些能力不给这个选项', () => {
  test('shell.exec、MCP、插件工具都不可授权', () => {
    expect(grantable('fs.write')).toBe(true)
    expect(grantable('fs.read')).toBe(true)
    expect(grantable('shell.exec')).toBe(true)
    expect(grantable('mcp.github.issue')).toBe(false)
    expect(grantable('plugin.word-count.count')).toBe(false)
    expect(grantFor('shell.exec', { cmd: 'rm' }, cwd)).toBeNull()
  })

  test('询问时如实告诉客户端这次能不能授权', async () => {
    const { e, asked } = engine({ answers: [{ allowed: true }, { allowed: true }] })
    await e.check('fs.write', { path: '/repo/a.ts' })
    await e.check('shell.exec', { cmd: 'git status' })
    expect(asked).toEqual([
      { capabilityId: 'fs.write', grantable: true },
      { capabilityId: 'shell.exec', grantable: true },
    ])
  })

  test('路径类的授权范围是所在目录；没有路径的能力按能力本身', () => {
    expect(grantFor('fs.write', { path: '/repo/src/a.ts' }, cwd)).toEqual({
      capability: 'fs.write',
      scope: '/repo/src',
    })
    expect(grantFor('fs.write', { path: 'src/a.ts' }, cwd)).toEqual({ capability: 'fs.write', scope: '/repo/src' })
    expect(grantFor('memory.recall', {}, cwd)).toEqual({ capability: 'memory.recall' })
  })

  test('重开会话时从事件恢复授权', async () => {
    const asked: string[] = []
    const e = new PermissionEngine({ rules, cwd }, async (c) => {
      asked.push(c)
      return { allowed: true }
    })
    e.restoreGrants([{ capability: 'fs.write', scope: '/repo/src' }])
    expect(await e.check('fs.write', { path: '/repo/src/a.ts' })).toMatchObject({ source: 'session-grant' })
    expect(asked).toEqual([])
  })
})
