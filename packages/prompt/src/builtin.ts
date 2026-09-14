/**
 * 内置层与配置注入 —— PRD-M1-003 AC-3
 *
 * priority 的编号留了间隔（100/200/…），让用户插层时不必改内置层的编号。
 * 这是个小细节，但没留间隔的话，用户想插一层就得改我们的代码。
 */
import type { PromptCtx, PromptLayer } from './layer.ts'

export const PRIORITY = {
  identity: 100,
  capabilities: 200,
  conventions: 300,
  /** 用户自定义层的默认落点 —— 仍在稳定前缀内 */
  userStatic: 500,
  /** 从这里开始是会变的内容 */
  workspace: 800,
  dynamic: 900,
} as const

export const identityLayer: PromptLayer = {
  id: 'builtin.identity',
  role: 'system',
  priority: PRIORITY.identity,
  cacheable: true,
  render: () =>
    '你是 domi，一个本地优先的编码助手。你的每一步都会被记录成事件流并展示给用户，' +
    '所以说清楚你在做什么、为什么这么做。',
}

export const conventionsLayer: PromptLayer = {
  id: 'builtin.conventions',
  role: 'system',
  priority: PRIORITY.conventions,
  cacheable: true,
  render: () =>
    [
      '约定：',
      '- 改文件前先读它，不要凭记忆改',
      '- 用户拒绝某次操作时不要重试同一个调用，换做法或问用户',
      '- 工具结果里的截断标记意味着还有更多内容，需要时继续读',
    ].join('\n'),
}

/** 工作区信息会变（目录、文件列表），所以 cacheable: false 且排在前缀之后 */
export const workspaceLayer: PromptLayer = {
  id: 'builtin.workspace',
  role: 'user',
  priority: PRIORITY.workspace,
  cacheable: false,
  render: (ctx: PromptCtx) => `当前工作目录：${ctx.cwd}`,
}

export const BUILTIN_LAYERS: readonly PromptLayer[] = [identityLayer, conventionsLayer, workspaceLayer]

export interface ConfigLayerSpec {
  id: string
  role?: 'system' | 'user'
  priority?: number
  cacheable?: boolean
  text: string
}

/** 把 config.toml 里的 [[prompt.layers]] 变成层。不改代码即生效（AC-3） */
export function layersFromConfig(specs: readonly ConfigLayerSpec[]): PromptLayer[] {
  return specs.map((s) => ({
    id: s.id,
    role: s.role ?? 'system',
    priority: s.priority ?? PRIORITY.userStatic,
    // 用户层默认 cacheable: true —— 大多数自定义提示词是静态的。
    // 写了会变的内容又没标 false 的话，构建期的边界检查会当场告诉他
    cacheable: s.cacheable ?? true,
    render: () => s.text,
  }))
}

/** 同 id 的配置层**覆盖**内置层，而不是并存 */
export function mergeLayers(builtin: readonly PromptLayer[], custom: readonly PromptLayer[]): PromptLayer[] {
  const byId = new Map(builtin.map((l) => [l.id, l]))
  for (const l of custom) byId.set(l.id, l)
  return [...byId.values()]
}
