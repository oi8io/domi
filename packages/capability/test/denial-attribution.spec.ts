/**
 * BUG-M3-013 · 拒绝要说清楚是谁拒的
 *
 * 现场（2026-09-15，TUI）：模型调 memory.search，事件流里是
 *   🔑 memory.search → deny
 *   ← user_denied {"message":"用户拒绝了 memory.search。…"}
 * 但用户什么都没点——是配置里没有允许它的规则（从旧 TOML 迁过来的配置少了 allow-memory-search），
 * 按 fail-closed 默认拒绝。说成「用户拒绝了」有两个后果：
 *   - 用户看轨迹时以为自己误操作了
 *   - 模型会以为用户不想让它查，而不是「这台机器没开这个能力」，于是改走别的路或反复追问
 *
 * PRD-M0-003 AC-2 只规定**用户拒绝**时 reason 是 user_denied；规则拒绝与默认拒绝另用 permission_denied。
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { PermissionEngine, ToolRegistry } from '../src/index.ts'

const probe = {
  name: 'memory.search',
  capability: 'memory.search',
  description: '检索历史',
  schema: z.object({ query: z.string() }),
  execute: async () => ({ found: false }),
}

async function call(permissions: PermissionEngine) {
  const reg = new ToolRegistry({ cwd: '/tmp', permissions }).register(probe as never)
  return reg.run({ id: 'c1', name: 'memory.search', args: { query: 'x' } }, new AbortController().signal)
}

const text = (payload: unknown) => JSON.stringify(payload)

describe('BUG-M3-013 · 拒绝的归属', () => {
  test('没有任何规则 → permission_denied，并告诉模型这是配置没开、该去哪开', async () => {
    const r = await call(new PermissionEngine({ rules: [] }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('permission_denied')
    expect(text(r.payload)).not.toContain('用户拒绝')
    expect(text(r.payload)).toContain('没有')
    expect(text(r.payload)).toContain('permissions.rules')
    expect(text(r.payload)).toContain('memory.search')
  })

  test('规则明确 deny → permission_denied，带上规则名', async () => {
    const r = await call(
      new PermissionEngine({ rules: [{ name: 'no-history', capability: 'memory.search', decision: 'deny' }] }),
    )
    expect(r.reason).toBe('permission_denied')
    expect(text(r.payload)).toContain('no-history')
    expect(text(r.payload)).not.toContain('用户拒绝')
  })

  test('配置说要问、但没人可问 → permission_denied，说明原因', async () => {
    const r = await call(
      new PermissionEngine({ rules: [{ name: 'ask-history', capability: 'memory.search', decision: 'ask' }] }),
    )
    expect(r.reason).toBe('permission_denied')
    expect(text(r.payload)).toContain('没有人可以确认')
  })

  test('用户当场拒绝 → 仍是 user_denied（PRD-M0-003 AC-2 原样不动）', async () => {
    const r = await call(
      new PermissionEngine(
        { rules: [{ name: 'ask-history', capability: 'memory.search', decision: 'ask' }] },
        async () => false,
      ),
    )
    expect(r.reason).toBe('user_denied')
    expect(text(r.payload)).toContain('用户拒绝了 memory.search')
  })

  test('四种情况都叫模型别重试同一个调用', async () => {
    for (const engine of [
      new PermissionEngine({ rules: [] }),
      new PermissionEngine({ rules: [{ name: 'd', capability: 'memory.search', decision: 'deny' }] }),
      new PermissionEngine({ rules: [{ name: 'a', capability: 'memory.search', decision: 'ask' }] }, async () => false),
    ]) {
      expect(text((await call(engine)).payload)).toContain('不要重试同一个调用')
    }
  })
})
