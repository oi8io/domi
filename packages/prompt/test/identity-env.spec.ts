/**
 * PRD-M15-010 · 身份与环境
 * AC-1 身份按模式分段（通用 / 任务 / 子 agent），全部在冻结前缀里
 * AC-2 环境分两半：定格一半进 workspace 层（前缀）；会变一半走 ctx.note（runtime 侧，见 env.spec.ts）
 * AC-3 工作方法段：上下文是稀缺资源
 * AC-4 `domi prompt dump` 显示新的层与冻结边界（层自动进 dump；边界=prefixLayerCount）
 */
import { describe, expect, test } from 'bun:test'
import {
  assemble,
  BUILTIN_LAYERS,
  conventionsLayer,
  formatDump,
  identityLayer,
  type PromptCtx,
  workspaceLayer,
} from '../src/index.ts'

const CTX: PromptCtx = { cwd: '/tmp/work', model: 'stub-1' }

const renderLayer = (id: string, ctx: PromptCtx): string =>
  assemble(BUILTIN_LAYERS, ctx)
    .messages.filter((m) => m.role === 'system')
    .map((m) => (m as { content: string }).content)
    .join('\n')

describe('AC-1 · 身份按模式分段（全在冻结前缀：identity 是 cacheable）', () => {
  test('默认（chat）是通用身份：本地优先、不只是编码、按用户语言回复', () => {
    const out = renderLayer('builtin.identity', CTX)
    expect(out).toContain('domi')
    expect(out).toContain('编码')
    expect(out).toContain('Always reply in the language the user writes in.')
  })

  test('task 模式：任务身份，强调先写计划、按计划推进', () => {
    const out = renderLayer('builtin.identity', { ...CTX, mode: 'task' })
    expect(out).toContain('任务')
    expect(out).toContain('计划')
    expect(out).not.toContain('Always reply in the language the user writes in.')
  })

  test('subagent 模式：只回结论、控制长度；三种模式文案互不相同', () => {
    const sub = renderLayer('builtin.identity', { ...CTX, mode: 'subagent' })
    expect(sub).toContain('只回结论')
    expect(sub).toContain('控制长度')
    const chat = renderLayer('builtin.identity', CTX)
    const task = renderLayer('builtin.identity', { ...CTX, mode: 'task' })
    expect(new Set([chat, task, sub]).size).toBe(3)
  })

  test('身份层 cacheable=true，属于冻结前缀（dump 边界在其后）', () => {
    expect(identityLayer.cacheable).toBe(true)
    const a = assemble(BUILTIN_LAYERS, CTX)
    // identity / guardrail / conventions 三个 cacheable 内置层都在前缀里
    expect(a.prefixLayerCount).toBeGreaterThanOrEqual(3)
  })
})

describe('AC-2 · 环境定格一半进 workspace 层（会变一半在 runtime env.ts，见 runtime 测试）', () => {
  const env: NonNullable<PromptCtx['env']> = {
    os: 'darwin arm64',
    shell: '/bin/zsh',
    projectRoot: '/tmp/work',
    projectType: 'node',
    pkgManager: 'pnpm',
    gitRemote: 'git@github.com:o/domi.git',
  }

  test('有 env 时渲染 OS / shell / 项目根 / 项目类型 / 包管理器 / git 远端', () => {
    const out = workspaceLayer.render({ ...CTX, env })
    expect(out).toContain('darwin arm64')
    expect(out).toContain('/bin/zsh')
    expect(out).toContain('/tmp/work')
    expect(out).toContain('node')
    expect(out).toContain('pnpm')
    expect(out).toContain('git@github.com:o/domi.git')
  })

  test('没有 env（旧调用方）时只回工作目录，行为不变', () => {
    expect(workspaceLayer.render(CTX)).toBe('当前工作目录：/tmp/work')
  })
})

describe('AC-3 · 工作方法段：上下文是稀缺资源', () => {
  test('约定层包含先搜后读 / 按范围读 / 长输出看头尾 / 大范围探索交子 agent', () => {
    const out = conventionsLayer.render(CTX)
    expect(out).toContain('先搜后读')
    expect(out).toContain('按范围读')
    expect(out).toContain('头尾')
    expect(out).toContain('子 agent')
  })
})

describe('AC-4 · `domi prompt dump` 显示新层与冻结边界', () => {
  test('dump 包含 identity / workspace 层与 cacheable 标记', () => {
    const a = assemble(BUILTIN_LAYERS, { ...CTX, env: undefined })
    const dump = formatDump(a)
    expect(dump).toContain('builtin.identity')
    expect(dump).toContain('builtin.workspace')
    expect(dump).toContain('cacheable')
    expect(dump).toContain('前缀')
  })
})
