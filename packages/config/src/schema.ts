/**
 * 配置契约 —— PRD-M0-008 · SPEC-M0-009
 *
 * 配置文件是 YAML（docs/adr/014），解析用 Bun 内置的 `Bun.YAML`，不引第三方库（`PRD-VISION.md` §6 第一类的反面：
 * 内置的就够用时，引库只是多一个要跟版本的东西）。
 */
import { z } from 'zod'
import { DEFAULT_MODEL, VENDOR_IDS } from './vendors.ts'

export const PermissionRuleSchema = z.object({
  name: z.string(),
  capability: z.string(),
  decision: z.enum(['allow', 'deny', 'ask']),
})

/**
 * 一个 MCP server（PRD-M2-001 · ADR-015）。command = stdio 子进程，url = Streamable HTTP，二选一。
 * name 会进工具名 `mcp.<name>.<tool>` 与权限规则，所以只许安全字符
 */
export const McpServerSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, '只许字母、数字、- 和 _，最长 32'),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict()
  .refine((s) => (s.command === undefined) !== (s.url === undefined), {
    message: 'command（stdio）与 url（HTTP）必须二选一',
  })
export type McpServerConfig = z.infer<typeof McpServerSchema>

export const McpConfigSchema = z
  .object({
    servers: z
      .array(McpServerSchema)
      .default([])
      .refine((list) => new Set(list.map((s) => s.name)).size === list.length, { message: 'server 名字重名了' }),
    /**
     * HTTP server 允许访问的主机（INV-11 · PRD-M2-001 AC-6）。支持 `*.example.com`。
     * 没列出的一律拒绝——包括 localhost，本地 server 也要显式写上
     */
    allowedHosts: z.array(z.string()).default([]),
    /** 每个 server 的连接超时。一个 server 慢不能拖住别的（AC-5） */
    timeoutMs: z.number().int().positive().default(10_000),
  })
  .default({ servers: [], allowedHosts: [], timeoutMs: 10_000 })

/** 能力矩阵的显式覆盖：五个布尔，只写要改的 */
export const CapabilitiesSchema = z
  .object({
    toolCall: z.boolean(),
    vision: z.boolean(),
    reasoning: z.boolean(),
    promptCache: z.boolean(),
    structuredOutput: z.boolean(),
  })
  .partial()
  .strict()

