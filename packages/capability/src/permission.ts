/**
 * 权限引擎 —— PRD-M0-003 · SPEC-M0-005 · INV-03
 *
 * **默认分支返回 deny，不是 ask。**
 * ask 看起来更友好，实际上是把"没想过的能力"变成"弹个窗让用户点同意"——
 * 用户点第三次之后就不看内容了。fail-closed 的意思是：没显式声明过的，直接拒。
 */
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { commandFingerprint, isDangerous, type ReviewMode } from './dangerous.ts'
import type { CapabilityId, Decision, SessionGrant } from './types.ts'

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
  /**
   * 计划模式（PRD-M7-005）：plan 时只有只读能力还按规则走，其余一律拒绝（source: mode）。
   * 每次检查现取——模式在会话中途会变
   */
  /**
   * 收紧（PRD-M8-004）：这些能力即使规则说 allow 也要问人；规则说 deny 的照样拒。只会更严，不会更松。
   * 自由会话用它让 shell.exec 每次都问——命令能碰到哪些路径没法静态判断
   */
  askAlways?: (capabilityId: CapabilityId) => boolean
  /** 会话的工作目录：路径类授权按它把相对路径解析成绝对路径（PRD-M8-016） */
  cwd?: string
  /**
   * 会话级审核档位（SPEC-M11-004）：每次检查现取。
   * always-ask=无规则也问；on-demand=无规则拒（现状默认）；allow-all=无规则放行（危险能力仍拦）
   */
  reviewMode?: () => ReviewMode
}

/** 路径类能力不提供「本会话始终允许」的外部工具——参数能碰到什么没法静态限定。
 * shell.exec 例外（PRD-M11-005 5.2）：命令指纹可静态算，见 grantFor。 */
export function grantable(capabilityId: string): boolean {
  if (capabilityId === 'shell.exec') return true
  return !(capabilityId.startsWith('mcp.') || capabilityId.startsWith('plugin.'))
}

/** 这次调用如果被授权，授权的范围是什么。null = 这个能力不能授权 */
export function grantFor(capabilityId: string, args: unknown, cwd?: string): SessionGrant | null {
  if (capabilityId === 'shell.exec') {
    // PRD-M11-005 5.2：指纹 = argv[0] + ' ' + argv[1]；危险词/裸命令返回 null 不可授权
    const a = (args ?? {}) as { argv?: unknown; command?: unknown; cmd?: unknown }
    let argv: readonly string[] = []
    if (Array.isArray(a.argv)) argv = a.argv.filter((x): x is string => typeof x === 'string')
    else if (typeof a.command === 'string') argv = a.command.split(/\s+/).filter(Boolean)
    else if (typeof a.cmd === 'string') argv = a.cmd.split(/\s+/).filter(Boolean)
    const fp = commandFingerprint(argv)
    return fp === null ? null : { capability: capabilityId, fingerprint: fp }
  }
  if (!grantable(capabilityId)) return null
  const path = (args as { path?: unknown } | null)?.path
  if (typeof path === 'string' && path !== '') {
    const abs = isAbsolute(path) ? resolve(path) : resolve(cwd ?? '.', path)
    return { capability: capabilityId, scope: dirname(abs) }
  }
  return { capability: capabilityId }
}

function covers(g: SessionGrant, want: SessionGrant): boolean {
  if (g.capability !== want.capability) return false
  // shell.exec 指纹：必须精确同指纹才覆盖（宁可少放行，AC-5）
  if (g.fingerprint !== undefined || want.fingerprint !== undefined) {
    return g.fingerprint === want.fingerprint
  }
  if (g.scope === undefined) return true
  if (want.scope === undefined) return false
  const rel = relative(g.scope, want.scope)
  return rel === '' || !(rel.startsWith('..') || isAbsolute(rel))
}

/**
 * 交互式回答的来源；TUI 的确认框实现它。channel 是用户在哪个端上回答的。
 * grantable = 这次可以答「本会话始终允许」；答了就在返回里带 grant: true
 */
export type Asker = (
  capabilityId: CapabilityId,
  args: unknown,
  opts?: { grantable: boolean },
) => Promise<boolean | { allowed: boolean; channel?: string; grant?: boolean }>

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
  /** 本会话的授权（PRD-M8-016）。只活在内存里，重开会话时由调用方从事件恢复 */
  private readonly grants: SessionGrant[] = []

  constructor(
    private readonly config: PermissionConfig = {},
    private readonly ask?: Asker,
  ) {}

  /** 从事件流恢复授权（source:'user' 且带 grant 的 permission 事件） */
  restoreGrants(grants: readonly SessionGrant[]): void {
    for (const g of grants) this.grants.push({ ...g })
  }

  async check(capabilityId: CapabilityId, args: unknown): Promise<Decision> {
    if (this.config.scope && !this.config.scope(capabilityId)) {
      return { decision: 'deny', source: 'default', matchedRule: PARENT_SCOPE_RULE }
    }
    const rule = findRule(this.config.rules ?? [], capabilityId)
    const mode = this.config.reviewMode?.() ?? 'on-demand'
    const dangerous = isDangerous(capabilityId)

    // 结论三态：allow / deny / ask（ask 才走下面的会话授权 + 问人）
    let decision: 'allow' | 'deny' | 'ask'
    let ruleName: string | null
    if (!rule) {
      ruleName = null
      if (dangerous) {
        // 危险能力无规则 = 拒绝（AC-2 fail-closed；有人问也不问——没规则就不让用）
        decision = 'deny'
      } else if (mode === 'always-ask') {
        decision = 'ask'
      } else if (mode === 'allow-all') {
        decision = 'allow'
      } else {
        // on-demand = 现状 fail-closed（AC-4 回归基准）
        decision = 'deny'
      }
    } else {
      ruleName = rule.name
      if (rule.decision === 'deny') {
        decision = 'deny'
      } else if (dangerous) {
        // 危险能力即使规则 allow 也收紧到 ask（档位只收紧不放松，INV-03）
        decision = 'ask'
      } else if (rule.decision === 'ask' || this.config.askAlways?.(capabilityId) === true) {
        decision = 'ask'
      } else {
        decision = 'allow'
      }
    }

    if (decision === 'deny') {
      return {
        decision: 'deny',
        source: ruleName === null ? 'default' : 'config',
        matchedRule: ruleName,
      }
    }
    if (decision === 'allow') {
      return { decision: 'allow', source: ruleName === null ? 'config' : 'config', matchedRule: ruleName }
    }

    // decision === 'ask'：会话授权只能把「要问」变成「允许」，越不过 deny
    const want = grantFor(capabilityId, args, this.config.cwd)
    const hit = want === null ? undefined : this.grants.find((g) => covers(g, want))
    if (hit) return { decision: 'allow', source: 'session-grant', matchedRule: ruleName, grant: { ...hit } }
    if (!this.ask) {
      // 要问但没有人可问（非交互环境）——拒绝，不是放行
      return { decision: 'deny', source: 'default', matchedRule: ruleName }
    }
    const answer = await this.ask(capabilityId, args, { grantable: want !== null })
    const allowed = typeof answer === 'boolean' ? answer : answer.allowed
    const channel = typeof answer === 'boolean' ? undefined : answer.channel
    const granted = allowed && typeof answer !== 'boolean' && answer.grant === true && want !== null
    if (granted) this.grants.push(want)
    return {
      decision: allowed ? 'allow' : 'deny',
      source: 'user',
      matchedRule: ruleName,
      ...(channel === undefined ? {} : { channel }),
      ...(granted ? { grant: { ...want } } : {}),
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
