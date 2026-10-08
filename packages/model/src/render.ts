/**
 * TASK-M15-003 · 厂商适配层（PRD-M15-006）
 *
 * 请求体渲染：按厂商给缓存参数与 TTL。纯函数，测试直打。
 * 分工：这里只算 providerOptions 骨架（TTL / prompt_cache_key）；
 * system 末尾显式断点由 AiSdkProvider 组装（它知道 system 文本，见 ai-sdk-provider.ts）。
 *
 * 不认识的厂商返回空对象（fail-closed：不发明厂商参数）。
 */
export type CacheMode = 'explicit' | 'gateway-key' | 'auto' | 'none'

export interface RenderVendor {
  /** 缓存接入方式（来自 VENDORS 表数据，厂商名只存那一处） */
  cacheMode: CacheMode
  baseUrl: string | undefined
  /** 官方端点：不发非标准参数 */
  official: boolean
}

export interface RenderContext {
  sessionId: string
  kind: 'task' | 'chat'
  /** config.context.cacheTtlOverride（秒）；缺省按会话档位 */
  ttlOverride?: number | undefined
}

/** SPEC-M15-006 取舍-12：task / task.spawn 默认 1 小时，自由会话默认 5 分钟 */
export const CACHE_TTL_SECONDS: Record<'task' | 'chat', number> = { task: 3600, chat: 300 }

export function cacheTtlSeconds(kind: 'task' | 'chat', ttlOverride?: number | undefined): number {
  if (ttlOverride !== undefined && ttlOverride > 0) return ttlOverride
  return CACHE_TTL_SECONDS[kind] ?? CACHE_TTL_SECONDS.chat
}

/**
 * 按厂商产出 providerOptions（原样透传进 AI SDK）。
 * - anthropic：顶层 cache_control（自动缓存起点 + TTL 断点）
 * - openai 兼容网关（非官方端点）：prompt_cache_key = 会话 id
 * - deepseek / z.ai 等自动缓存厂商：不需要参数（能力表 promptCache 已按实际修正）
 * - 其他：空对象
 */
export function renderProviderOptions(v: RenderVendor, ctx: RenderContext): Record<string, unknown> {
  // 数据驱动（SPEC-M15-006 取舍-13）：接入方式存在 VENDORS 表，这里不认识任何厂商名
  if (v.cacheMode === 'explicit') {
    return {
      anthropic: {
        cacheControl: { type: 'ephemeral', ttlSeconds: cacheTtlSeconds(ctx.kind, ctx.ttlOverride) },
      },
    }
  }
  if (v.cacheMode === 'gateway-key' && !v.official) {
    return { openai: { extraBody: { prompt_cache_key: ctx.sessionId } } }
  }
  return {}
}
