/**
 * Capability 与 Tool —— docs/spec/M0.md §3.4 · SPEC-M0-006
 *
 * INV-05：**Tool 是唯一执行原语；Skill 不可执行，只注入上下文。**
 * 这条在类型层强制：`Tool` 必须声明 `capability`，`Skill` 结构上没有 `execute`。
 */
import type { DomiEvent } from '@domi/protocol'
import type { z } from 'zod'

export type BuiltinCapabilityId = 'fs.read' | 'fs.write' | 'shell.exec'
export type CapabilityId = BuiltinCapabilityId | (string & {})

export interface Decision {
  decision: 'allow' | 'deny' | 'ask'
  /** 这条决定从哪来。default 永远是 deny（fail-closed） */
  source: 'default' | 'config' | 'user' | 'mode' | 'session-grant'
  /** 命中的规则；默认分支为 null */
  matchedRule: string | null
  /** 用户在哪个端上回答的（M5-007） */
  channel?: string
  /** 本会话内始终允许（PRD-M8-016）：用户这次给的授权，或这次命中的授权 */
  grant?: SessionGrant
}

/** 会话级授权。scope 是路径类能力的目录（绝对路径）；fingerprint 是 shell.exec 的命令指纹（PRD-M11-005 5.2） */
export interface SessionGrant {
  capability: string
  scope?: string
  /** shell.exec：命令指纹 argv[0] + ' ' + argv[1]。有它就只覆盖同指纹调用 */
  fingerprint?: string
}

/** 工具向用户要输入（MCP elicitation 等）。一次问答，不是权限决定 */
export interface ElicitRequest {
  message: string
  /** 要填的表单（JSON Schema，object 类型）；没有就是纯确认 */
  requestedSchema?: unknown
}

export interface ElicitResponse {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

/** 过期写保护的记录本（实现见 tools/stamps.ts）。接口放这里，免得 types ↔ tools 互相引用 */
export interface StampBook {
  record(absPath: string, content: string): void
  has(absPath: string): boolean
  check(absPath: string, current: string | null, displayPath: string): void
}

/** 后台命令表（实现见 tools/shell-jobs.ts） */
export interface JobStarter {
  start(cmd: string, cwd: string): { jobId: string; logFile?: string }
}

export interface ToolCtx {
  /** 工作目录，所有文件访问的根。越界一律拒绝（PRD-M0-003 AC-5） */
  cwd: string
  signal: AbortSignal
  /**
   * 工具往事件流里补事件的通道（例如 fs.write 的前后指纹）。
   * 工具**不直接写 store**——它把事件交出去，由 loop 统一按顺序落盘。
   * 这样顺序与事务边界只有一个地方管，append-only 的保证不会被工具各写各的破坏。
   */
  emit(ev: DomiEvent): void
  /** 向用户要输入。没有这个通道（非交互环境）时为 undefined，调用方应按 decline 处理 */
  elicit?(req: ElicitRequest): Promise<ElicitResponse>
  /** 本会话读写过的文件指纹（过期写保护，PRD-M7-001 AC-2）。没有就不做检查 */
  stamps?: StampBook
  /** 后台命令表（PRD-M7-001 AC-4）。没有就不支持 background */
  jobs?: JobStarter
  /** 超长输出落盘的目录（~/.domi/outputs/<会话>）。fs.read 对它单独放行只读 */
  outputDir?: string
  /** 这次调用的 id（落盘文件名用） */
  callId?: string
}

export interface Tool<A = unknown, R = unknown> {
  readonly name: string
  /** 无此字段的对象无法通过 registerTool 的类型检查 —— INV-05 的编译期强制 */
  readonly capability: CapabilityId
  readonly description: string
  readonly schema: z.ZodType<A>
  /**
   * 发给模型的 JSON Schema。不给就由 schema 生成。
   * MCP 工具的 schema 本来就是 JSON Schema，转成 zod 再转回来会丢字段，所以原样给
   */
  readonly inputJsonSchema?: Record<string, unknown>
  execute(args: A, ctx: ToolCtx): Promise<R>
}

/**
 * INV-05：Skill 不可执行。
 * 这里**故意**没有 execute —— 将来谁想加，类型不会拦他，但 code review 会看到这行注释。
 * 真正的强制在 kernel：只有 Tool 会被 loop 调用。
 */
export interface Skill {
  readonly name: string
  /** 未激活时进上下文的只有这一句（PRD-M4-005 AC-2） */
  readonly description: string
  /** 正文。模型调 skill.load 才拿到 */
  readonly prompt: string
  readonly requiresTools: readonly string[]
  /** 官方随包发的、用户目录里的、还是仓库 .domi/skills/ 里的（同名时 项目 > 用户 > 插件 > 官方） */
  readonly source: 'official' | 'user' | 'project'
  /** 用户 Skill 的文件路径；官方的没有 */
  readonly path?: string
  /**
   * PRD-M4-005 AC-1：类型上不许有 execute。写成 never 而不是干脆不写，
   * 是为了让「给 Skill 加一个 execute」在编译期就报错，而不是悄悄变成一个多余字段
   */
  readonly execute?: never
}
