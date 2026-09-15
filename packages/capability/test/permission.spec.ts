/**
 * PRD-M0-003 · 工具执行前需用户确认，默认拒绝（AC-3/AC-4）· INV-03
 */
import { describe, expect, test } from 'bun:test'
import { PermissionEngine } from '../src/index.ts'

describe('PRD-M0-003 AC-4 · fail-closed', () => {
  test('默认配置下 check 返回 deny，而不是 ask', async () => {
    const d = await new PermissionEngine().check('fs.write', {})
    expect(d.decision).toBe('deny')
    expect(d.source).toBe('default')
    expect(d.matchedRule).toBeNull()
  })

  test('未在配置里声明的能力，直接拒且不询问', async () => {
    let asked = 0
    const e = new PermissionEngine({ rules: [{ name: 'r', capability: 'fs.read', decision: 'allow' }] }, async () => {
      asked++
      return true
    })
    expect((await e.check('shell.exec', {})).decision).toBe('deny')
    expect(asked).toBe(0)
  })

  test('配置说 ask 但没有可问的人时，仍然拒绝而不是放行', async () => {
    const e = new PermissionEngine({ rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] })
    const d = await e.check('fs.write', {})
    expect(d.decision).toBe('deny')
    expect(d.matchedRule).toBe('confirm-write')
  })
})

describe('PRD-M0-003 AC-3 · 决策四字段齐全且来源可区分', () => {
  test('config 放行', async () => {
    const e = new PermissionEngine({ rules: [{ name: 'allow-read', capability: 'fs.read', decision: 'allow' }] })
    expect(await e.check('fs.read', {})).toEqual({ decision: 'allow', source: 'config', matchedRule: 'allow-read' })
  })

  test('用户当场同意 / 拒绝，source 都是 user', async () => {
    const rules = [{ name: 'confirm-write', capability: 'fs.write' as const, decision: 'ask' as const }]
    const yes = new PermissionEngine({ rules }, async () => true)
    const no = new PermissionEngine({ rules }, async () => false)
    expect(await yes.check('fs.write', {})).toEqual({ decision: 'allow', source: 'user', matchedRule: 'confirm-write' })
    expect(await no.check('fs.write', {})).toEqual({ decision: 'deny', source: 'user', matchedRule: 'confirm-write' })
  })

  test('询问时能拿到参数，确认框才能显示「要写什么」（AC-1 的前提）', async () => {
    const seen: unknown[] = []
    const e = new PermissionEngine(
      { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
      async (_cap, args) => {
        seen.push(args)
        return true
      },
    )
    await e.check('fs.write', { path: 'a.txt', content: 'hello' })
    expect(seen[0]).toEqual({ path: 'a.txt', content: 'hello' })
  })
})

describe('通配规则 `前缀.*` —— 一条规则管住一整个 MCP server（ADR-015）', () => {
  const rules = [
    { name: 'gh-all', capability: 'mcp.github.*', decision: 'ask' as const },
    { name: 'gh-read', capability: 'mcp.github.search', decision: 'allow' as const },
    { name: 'mcp-deny', capability: 'mcp.*', decision: 'deny' as const },
  ]

  test('精确规则优先于通配', async () => {
    const d = await new PermissionEngine({ rules }).check('mcp.github.search', {})
    expect(d).toEqual({ decision: 'allow', source: 'config', matchedRule: 'gh-read' })
  })

  test('没有精确规则时，取前缀最长的通配', async () => {
    const d = await new PermissionEngine({ rules }, async () => true).check('mcp.github.create_issue', {})
    expect(d).toEqual({ decision: 'allow', source: 'user', matchedRule: 'gh-all' })
  })

  test('更短的通配兜底', async () => {
    const d = await new PermissionEngine({ rules }).check('mcp.slack.post', {})
    expect(d).toEqual({ decision: 'deny', source: 'config', matchedRule: 'mcp-deny' })
  })

  test('通配只按「.」分段匹配：mcp.git.* 管不到 mcp.github.x', async () => {
    const d = await new PermissionEngine({
      rules: [{ name: 'git', capability: 'mcp.git.*', decision: 'allow' }],
    }).check('mcp.github.search', {})
    expect(d).toEqual({ decision: 'deny', source: 'default', matchedRule: null })
  })

  test('单独一个 * 不是「全部放行」—— 不支持，按没有规则处理', async () => {
    const d = await new PermissionEngine({ rules: [{ name: 'all', capability: '*', decision: 'allow' }] }).check(
      'shell.exec',
      {},
    )
    expect(d.decision).toBe('deny')
  })
})
