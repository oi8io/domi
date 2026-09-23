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
    { name: 'gh-all', capability: 'memo.gh.*', decision: 'ask' as const },
    { name: 'gh-read', capability: 'memo.gh.search', decision: 'allow' as const },
    { name: 'mcp-deny', capability: 'memo.*', decision: 'deny' as const },
  ]

  test('精确规则优先于通配', async () => {
    const d = await new PermissionEngine({ rules }).check('memo.gh.search', {})
    expect(d).toEqual({ decision: 'allow', source: 'config', matchedRule: 'gh-read' })
  })

  test('没有精确规则时，取前缀最长的通配', async () => {
    const d = await new PermissionEngine({ rules }, async () => true).check('memo.gh.create', {})
    expect(d).toEqual({ decision: 'allow', source: 'user', matchedRule: 'gh-all' })
  })

  test('更短的通配兜底', async () => {
    const d = await new PermissionEngine({ rules }).check('memo.slack.post', {})
    expect(d).toEqual({ decision: 'deny', source: 'config', matchedRule: 'mcp-deny' })
  })

  test('通配只按「.」分段匹配：memo.git.* 管不到 mcp.github.x', async () => {
    const d = await new PermissionEngine({
      rules: [{ name: 'git', capability: 'memo.git.*', decision: 'allow' }],
    }).check('memo.gh.search', {})
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

describe('PRD-M11-005 · 会话级审核档位（SPEC-M11-004）', () => {
  test('默认（不配置 reviewMode）= on-demand = 现状 fail-closed：非危险无规则仍 deny', async () => {
    const d = await new PermissionEngine().check('fs.read', {})
    expect(d.decision).toBe('deny')
  })

  test('on-demand：非危险无规则 deny（现状，回归基准）', async () => {
    const d = await new PermissionEngine({ reviewMode: () => 'on-demand' as const }).check('fs.read', {})
    expect(d.decision).toBe('deny')
  })

  test('always-ask：非危险无规则 → 问人', async () => {
    let asked = 0
    const e = new PermissionEngine({ reviewMode: () => 'always-ask' as const }, async () => {
      asked++
      return true
    })
    const d = await e.check('fs.read', {})
    expect(asked).toBe(1)
    expect(d.decision).toBe('allow')
  })

  test('allow-all：非危险无规则 → 自动放行', async () => {
    const d = await new PermissionEngine({ reviewMode: () => 'allow-all' as const }).check('fs.read', {})
    expect(d.decision).toBe('allow')
  })

  // PRD-M12-002 回写（2026-09-23 用户拍板）：全部放行 = 跳过所有确认，同 Claude 的 skip all approvals。
  // 只剩两道线：用户自己写的 deny 规则、子 agent 的父范围——那是「不许做」，不是「要不要问」。
  test('allow-all：危险能力无规则也直接放行，不问人（source: mode）', async () => {
    let asked = 0
    const e = new PermissionEngine({ reviewMode: () => 'allow-all' as const }, async () => {
      asked++
      return false
    })
    for (const id of ['shell.exec', 'fs.write', 'fs.delete', 'web.fetch', 'mcp.github.search']) {
      const d = await e.check(id, { cmd: 'rm -rf build' })
      expect(d).toMatchObject({ decision: 'allow', source: 'mode' })
    }
    expect(asked).toBe(0)
  })

  test('allow-all：规则 ask 与 askAlways 收紧也不再问', async () => {
    let asked = 0
    const e = new PermissionEngine(
      {
        rules: [{ name: 'ask-write', capability: 'fs.write', decision: 'ask' }],
        askAlways: (c) => c === 'shell.exec',
        reviewMode: () => 'allow-all' as const,
      },
      async () => {
        asked++
        return false
      },
    )
    expect(await e.check('fs.write', { path: 'a' })).toMatchObject({
      decision: 'allow',
      source: 'mode',
      matchedRule: 'ask-write',
    })
    expect(await e.check('shell.exec', { cmd: 'ls' })).toMatchObject({ decision: 'allow', source: 'mode' })
    expect(asked).toBe(0)
  })

  test('allow-all：用户显式写的 deny 规则仍然拒', async () => {
    const e = new PermissionEngine({
      rules: [{ name: 'no-mcp', capability: 'mcp.github.*', decision: 'deny' }],
      reviewMode: () => 'allow-all' as const,
    })
    expect(await e.check('mcp.github.push', {})).toMatchObject({
      decision: 'deny',
      source: 'config',
      matchedRule: 'no-mcp',
    })
  })

  test('allow-all：子 agent 的父范围仍然拦（AC-5 / INV-03）', async () => {
    const e = new PermissionEngine({ scope: (c) => c === 'fs.read', reviewMode: () => 'allow-all' as const })
    expect((await e.check('shell.exec', { cmd: 'ls' })).decision).toBe('deny')
  })

  test('always-ask：危险能力即使规则 allow 也收紧到 ask——AC-2/INV-03', async () => {
    let asked = 0
    const e = new PermissionEngine(
      { rules: [{ name: 'r', capability: 'fs.delete', decision: 'allow' }], reviewMode: () => 'always-ask' as const },
      async () => {
        asked++
        return false
      },
    )
    const d = await e.check('fs.delete', {})
    expect(asked).toBe(1)
    expect(d.decision).toBe('deny')
  })

  test('on-demand：用户显式写的 allow 规则算数，危险能力也直接放行（2026-09-23 回写）', async () => {
    let asked = 0
    const e = new PermissionEngine(
      { rules: [{ name: 'w', capability: 'fs.write', decision: 'allow' }], reviewMode: () => 'on-demand' as const },
      async () => {
        asked++
        return false
      },
    )
    expect(await e.check('fs.write', { path: 'a' })).toMatchObject({
      decision: 'allow',
      source: 'config',
      matchedRule: 'w',
    })
    expect(asked).toBe(0)
  })

  test('on-demand：危险能力没写规则仍拒（fail-closed），规则 ask 仍问', async () => {
    let asked = 0
    const e = new PermissionEngine(
      { rules: [{ name: 'a', capability: 'shell.exec', decision: 'ask' }], reviewMode: () => 'on-demand' as const },
      async () => {
        asked++
        return true
      },
    )
    expect((await e.check('fs.delete', {})).decision).toBe('deny')
    expect(await e.check('shell.exec', { cmd: 'ls' })).toMatchObject({ decision: 'allow', source: 'user' })
    expect(asked).toBe(1)
  })
})
