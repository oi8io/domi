/**
 * 命令面 —— PRD-M1-008 · SPEC-M1-008
 *
 * 用 Node/Bun 内置的 `util.parseArgs`，不引 commander/citty（ADR-008）：
 * 目前十个子命令，引一个库是为将来的想象付费。
 * ADR-008 的重新评估线是「超过 8 个」——已经踩线了，下一次加命令前先回去看那份 ADR。
 * 重新评估的条件写在 ADR-008：子命令超过 8 个，或需要自动补全。
 */

import { parseArgs } from 'node:util'
import { tr } from '@domi/i18n'

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
  'task',
  'bridge',
  'plugin',
  'trust',
  'hook',
  'review',
] as const
export type Command = (typeof COMMANDS)[number]

export interface ParsedCli {
  command: Command
  sub: string | undefined
  args: string[]
  /**
   * 子命令之后的原始参数（带 --选项 与它们的值）。自己解析选项的子命令用它（domi eval l2 --rounds 3）：
   * parseArgs 不认识的选项会被当成布尔、值掉进 args，选项本身就丢了
   */
  rawArgs: string[]
  flags: {
    help: boolean
    version: boolean
    json: boolean
    yes: boolean
    ping: boolean
    /** `domi task run x.yaml --follow` */
    follow: boolean
    /** `domi memory list --all`：连删掉的也列 */
    all: boolean
    /** `domi --connect ws://host:port`：连远程 domid（PRD-M3-006 AC-1） */
    connect: string | undefined
    /** `domi init --from-toml`：迁移旧配置（ADR-014） */
    fromToml: boolean
    /** `domi --isolate`：在隔离工作区（git worktree）里开会话（PRD-M7-006） */
    isolate: boolean
    /** `domi --chat`：不管在哪个目录，都开自由会话（PRD-M8-017 AC-2） */
    chat: boolean
    /** `domi -p <项目名或路径>`（长写法 `--in`）：在这个项目下开任务。`--project` 已被 `domi init --project` 占用 */
    inProject: string | undefined
    /** `domi init --project`：在仓库里建 .domi/ 与 AGENT.md 模板（PRD-M7-002 AC-5） */
    project: boolean
    /** `domi trust <路径> --revoke` */
    revoke: boolean
    /** `domi trace <id> --html <路径>`；带值的选项必须在这里声明，
     * 否则 strict:false 会把它当布尔，路径掉进 positionals 里（这个坑踩过一次） */
    html: string | undefined
  }
}

export class UnknownCommandError extends Error {
  constructor(readonly given: string) {
    super(tr('cli.args.unknown', { given, join: COMMANDS.join(' / ') }))
    this.name = 'UnknownCommandError'
  }
}

/**
 * 命令（与紧跟其后的子命令）之后的原始参数。
 * 子命令只有紧跟在命令后面才算：`domi review --spec a.md` 里 a.md 是选项的值，不是子命令
 */
function rawAfter(argv: readonly string[], command: string | undefined, sub: string | undefined): string[] {
  const i = command === undefined ? -1 : argv.indexOf(command)
  if (i < 0) return [...argv]
  const skip = sub !== undefined && argv[i + 1] === sub ? 2 : 1
  return [...argv.slice(0, i), ...argv.slice(i + skip)]
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
      follow: { type: 'boolean' },
      'from-toml': { type: 'boolean' },
      project: { type: 'boolean' },
      revoke: { type: 'boolean' },
      isolate: { type: 'boolean' },
      chat: { type: 'boolean' },
      in: { type: 'string', short: 'p' },
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
    rawArgs: rawAfter(argv, first, positionals[1]),
    flags: {
      help: Boolean(values.help),
      version: Boolean(values.version),
      json: Boolean(values.json),
      yes: Boolean(values.yes),
      ping: Boolean(values.ping),
      fromToml: Boolean(values['from-toml']),
      project: Boolean(values.project),
      isolate: Boolean(values.isolate),
      chat: Boolean(values.chat),
      inProject: typeof values.in === 'string' ? values.in : undefined,
      revoke: Boolean(values.revoke),
      html: typeof values.html === 'string' ? values.html : undefined,
      connect: typeof values.connect === 'string' ? values.connect : undefined,
      all: Boolean(values.all),
      follow: Boolean(values.follow),
    },
  }
}

/** `domi --help`（PRD-M9-004：随界面语言） */
export const HELP = (): string => tr('cli.help')

/** `domi init` 打印的 config.yaml 模板（注释随界面语言；键与取值两种语言完全相同） */
export const CONFIG_TEMPLATE = (): string => tr('cli.configTemplate')
