/**
 * 危险能力清单 + 命令指纹 —— PRD-M11-005（SPEC-M11-005 / SPEC-M11-006）。
 *
 * 为什么是代码常量不是配置（INV-03）：在「每次都问 / 按需」两档下危险能力不能被自动放行；
 * 写成 YAML 就可能被一条配置关掉。常量 + 单测锁定，想放宽必须改代码过测试。
 * 「全部放行」档是用户在会话里显式选的「跳过所有确认」（PRD-M12-002 回写 2026-09-23），不看这张表。
 */

/** 会话级审核档位（SPEC-M11-004） */
export type PermissionsMode = 'always-ask' | 'on-demand' | 'allow-all'

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
  'doas',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'kill',
  'pkill',
  'killall',
  'mv',
  'cp',
  'chmod',
  'chown',
  'truncate',
  'shred',
  // 解释器 / 包装器：第二个词之后什么都能跑，指纹限定不住（2026-09-23 安全修复）
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'env',
  'xargs',
  'exec',
  'eval',
  'source',
  'nohup',
  'time',
  'timeout',
  'nice',
  'watch',
  'python',
  'python3',
  'node',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
  'lua',
  'awk',
  'osascript',
  'find',
  // 下载即执行 / 外发
  'npx',
  'bunx',
  'pnpx',
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
])

/** 这些「可执行文件 + 子命令」会改写历史、丢改动或对外发布，不可「始终允许」 */
const DANGEROUS_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set([
    'push',
    'reset',
    'clean',
    'checkout',
    'switch',
    'restore',
    'rm',
    'rebase',
    'filter-branch',
    'filter-repo',
    'update-ref',
    'gc',
    'prune',
  ]),
  npm: new Set(['publish', 'unpublish', 'exec']),
  pnpm: new Set(['publish', 'dlx', 'exec']),
  yarn: new Set(['publish', 'dlx']),
  bun: new Set(['publish']),
}

/**
 * shell 元字符：命令是经 `sh -c` 执行的，出现这些就可能拼出第二条命令、重定向写文件或做命令替换。
 * 指纹只看前两个词，所以这类命令一律不可授权（每次都问）。
 */
const SHELL_META = /[;&|`$<>(){}\\\n\r]/

/** 可执行文件必须是「裸名字」：带路径（/bin/rm、./rm）或环境变量前缀（FOO=1 rm）都会绕过危险词表 */
const PLAIN_WORD = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/**
 * shell.exec 的命令指纹（5.2）：argv[0] + ' ' + argv[1]。
 * 以下情况返回 null（不可 grant，每次都问）——宁可少放行，不可误放（AC-5）：
 * - 无 argv[1]（裸命令太宽）
 * - 任何一个参数带 shell 元字符（拼接 / 重定向 / 命令替换）
 * - 可执行文件不是裸名字（带路径或 FOO=1 前缀）
 * - 首词在危险表（删除 / 提权 / 解释器 / 下载即执行）
 * - 第二个词是选项（`git -C /other push` 会换目标）
 * - 子命令在危险表（git push/reset/clean…、npm publish…）
 */
export function commandFingerprint(argv: readonly string[]): string | null {
  const head = argv[0]
  if (head === undefined) return null
  if (argv.some((a) => SHELL_META.test(a))) return null
  if (!PLAIN_WORD.test(head)) return null
  if (DANGEROUS_ARGV_HEAD.has(head)) return null
  const second = argv[1]
  if (second === undefined) return null
  if (second.startsWith('-')) return null
  if (DANGEROUS_SUBCOMMANDS[head]?.has(second) === true) return null
  return `${head} ${second}`
}

/**
 * shell.exec 的原始命令串（`cmd` / `command`）先整体查元字符，再按空白拆成 argv 算指纹。
 * 整体查是因为拆分会把换行吃掉——`npm test\nrm -rf ~` 拆完看不出第二条命令。
 */
export function shellCommandFingerprint(raw: string): string | null {
  if (SHELL_META.test(raw)) return null
  return commandFingerprint(raw.split(/\s+/).filter(Boolean))
}
