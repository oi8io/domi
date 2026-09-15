/**
 * 权限引擎 —— PRD-M0-003 · SPEC-M0-005 · INV-03
 *
 * **默认分支返回 deny，不是 ask。**
 * ask 看起来更友好，实际上是把"没想过的能力"变成"弹个窗让用户点同意"——
 * 用户点第三次之后就不看内容了。fail-closed 的意思是：没显式声明过的，直接拒。
 */
import type { CapabilityId, Decision } from './types.ts'

export interface PermissionRule {
  /** 规则名，会原样进事件的 matchedRule，便于事后审计"是哪条放行的" */
  name: string
  capability: CapabilityId
  decision: 'allow' | 'deny' | 'ask'
}

export interface PermissionConfig {
  rules?: PermissionRule[]
  /**
   * 范围（M5-001 · INV-03）：子 agent 只能用父会话允许它用的能力。返回 false 的能力直接拒绝，
   * 不看规则、不问人——范围是「能不能提」，规则是「提了之后怎么办」
   */
  scope?: (capabilityId: CapabilityId) => boolean
}

/** 交互式回答的来源；TUI 的确认框实现它。channel 是用户在哪个端上回答的 */
export type Asker = (
  capabilityId: CapabilityId,
  args: unknown,
) => Promise<boolean | { allowed: boolean; channel?: string }>

/** 子 agent 被父范围拦下时 matchedRule 的值 */
export const PARENT_SCOPE_RULE = 'parent-scope'

/** 能力清单 → 范围函数。清单里可以写 `mcp.github.*` 这样的前缀 */
export function scopeOf(
  allowed: readonly string[],
  parent?: (c: CapabilityId) => boolean,
): (c: CapabilityId) => boolean {
  const rules = allowed.map((capability) => ({ name: capability, capability, decision: 'allow' as const }))
  return (c) => (parent ? parent(c) : true) && findRule(rules, c) !== undefined
}

export class PermissionEngine {
  constructor(
    private readonly config: PermissionConfig = {},
    private readonly ask?: Asker,
  ) {}

  async check(capabilityId: CapabilityId, args: unknown): Promise<Decision> {
    if (this.config.scope && !this.config.scope(capabilityId)) {
      return { decision: 'deny', source: 'default', matchedRule: PARENT_SCOPE_RULE }
    }
    const rule = findRule(this.config.rules ?? [], capabilityId)

    if (!rule) {
      // 没有任何规则提到它 —— fail-closed（AC-4）
      return { decision: 'deny', source: 'default', matchedRule: null }
    }
    if (rule.decision !== 'ask') {
      return { decision: rule.decision, source: 'config', matchedRule: rule.name }
    }
    if (!this.ask) {
      // 配置说要问，但没有人可问（比如非交互环境）——同样拒绝，不是放行
      return { decision: 'deny', source: 'default', matchedRule: rule.name }
    }
    const answer = await this.ask(capabilityId, args)
    const allowed = typeof answer === 'boolean' ? answer : answer.allowed
    const channel = typeof answer === 'boolean' ? undefined : answer.channel
    return {
      decision: allowed ? 'allow' : 'deny',
      source: 'user',
      matchedRule: rule.name,
      ...(channel === undefined ? {} : { channel }),
    }
  }
}

/**
 * 找规则：精确匹配优先；没有的话取前缀最长的 `前缀.*` 通配（按「.」分段，`mcp.git.*` 管不到 `mcp.github.x`）。
 * 单独一个 `*` 不认——「全部放行」不该是一条规则能表达的东西（INV-03）。
 */
export function findRule(rules: readonly PermissionRule[], capabilityId: string): PermissionRule | undefined {
  const exact = rules.find((r) => r.capability === capabilityId)
  if (exact) return exact
  let best: PermissionRule | undefined
  let bestLen = -1
  for (const r of rules) {
    if (!r.capability.endsWith('.*')) continue
    const prefix = r.capability.slice(0, -1) // 保留末尾的「.」
    if (prefix.length > 1 && capabilityId.startsWith(prefix) && prefix.length > bestLen) {
      best = r
      bestLen = prefix.length
    }
  }
  return best
}