export const ConfigSchema = z.object({
  model: z.object({
    provider: z.string().default(DEFAULT_MODEL.provider),
    name: z.string().default(DEFAULT_MODEL.name),
    /** 自定义网关：LiteLLM / OpenRouter / 本地模型都从这里进来（DESIGN §5） */
    baseUrl: z.string().optional(),
    /**
     * 允许写在配置文件里，但**不推荐**——环境变量优先。
     * 无论从哪来，它都不会进事件流：脱敏挂在 EventLog.append 前置（SPEC-M0-009）。
     */
    apiKey: z.string().optional(),
    /**
     * 能力矩阵的显式覆盖（PRD-M1-001 AC-2）。openai-compatible 默认全关（fail-closed），
     * 后面挂的模型其实支持工具调用的话，在 model.capabilities 里打开
     */
    capabilities: CapabilitiesSchema.optional(),
  }),
  permissions: z.object({ rules: z.array(PermissionRuleSchema).default([]) }).default({ rules: [] }),
  mcp: McpConfigSchema,
  /**
   * 记忆与 Soul（PRD-M4-001/002 · docs/adr/018/019）。
   * extractEvery：每几轮用户输入抽取一次 L3，0 = 不自动抽（仍可手动 `domi memory extract`）。
   * embedding：配了才有语义检索；apiKey / baseUrl 不写就沿用 model 的（同一个 provider 时）
   */
  memory: z
    .object({
      extractEvery: z.number().int().min(0).default(5),
      soul: z.boolean().default(true),
      embedding: z
        .object({
          provider: z.string(),
          model: z.string(),
          baseUrl: z.string().optional(),
          apiKey: z.string().optional(),
        })
        .optional(),
    })
    .default({ extractEvery: 5, soul: true }),
  /** 长任务通知（PRD-M5-004）。默认都关：系统通知与 webhook 都要显式开 */
  notify: z
    .object({
      system: z.boolean().default(false),
      webhook: z.object({ url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }).optional(),
    })
    .default({ system: false }),
  /** Telegram 桥接（PRD-M5-007）。token 更推荐放 DOMI_TELEGRAM_TOKEN */
  bridge: z.object({ telegram: z.object({ token: z.string().optional() }).optional() }).default({}),
  /** 插件（PRD-M6）。allowUnsandboxed：没有系统级沙箱时也运行插件代码——不推荐，doctor 会标红 */
  plugins: z
    .object({
      enabled: z.boolean().default(true),
      allowUnsandboxed: z.boolean().default(false),
      /** 停用的插件名（PRD-M8-012 AC-6）。设置页的开关写这里 */
      disabled: z.array(z.string()).default([]),
    })
    .default({ enabled: true, allowUnsandboxed: false, disabled: [] }),
  /**
   * 各家模型的凭据与地址（PRD-M8-011）。文件里写 base_url；api_key 推荐放 ~/.domi/secrets.yaml（设置页就写那里）。
   * model.provider 那一家的 key / base_url 也可以写在 model 下（旧写法，继续认）
   */
  providers: z
    .record(
      z.string(),
      z.object({
        /** 界面上的名字（PRD-M9-002 AC-1）。不写就用 id */
        name: z.string().optional(),
        /** 厂商模板（`vendors.ts`）。旧配置不写，读的时候按键名推断 */
        vendor: z.enum(VENDOR_IDS).optional(),
        /** 只对 custom 有意义 */
        protocol: z.enum(['openai', 'anthropic']).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        enabled: z.boolean().default(true),
        /** 手填的模型（探测不到时的清单，也用来补探测结果里没有的） */
        models: z.array(z.string()).default([]),
        /** 能力矩阵覆盖（PRD-M9-002 AC-2）。只覆盖写了的项 */
        capabilities: CapabilitiesSchema.optional(),
      }),
    )
    .default({}),
  /** 界面（PRD-M8-001 AC-5）：主题色在 Web 与 TUI 之间共用 */
  ui: z
    .object({ accent: z.enum(['blue', 'green', 'orange', 'purple', 'pink']).default('blue') })
    .default({ accent: 'blue' }),
  /** TUI 深浅（PRD-M8-014 AC-6）。auto 读 COLORFGBG */
  tui: z.object({ theme: z.enum(['auto', 'dark', 'light']).default('auto') }).default({ theme: 'auto' }),
  /**
   * 钩子（PRD-M7-003 · ADR-025）。**只从这个文件读**，仓库里的任何文件都注册不了钩子。
   * pre：权限允许之后、执行之前，非 0 退出 = 拦下；post：执行之后，输出附在结果上；stop：一轮结束后
   */
  hooks: z
    .array(
      z
        .object({
          name: z.string().min(1),
          on: z.enum(['pre', 'post', 'stop']),
          /** 能力 id，支持 前缀.*；stop 钩子不看它 */
          match: z.string().default('*'),
          run: z.string().min(1),
          timeoutMs: z.number().int().positive().max(600_000).default(10_000),
        })
        .strict(),
    )
    .default([]),
  /**
   * 完成前验证（PRD-M7-004）。command：这个环境里「验证」的命令（也会按内置模式表识别 test / check / tsc / lint 等）；
   * maxNudges：改了没验、模型却要结束时，最多追加几次提示
   */
  verify: z
    .object({
      enabled: z.boolean().default(true),
      command: z.string().optional(),
      maxNudges: z.number().int().min(0).max(10).default(2),
    })
    .default({ enabled: true, maxNudges: 2 }),
  /**
   * 价目表（美元 / 百万 token）。状态栏的花费与预算的金额上限靠它；不在表里的模型花费显示 `—`，金额上限不生效。
   * 写了的会和内置的几项合并（同名以这里为准）
   */
  pricing: z
    .record(
      z.string(),
      z.object({
        inputPer1M: z.number().nonnegative(),
        outputPer1M: z.number().nonnegative(),
        cacheReadPer1M: z.number().nonnegative().optional(),
      }),
    )
    .default({}),
  /** 每个会话的用量上限（PRD-M7-009）。不写就不限；协议 session.budget 可以按会话覆盖 */
  budget: z
    .object({
      tokens: z.number().int().positive().optional(),
      costUsd: z.number().positive().optional(),
      toolCalls: z.number().int().positive().optional(),
    })
    .default({}),
  /** Skill（PRD-M4-005）。dirs 之外还会读 ~/.domi/skills 与内置的官方 Skill */
  skills: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  /**
   * 自定义提示词层（PRD-M1-003 AC-3 · BUG-M3-012）。同 id 覆盖内置层（builtin.identity 之类），
   * 其余按 priority 插进去；不写 priority 落在 500（内置层之后、工作区信息之前）
   */
  prompt: z
    .object({
      layers: z
        .array(
          z
            .object({
              id: z.string().min(1),
              text: z.string(),
              role: z.enum(['system', 'user']).optional(),
              priority: z.number().int().optional(),
              cacheable: z.boolean().optional(),
            })
            .strict(),
        )
        .default([]),
    })
    .default({ layers: [] }),
  /**
   * domid 监听在哪（PRD-M3-006 · INV-11）。默认只有本机能连。
   * host 不是回环地址时**必须**有 token：没写就由 domid 生成一个存进 ~/.domi/daemon.token。
   * 环境变量 DOMI_HOST / DOMI_PORT / DOMI_TOKEN 优先
   */
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(0).max(65_535).default(7437),
      token: z.string().optional(),
    })
    .default({ host: '127.0.0.1', port: 7437 }),
  context: z
    .object({
      maxTokens: z.number().int().positive().default(150_000),
      includeReasoning: z.boolean().default(false),
      strategy: z.string().default('full'),
      /** 压缩时逐字保留的最近轮数（PRD-M8-012 AC-4）。只在 strategy = compact 时用 */
      keepTurns: z.number().int().min(0).max(50).default(2),
      /** 上下文占用到这个百分比就压缩。只在 strategy = compact 时用 */
      compactAt: z.number().int().min(30).max(95).default(70),
    })
    .default({ maxTokens: 150_000, includeReasoning: false, strategy: 'full', keepTurns: 2, compactAt: 70 }),
  /** 上传附件（PRD-M8-010 AC-3）：单个上限，MB */
  attachments: z.object({ maxMB: z.number().positive().max(200).default(20) }).default({ maxMB: 20 }),
})

export type DomiConfig = z.infer<typeof ConfigSchema>

/** 内置价目（与 trace / eval 同一份口径）。用户在 config.yaml 的 pricing 里写的覆盖这些 */
export type ModelPriceConfig = { inputPer1M: number; outputPer1M: number; cacheReadPer1M?: number | undefined }

export const BUILTIN_PRICING: Record<string, ModelPriceConfig> = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1 },
}

export function pricingOf(config: Pick<DomiConfig, 'pricing'>): Record<string, ModelPriceConfig> {
  return { ...BUILTIN_PRICING, ...(config.pricing ?? {}) }
}
