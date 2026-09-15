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
}

/** 交互式回答的来源；TUI 的确认框实现它 */
export type Asker = (capabilityId: CapabilityId, args: unknown) => Promise<boolean>

export class PermissionEngine {
  constructor(
    private readonly config: PermissionConfig = {},
    private readonly ask?: Asker,
  ) {}

  async check(capabilityId: CapabilityId, args: unknown): Promise<Decision> {
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
    const allowed = await this.ask(capabilityId, args)
    return { decision: allowed ? 'allow' : 'deny', source: 'user', matchedRule: rule.name }
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
