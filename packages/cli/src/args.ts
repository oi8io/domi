/**
 * 命令面 —— PRD-M1-008 · SPEC-M1-008
 *
 * 用 Node/Bun 内置的 `util.parseArgs`，不引 commander/citty（ADR-008）：
 * 目前十个子命令，引一个库是为将来的想象付费。
 * ADR-008 的重新评估线是「超过 8 个」——已经踩线了，下一次加命令前先回去看那份 ADR。
 * 重新评估的条件写在 ADR-008：子命令超过 8 个，或需要自动补全。
 */
import { parseArgs } from 'node:util'

export const COMMANDS = [
  'chat',
  'doctor',
  'init',
  'session',
  'data',
  'prompt',
  'report-bug',
  'eval',
  'trace',
  'migrate',
] as const
export type Command = (typeof COMMANDS)[number]

export interface ParsedCli {
  command: Command
  sub: string | undefined
  args: string[]
  flags: {
    help: boolean
    version: boolean
    json: boolean
    yes: boolean
    ping: boolean
    /** `domi trace <id> --html <路径>`；带值的选项必须在这里声明，
     * 否则 strict:false 会把它当布尔，路径掉进 positionals 里（这个坑踩过一次） */
    html: string | undefined
  }
}

export class UnknownCommandError extends Error {
  constructor(readonly given: string) {
    super(`未知命令：${given}\n可用命令：${COMMANDS.join(' / ')}\n$ domi --help`)
    this.name = 'UnknownCommandError'
  }
}

export function parseCli(argv: readonly string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      ping: { type: 'boolean' },
      html: { type: 'string' },
    },
  })

  const first = positionals[0]
  // 不带子命令就是进对话 —— 最常用的路径不该需要输入任何东西
  const command = (first ?? 'chat') as string
  if (!(COMMANDS as readonly string[]).includes(command)) throw new UnknownCommandError(command)

  return {
    command: command as Command,
    sub: positionals[1],
    args: positionals.slice(2),
    flags: {
      help: Boolean(values.help),
      version: Boolean(values.version),
      json: Boolean(values.json),
      yes: Boolean(values.yes),
      ping: Boolean(values.ping),
      html: typeof values.html === 'string' ? values.html : undefined,
    },
  }
}

export const HELP = `domi —— 本地优先的 agent 运行时

用法：
  domi                      进入对话（最常用，不需要子命令）
  domi doctor               体检；每条问题都给一条可直接粘贴执行的命令
  domi doctor --ping        额外发一次真实请求，区分「key 不对 / 网关没通 / 模型名错」
  domi init                 打印一份 config.toml 模板
  domi session list         列出会话
  domi session restore <id> 恢复软删除的会话
  domi data export <目录>    导出全部事件流与配置（JSONL + TOML，无私有格式）
  domi data purge           清空 ~/.domi（需要输入确认词）
  domi prompt dump          打印最终拼装的提示词与稳定前缀边界
  domi report-bug           打包日志（打包前会列出清单让你确认）
  domi eval record <id>     把一条真实会话导出成回放 fixture
  domi eval run             回放全部 fixture（不联网、不花钱）
  domi trace <id>           打印一条会话的轨迹树
  domi trace <id> --html f  导出单文件 HTML（离线可开）
  domi migrate              升级事件库结构；**先自动备份**，失败自动回滚

选项：
  -h, --help      看这个
  -v, --version   版本
      --json      机器可读输出
  -y, --yes       跳过确认（purge 不吃这一套）
`

export const CONFIG_TEMPLATE = `# domi 配置。环境变量优先于本文件。
[model]
provider = "anthropic"        # anthropic / openai / google / openai-compatible
name = "claude-sonnet-4-5"
# base_url = "http://localhost:11434/v1"   # 本地模型或网关
# api_key = "..."                          # 建议用环境变量代替

[context]
maxTokens = 150000
includeReasoning = false
strategy = "full"             # full / clean（确定性清理，见 docs/adr/005 与 PRD-M2-002）

# 权限默认拒绝。没在这里出现的能力一律不放行。
[[permissions.rules]]
name = "allow-read"
capability = "fs.read"
decision = "allow"

[[permissions.rules]]
name = "confirm-write"
capability = "fs.write"
decision = "ask"

[[permissions.rules]]
name = "confirm-shell"
capability = "shell.exec"
decision = "ask"

# 跨会话检索（PRD-M2-004）。它是读操作，但**历史里有你的原话**，
# 所以「能不能翻旧账」由这条规则说了算，而不是由「它是读操作」说了算。
# 删掉这条 = 默认拒绝，domi 就不会去翻历史了
[[permissions.rules]]
name = "allow-memory-search"
capability = "memory.search"
decision = "allow"
`
