/**
 * 危险能力清单 + 命令指纹 —— PRD-M11-005（SPEC-M11-005 / SPEC-M11-006）。
 *
 * 为什么是代码常量不是配置（INV-03）：危险能力在任何档位下都不能被自动放行；
 * 写成 YAML 就可能被一条配置关掉。常量 + 单测锁定，想放宽必须改代码过测试。
 */

/** 会话级审核档位（SPEC-M11-004） */
export type ReviewMode = 'always-ask' | 'on-demand' | 'allow-all'

/**
 * 任何档位都不能自动放行的精确能力 id。
 * 对齐 packages/capability/src/builtin-tools.ts 的真实 id。
 * 删除/覆盖/写/外发/shell。只读（fs.read/list/memory.*）不在表里。
 */
export const DANGEROUS_EXACT: ReadonlySet<string> = new Set([
  'fs.delete',
  'fs.move',
  'fs.write',
  'fs.append',
  'shell.exec',
  'web.fetch',
])

/** 前缀整族危险：外部来的工具（参数能碰到什么没法静态判断） */
export const DANGEROUS_PREFIX: readonly string[] = ['mcp.', 'plugin.']

export function isDangerous(capabilityId: string): boolean {
  if (DANGEROUS_EXACT.has(capabilityId)) return true
  return DANGEROUS_PREFIX.some((p) => capabilityId.startsWith(p))
}

/** shell 命令里出现这些词，整条命令不可「始终允许」（AC-3：删除/提权/格式化等） */
const DANGEROUS_ARGV_HEAD: ReadonlySet<string> = new Set([
  'rm',
  'sudo',
  'su',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'kill',
  'pkill',
  'killall',
  'mv',
  'chmod',
  'chown',
])

/**
 * shell.exec 的命令指纹（5.2）：argv[0] + ' ' + argv[1]。
 * 无 argv[1]（裸命令太宽）或首词危险 → null（不可 grant，每次都问）。
 */
export function commandFingerprint(argv: readonly string[]): string | null {
  const head = argv[0]
  if (head === undefined) return null
  if (DANGEROUS_ARGV_HEAD.has(head)) return null
  const second = argv[1]
  if (second === undefined) return null
  return `${head} ${second}`
}
