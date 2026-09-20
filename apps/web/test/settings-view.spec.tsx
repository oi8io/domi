/**
 * 设置页 —— PRD-M8-012 AC-2（通用与模型供应商）· AC-7（记忆管理）· AC-5（Soul 与人格）· AC-6（插件）
 * 以及 PRD-M8-011 AC-1（凭据只给掩码）· PRD-M8-013 AC-2（用量的数字卡与柱状图）
 *
 * 这些 tab 的数据来自 config.get；SSR 跑不了 effect，所以直接把「已经读到的设置」喂给它们。
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeneralTab, MemoryTab } from '../src/views/SettingsView.tsx'
import { RuntimeTab } from '../src/views/settings/RuntimeTab.tsx'
import { PluginList } from '../src/views/settings/PluginsTab.tsx'
import { SoulView } from '../src/views/settings/SoulTab.tsx'
import { fmtCost, fmtTokens, ModelBars, rangeOf, UsageView } from '../src/views/settings/UsageTab.tsx'
import type { Settings } from '../src/views/settings/useSettings.ts'

const settings: Settings = {
  values: {
    'model.provider': 'anthropic',
    'model.name': 'claude-sonnet-4-5',
    'providers.anthropic.base_url': null,
    'providers.openai.base_url': null,
    'providers.deepseek.base_url': 'https://api.deepseek.com/v1',
    'providers.openai-compatible.base_url': 'http://127.0.0.1:8080/v1',
    'providers.openai-compatible.models': ['qwen3'],
    'memory.extractEvery': 5,
    'memory.soul': true,
    'context.strategy': 'compact',
    'context.keepTurns': 2,
    'context.compactAt': 70,
    'plugins.disabled': [],
    'verify.enabled': true,
    'budget.tokens': null,
    'budget.costUsd': null,
    'budget.toolCalls': null,
    'permissions.review': 'on-demand',
    'ui.accent': 'blue',
    'tui.theme': 'auto',
  },
  secrets: {
    anthropic: { set: true, masked: 'sk-ant…4f2a', source: 'secrets' },
    openai: { set: false },
    deepseek: { set: true, masked: 'sk-de…9911', source: 'env' },
    'openai-compatible': { set: false },
  },
  providers: [],
  paths: { config: '/home/d/.domi/config.yaml', secrets: '/home/d/.domi/secrets.yaml' },
  secretsTooOpen: false,
  writable: ['model.provider', 'model.name', 'ui.accent'],
}

const s = { data: settings, error: null, saved: null, save: async () => true, reload: () => undefined }

describe('PRD-M8-012 AC-2 · 通用（模型供应商见 settings-providers.spec，PRD-M9-002）', () => {
  test('通用：语言三选一（跟随系统 / 简体中文 / English，PRD-M9-004 AC-1）、主题三选一、5 个色板', () => {
    const html = renderToStaticMarkup(<GeneralTab s={s} />)
    expect(html).toContain('<option value="auto"')
    expect(html).toContain('简体中文')
    expect(html).toContain('<option value="en">English</option>')
    expect(html).toContain('跟随系统')
    expect(html).toContain('深色')
    expect(html).toContain('浅色')
    expect((html.match(/aria-pressed=/g) ?? []).length).toBe(5)
  })
})

describe('PRD-M8-012 AC-7 · 记忆管理', () => {
  const html = renderToStaticMarkup(<MemoryTab s={s} />)

  test('上下文策略三选一 + 三个数值项', () => {
    expect(html).toContain('不处理')
    expect(html).toContain('结构化清理')
    expect(html).toContain('自动压缩')
    expect(html).toContain('value="2"')
    expect(html).toContain('value="70"')
    expect(html).toContain('value="5"')
  })

  test('不开自动压缩时，两个压缩参数不可编辑', () => {
    const clean = renderToStaticMarkup(
      <MemoryTab s={{ ...s, data: { ...settings, values: { ...settings.values, 'context.strategy': 'clean' } } }} />,
    )
    expect((clean.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('PRD-M8-012 AC-5 · Soul 与人格', () => {
  const changes = [
    {
      id: 'c1',
      op: 'add' as const,
      section: '工作习惯' as const,
      sources: ['m1'],
      after: '先读 PRD',
      at: 1,
      diff: '+ 先读 PRD',
    },
  ]
  const items = [
    {
      id: 'm1',
      kind: 'preference' as const,
      text: '不喜欢渐变和毛玻璃',
      sourceRefs: [{ sessionId: 's', seq: 3 }],
      createdAt: 1,
      deleted: false,
    },
    { id: 'm2', kind: 'fact' as const, text: '删掉的那条', sourceRefs: [], createdAt: 1, deleted: true },
  ]
  const html = renderToStaticMarkup(
    <SoulView
      changes={changes}
      items={items}
      kept={new Set(['m1'])}
      onReview={() => undefined}
      onDelete={() => undefined}
    />,
  )

  test('待审阅的改动可接受 / 否决', () => {
    expect(html).toContain('待审阅的改动（1）')
    expect(html).toContain('+ 先读 PRD')
    expect(html).toContain('接受')
    expect(html).toContain('否决')
  })

  test('记忆条目：保留 / 否决；已删除的划掉且没有按钮', () => {
    expect(html).toContain('不喜欢渐变和毛玻璃')
    expect(html).toContain('已保留')
    expect(html).toContain('line-through')
  })

  test('检索模式说明（没有 embedding 时只按关键词）', () => {
    const kw = renderToStaticMarkup(<SoulView changes={[]} items={items} mode="keyword" />)
    expect(kw).toContain('只按关键词匹配')
  })
})

describe('PRD-M8-012 AC-6 · 插件卡片与启停开关', () => {
  const list = {
    sandbox: 'bwrap' as const,
    plugins: [
      {
        name: 'word-count',
        version: '1.0.0',
        description: '统计文件字数行数。',
        tools: ['plugin.word-count.count'],
        skills: 0,
        mcp: [],
        ui: [{ id: 'panel', title: '面板' }],
        enabled: true,
      },
      {
        name: 'git-workflow',
        version: '0.2.1',
        description: 'Git 操作。',
        tools: [],
        skills: 1,
        mcp: ['git'],
        ui: [],
        enabled: false,
      },
    ],
    problems: [],
  }
  const html = renderToStaticMarkup(<PluginList list={list} onToggle={() => undefined} onOpen={() => undefined} />)

  test('卡片列出名字、说明、提供的东西与沙箱状态', () => {
    expect(html).toContain('word-count')
    expect(html).toContain('统计文件字数行数。')
    expect(html).toContain('沙箱：bwrap')
    expect(html).toContain('1 个工具')
    expect(html).toContain('MCP · git')
  })

  test('开关反映启停；停用的插件不给开 UI 面板', () => {
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('面板')
    const off = renderToStaticMarkup(
      <PluginList
        list={{ ...list, plugins: [{ ...(list.plugins[0] as (typeof list.plugins)[number]), enabled: false }] }}
        onToggle={() => undefined}
        onOpen={() => undefined}
      />,
    )
    expect(off).not.toContain('面板')
  })

  test('没有沙箱时红字说明带代码的插件不会运行', () => {
    const none = renderToStaticMarkup(<PluginList list={{ ...list, sandbox: 'none' }} />)
    expect(none).toContain('没有（带代码的插件不会运行）')
  })
})

describe('PRD-M8-013 AC-2 · 用量：6 张数字卡 + 按模型柱状图', () => {
  const usage = {
    from: 0,
    to: 1,
    tokens: { input: 120_000, output: 8400, cacheRead: 56_000 },
    costUsd: 3.42,
    unpricedModels: ['qwen3'],
    sessions: 47,
    turns: 120,
    toolCalls: 12,
    asks: 3,
    cacheHitPercent: 62,
    byModel: [
      {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        tokens: { input: 120_000, output: 8400, cacheRead: 56_000 },
        costUsd: 3.42,
        unpricedModels: [],
        sessions: 40,
        turns: 100,
        toolCalls: 12,
        asks: 3,
        cacheHitPercent: 62,
      },
      {
        model: 'qwen3',
        provider: 'openai-compatible',
        tokens: { input: 1000, output: 100, cacheRead: 0 },
        costUsd: null,
        unpricedModels: ['qwen3'],
        sessions: 7,
        turns: 20,
        toolCalls: 0,
        asks: 0,
        cacheHitPercent: 0,
      },
    ],
    byMonth: [],
  }
  const html = renderToStaticMarkup(<UsageView usage={usage} label="本月" />)

  test('六张卡：tokens、花费、会话数、cache 命中率、工具调用、权限请求', () => {
    expect(html).toContain('184.4k')
    expect(html).toContain('$3.42')
    expect(html).toContain('47')
    expect(html).toContain('62%')
    expect(html).toContain('工具调用')
    expect(html).toContain('权限请求')
  })

  test('未定价的模型显示「—」而不是 $0，并在下面点名', () => {
    const bars = renderToStaticMarkup(<ModelBars rows={usage.byModel} />)
    expect(bars).toContain('—')
    expect(bars).not.toContain('$0.00')
    expect(html).toContain('价目表里没有这些模型')
    expect(fmtCost(null)).toBe('—')
    expect(fmtCost(0.0048)).toBe('$0.005')
    expect(fmtTokens(184_400)).toBe('184.4k')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
  })

  test('柱子是手写 SVG，长度按花费', () => {
    const bars = renderToStaticMarkup(<ModelBars rows={usage.byModel} />)
    expect(bars).toContain('<svg')
    expect(bars).toContain('width="100%"')
    expect(bars).toContain('claude-sonnet-4-5')
  })

  test('本月 / 上月 / 全部的窗口是左闭右开的自然月', () => {
    const now = new Date(2026, 8, 18, 10).getTime()
    const month = rangeOf('month', now)
    expect(new Date(month.from).getDate()).toBe(1)
    expect(new Date(month.from).getMonth()).toBe(8)
    expect(new Date(month.to).getMonth()).toBe(9)
    const prev = rangeOf('prev', now)
    expect(new Date(prev.from).getMonth()).toBe(7)
    expect(prev.to).toBe(month.from)
    expect(rangeOf('all', now).from).toBe(0)
  })
})


describe('PRD-M11-005 AC-1 · 审核档位', () => {
  test('RuntimeTab 渲染三档下拉（on-demand/always-ask/allow-all），当前值选中', () => {
    const html = renderToStaticMarkup(<RuntimeTab s={s} />)
    expect(html).toContain('on-demand')
    expect(html).toContain('always-ask')
    expect(html).toContain('allow-all')
  })
})
