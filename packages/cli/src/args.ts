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
  'memory',
  'soul',
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
    /** `domi memory list --all`：连删掉的也列 */
    all: boolean
    /** `domi --connect ws://host:port`：连远程 domid（PRD-M3-006 AC-1） */
    connect: string | undefined
    /** `domi init --from-toml`：迁移旧配置（ADR-014） */
    fromToml: boolean
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
      connect: { type: 'string' },
      all: { type: 'boolean' },
      'from-toml': { type: 'boolean' },
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
      fromToml: Boolean(values['from-toml']),
      html: typeof values.html === 'string' ? values.html : undefined,
      connect: typeof values.connect === 'string' ? values.connect : undefined,
      all: Boolean(values.all),
    },
  }
}

export const HELP = `domi —— 本地优先的 agent 运行时

用法：
  domi                      进入对话（最常用，不需要子命令）
  domi --connect ws://主机:端口
                            连另一台机器上的 domid（token 放在环境变量 DOMI_TOKEN）
  domi doctor               体检；每条问题都给一条可直接粘贴执行的命令
  domi doctor --ping        额外发一次真实请求，区分「key 不对 / 网关没通 / 模型名错」
  domi init                 打印一份 config.yaml 模板
  domi init --from-toml     把旧的 config.toml 换成 YAML 打印出来（注释带不过来）
  domi session list         列出会话
  domi session restore <id> 恢复软删除的会话
  domi data export <目录>    导出全部事件流与配置（JSONL + YAML，无私有格式）
  domi data purge           清空 ~/.domi（需要输入确认词）
  domi prompt dump          打印最终拼装的提示词与稳定前缀边界
  domi report-bug           打包日志（打包前会列出清单让你确认）
  domi eval record <id>     把一条真实会话导出成回放 fixture
  domi eval run             回放全部 fixture（不联网、不花钱）
  domi trace <id>           打印一条会话的轨迹树
  domi trace <id> --html f  导出单文件 HTML（离线可开）
  domi migrate              升级事件库结构；**先自动备份**，失败自动回滚
  domi memory list|search|delete|extract   记下的关于你的条目（L3）
  domi soul show|review|update|export|import   Soul：审阅改动、导出分享、导入别人的

对话里：
  /compact                  手动压缩上下文
  /model <名字> [provider]  会话中途切换模型（历史不动，只追加一条切换记录）
  /branch [seq]             从某一条（默认最后一条）分出一个新会话并切过去
  /ref <会话 id> [起-止]    引用另一个会话的一段，下一句话带上（不给区间就是整个会话）
  /sessions [--all]         列出会话（--all 含已删除的）
  /open <id>  /new          切到某个会话 / 新建一个
  /delete <id>  /restore <id>  软删除 / 恢复会话
  /soul                     看 Soul 待审阅的改动；/soul accept|reject <id>
  /memory [关键词]          看记下的关于你的条目；/extract 立刻从当前会话抽取

选项：
  -h, --help      看这个
  -v, --version   版本
      --json      机器可读输出
  -y, --yes       跳过确认（purge 不吃这一套）
`

export const CONFIG_TEMPLATE = `# domi 配置（YAML，docs/adr/014）。环境变量优先于本文件。
# 放在 ~/.domi/config.yaml
model:
  provider: anthropic           # anthropic / openai / google；其它名字一律按 openai-compatible
  name: claude-sonnet-4-5
  # base_url: https://api.z.ai/api/anthropic   # 网关；anthropic 协议带不带 /v1 都行
  # api_key: ...                               # 建议用环境变量 DOMI_API_KEY 代替
  # capabilities:                              # openai-compatible 默认全关，网关支持的话在这里打开
  #   toolCall: true

context:
  maxTokens: 150000
  includeReasoning: false
  strategy: full                # full / clean（确定性清理，见 docs/adr/005 与 PRD-M2-002）

# 权限默认拒绝。没在这里出现的能力一律不放行。
permissions:
  rules:
    - name: allow-read
      capability: fs.read
      decision: allow

    - name: confirm-write
      capability: fs.write
      decision: ask

    - name: confirm-shell
      capability: shell.exec
      decision: ask

    # 跨会话检索（PRD-M2-004）。它是读操作，但**历史里有你的原话**，
    # 所以「能不能翻旧账」由这条规则说了算，而不是由「它是读操作」说了算。
    # 删掉这条 = 默认拒绝，domi 就不会去翻历史了
    - name: allow-memory-search
      capability: memory.search
      decision: allow

    # Skill 的正文是文字说明，读它不执行任何东西（docs/adr/019）
    - name: allow-skill-load
      capability: skill.load
      decision: allow

    # 看网页、点界面：每一步都问你（ADR-016）。想放宽的话按工具名精确放行，
    # 比如 capability: mcp.computer.screenshot，别整组 allow
    - name: confirm-browser
      capability: mcp.browser.*
      decision: ask
    - name: confirm-computer
      capability: mcp.computer.*
      decision: ask

# MCP server（docs/adr/015、016）。工具以 mcp.<name>.<工具名> 出现，走上面的权限规则。
mcp:
  # HTTP server 允许访问的主机；没列出的一律拒绝（localhost 也要写）。支持 *.example.com
  allowedHosts: []
  servers:
    # 浏览器（Playwright MCP，微软官方）。把 enabled 改成 true 即可
    - name: browser
      command: npx
      args: [-y, "@playwright/mcp@0.0.81", --headless, --isolated]
      enabled: false
    # 桌面：截屏、鼠标、键盘、应用（macOS 需要给终端开「辅助功能」权限）
    - name: computer
      command: npx
      args: [-y, --prefer-offline, "@zavora-ai/computer-use-mcp@7.4.0"]
      enabled: false
    # 其它 server 照着写：stdio 用 command/args，HTTP 用 url
    # - name: docs
    #   url: https://mcp.example.com/mcp

# 记忆与 Soul（docs/adr/018、019）。Soul 在 ~/.domi/soul/soul.md，可以直接手改
# memory:
#   extractEvery: 5        # 每几轮抽取一次，0 = 只手动（domi memory extract <会话>）
#   soul: true             # false = 不更新 Soul、也不放进提示词
#   embedding:             # 配了才有语义检索；anthropic 没有 embedding 接口
#     provider: openai
#     model: text-embedding-3-small

# 自定义提示词层（domi prompt dump 可以看拼装结果）。同 id 覆盖内置层，比如 builtin.conventions
# prompt:
#   layers:
#     - id: my.style
#       text: 回答要短，先给结论。

# domid 监听在哪（docs/adr/017）。默认只有本机能连，不用改。
# 要从别的机器连（domi --connect ws://这台机器:7437），把 host 改成 0.0.0.0：
# 这时必须有 token——不写的话 domid 会生成一个放进 ~/.domi/daemon.token
server:
  host: 127.0.0.1
  port: 7437
  # token: 至少 24 个字符（字母、数字、. _ ~ -）；更推荐用环境变量 DOMI_TOKEN
`
