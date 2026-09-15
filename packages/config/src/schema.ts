/**
 * 配置契约 —— PRD-M0-008 · SPEC-M0-009
 *
 * 配置文件是 YAML（docs/adr/014），解析用 Bun 内置的 `Bun.YAML`，不引第三方库（`PRD-VISION.md` §6 第一类的反面：
 * 内置的就够用时，引库只是多一个要跟版本的东西）。
 */
import { z } from 'zod'

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

export const ConfigSchema = z.object({
  model: z.object({
    provider: z.string().default('anthropic'),
    name: z.string().default('claude-sonnet-4-5'),
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
    capabilities: z
      .object({
        toolCall: z.boolean(),
        vision: z.boolean(),
        reasoning: z.boolean(),
        promptCache: z.boolean(),
        structuredOutput: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
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
    })
    .default({ maxTokens: 150_000, includeReasoning: false, strategy: 'full' }),
})

export type DomiConfig = z.infer<typeof ConfigSchema>
