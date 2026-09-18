/**
 * PRD-M9-002 AC-4 / AC-5 · PRD-M9-003 AC-1 / AC-2 · 设置页「模型供应商」与对话里的模型下拉
 *
 * 渲染用 renderToStaticMarkup（与其它设置页测试一致）；表单 → 补丁的换算是纯函数，直接断言。
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { groupByProvider, optionLabel } from '../src/session/Composer.tsx'
import {
  formOf,
  idFromName,
  type ModelList,
  type ProviderRow,
  ProvidersView,
  providerPatch,
  type Vendor,
} from '../src/views/settings/ProvidersTab.tsx'
import type { Settings } from '../src/views/settings/useSettings.ts'

const ALL = { toolCall: true, vision: true, reasoning: true, promptCache: true, structuredOutput: true }
const NONE = { toolCall: false, vision: false, reasoning: false, promptCache: false, structuredOutput: false }
const vendors: Vendor[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    capabilities: { ...ALL, structuredOutput: false },
    keyHint: 'sk-ant-...',
    envNames: ['ANTHROPIC_API_KEY'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    capabilities: { ...NONE, toolCall: true, reasoning: true },
    keyHint: 'sk-...',
    envNames: ['DEEPSEEK_API_KEY'],
  },
  { id: 'custom', label: 'Custom', protocol: 'openai', capabilities: NONE, keyHint: '', envNames: [] },
]

const row = (over: Partial<ProviderRow>): ProviderRow => ({
  id: 'x',
  name: 'X',
  vendor: 'custom',
  protocol: 'openai',
  baseUrl: null,
  enabled: true,
  models: [],
  capabilities: {},
  inferred: false,
  isDefault: false,
  key: { set: false },
  ...over,
})

const settings: Settings = {
  values: { 'model.provider': 'anthropic', 'model.name': 'claude-sonnet-4-5' },
  secrets: {},
  providers: [
    row({
      id: 'anthropic',
      name: 'Anthropic',
      vendor: 'anthropic',
      protocol: 'anthropic',
      isDefault: true,
      key: { set: true, masked: 'sk-ant…4f2a', source: 'secrets' },
    }),
    row({ id: 'my-gw', name: '公司网关', baseUrl: 'https://gw.example/v1', models: ['glm-4.6'], inferred: true }),
    row({ id: 'deepseek', name: 'DeepSeek', vendor: 'deepseek', enabled: false }),
  ],
  paths: { config: '/c/config.yaml', secrets: '/c/secrets.yaml' },
  secretsTooOpen: false,
  writable: [],
}

const entry = (
  provider: string,
  providerName: string,
  name: string,
  source: 'probe' | 'manual' | 'fallback' = 'probe',
) => ({
  provider,
  providerName,
  name,
  source,
  vision: true,
  toolCall: true,
})
const models: ModelList = {
  models: [
    entry('anthropic', 'Anthropic', 'claude-sonnet-4-5'),
    entry('anthropic', 'Anthropic', 'claude-opus-4-1'),
    entry('my-gw', '公司网关', 'glm-4.6', 'manual'),
    entry('my-gw', '公司网关', 'claude-opus-4-1', 'manual'),
  ],
  providers: [
    { id: 'anthropic', name: 'Anthropic', status: 'ok' },
    { id: 'my-gw', name: '公司网关', status: 'fallback', error: 'HTTP 401' },
  ],
  current: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
}

const view = (over: Partial<Parameters<typeof ProvidersView>[0]> = {}) =>
  renderToStaticMarkup(
    <ProvidersView
      settings={settings}
      vendors={vendors}
      models={models}
      error={null}
      saved={null}
      probing={false}
      onSave={async () => true}
      onProbe={() => undefined}
      {...over}
    />,
  )

describe('PRD-M9-002 AC-4 · 供应商列表', () => {
  const html = view()

  test('每一家：名字、厂商、id、key 只有掩码；停用的标出来；推断出来的提示保存一次', () => {
    for (const t of ['Anthropic', '公司网关', 'my-gw', 'DeepSeek', 'sk-ant…4f2a', '已停用', '按旧写法推断的厂商'])
      expect(html).toContain(t)
    expect(html).not.toContain('sk-ant-api')
  })

  test('探测失败的那一家写明原因，下面是手填的模型', () => {
    expect(html).toContain('探测失败（HTTP 401）')
    expect(html).toContain('·手填')
  })

  test('新增 / 重新探测两个入口；探测中按钮禁用', () => {
    expect(html).toContain('新增供应商')
    expect(html).toContain('重新探测')
    expect(view({ probing: true })).toContain('探测中…')
  })
})

describe('PRD-M9-003 AC-1 · 默认是一个模型', () => {
  test('默认模型显示在顶上；它在列表里是按下状态、不可再点；其余模型都能「设为默认」', () => {
    const html = view()
    expect(html).toContain('data-testid="default-model"')
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
    expect((html.match(/title="设为默认"/g) ?? []).length).toBe(3)
  })
})

describe('PRD-M9-002 AC-5 · 默认模型所在那一家不能删', () => {
  test('删除按钮禁用并说明原因', () => {
    const html = view()
    expect(html).toContain('title="默认模型在这一家，先把默认模型换到别家"')
  })
})

describe('PRD-M9-002 AC-4 · 编辑表单', () => {
  test('新增：七项齐全（名称 / ID / 厂商 / 协议 / Base URL / API Key / 启用）+ 能力五项 + 手填模型', () => {
    const html = view({ initialEditing: 'new' })
    for (const label of [
      '名称',
      'ID',
      '厂商',
      '协议',
      'Base URL',
      'API Key',
      '启用',
      '手填模型',
      '工具调用',
      '看图',
      '思考过程',
      '提示缓存',
      '结构化输出',
    ])
      expect(html).toContain(`aria-label="${label}"`)
    // 选了模板就带出默认地址作占位
    expect(html).toContain('placeholder="https://api.anthropic.com"')
  })

  test('id 从名字生成；全中文名字退回厂商名；重名加序号', () => {
    expect(idFromName('My Gateway!', 'custom', [])).toBe('my-gateway')
    expect(idFromName('公司网关', 'custom', [])).toBe('custom')
    expect(idFromName('公司网关', 'custom', ['custom', 'custom-2'])).toBe('custom-3')
  })

  test('新增的补丁：名字 / 厂商 / 协议 / 地址 / key / 启用 / 模型都写上；能力只存与模板不同的项', () => {
    const custom = vendors[2] as Vendor
    const f = {
      ...formOf(null, custom),
      id: 'my-gw2',
      name: '网关二',
      protocol: 'anthropic' as const,
      baseUrl: ' https://gw2 ',
      apiKey: 'sk-1',
      models: 'a, b，c',
    }
    f.caps = { ...f.caps, toolCall: true }
    expect(providerPatch(f, null, custom)).toEqual({
      'providers.my-gw2.name': '网关二',
      'providers.my-gw2.vendor': 'custom',
      'providers.my-gw2.protocol': 'anthropic',
      'providers.my-gw2.base_url': 'https://gw2',
      'providers.my-gw2.api_key': 'sk-1',
      'providers.my-gw2.enabled': true,
      'providers.my-gw2.models': ['a', 'b', 'c'],
      'providers.my-gw2.capabilities': { toolCall: true },
    })
  })

  test('编辑的补丁：只写变了的；key 留空不改；推断出来的条目顺带把厂商写实', () => {
    const custom = vendors[2] as Vendor
    const original = settings.providers[1] as ProviderRow
    const f = formOf(original, custom)
    expect(providerPatch(f, original, custom)).toEqual({
      'providers.my-gw.vendor': 'custom',
      'providers.my-gw.protocol': 'openai',
    })
    const settled = { ...original, inferred: false }
    expect(providerPatch({ ...f, enabled: false, baseUrl: '' }, settled, custom)).toEqual({
      'providers.my-gw.enabled': false,
      'providers.my-gw.base_url': null,
    })
    // 能力改回与模板一致 → 删掉覆盖
    const withCaps = { ...settled, capabilities: { toolCall: true } }
    expect(providerPatch(formOf(withCaps, custom), withCaps, custom)).toEqual({})
    expect(providerPatch({ ...formOf(withCaps, custom), caps: NONE }, withCaps, custom)).toEqual({
      'providers.my-gw.capabilities': null,
    })
  })
})

describe('PRD-M9-003 AC-2 · 对话里的模型下拉', () => {
  test('按供应商分组、保持顺序；同名模型在两家各占一行，补全里带归属', () => {
    const groups = groupByProvider(models.models)
    expect(groups.map(([n, g]) => [n, g.map((m) => m.name)])).toEqual([
      ['Anthropic', ['claude-sonnet-4-5', 'claude-opus-4-1']],
      ['公司网关', ['glm-4.6', 'claude-opus-4-1']],
    ])
    expect(models.models.filter((m) => m.name === 'claude-opus-4-1').map(optionLabel)).toEqual([
      'claude-opus-4-1 · Anthropic',
      'claude-opus-4-1 · 公司网关',
    ])
  })
})
