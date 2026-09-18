/**
 * PRD-M9-004 AC-1 / AC-2 / AC-3 · Web 按当前语言渲染
 *
 * 同一个组件，切到 English 之后渲染出来一个中文字都没有（界面文案全部走 tr()，这是 guard:i18n 的运行时对照）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { setLocale } from '@domi/i18n'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeneralTab, MemoryTab } from '../src/views/SettingsView.tsx'
import { ProvidersView } from '../src/views/settings/ProvidersTab.tsx'
import type { Settings } from '../src/views/settings/useSettings.ts'

afterEach(() => setLocale('zh'))

const CJK = /[㐀-鿿]/

const settings: Settings = {
  values: {
    'model.provider': 'anthropic',
    'model.name': 'claude-sonnet-4-5',
    'context.strategy': 'compact',
    'context.keepTurns': 2,
    'context.compactAt': 70,
    'memory.extractEvery': 5,
    'ui.locale': 'en',
  },
  secrets: {},
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      vendor: 'anthropic',
      protocol: 'anthropic',
      baseUrl: null,
      enabled: true,
      models: [],
      capabilities: {},
      inferred: false,
      isDefault: true,
      key: { set: false },
    },
  ],
  paths: { config: '/c/config.yaml', secrets: '/c/secrets.yaml' },
  secretsTooOpen: true,
  writable: [],
}
const s = { data: settings, error: null, saved: null, save: async () => true, reload: () => undefined }

describe('PRD-M9-004 · Web 的界面语言', () => {
  test('English：设置页的几个 tab 渲染出来没有中文', () => {
    setLocale('en')
    const html = [
      renderToStaticMarkup(<GeneralTab s={s} />),
      renderToStaticMarkup(<MemoryTab s={s} />),
      renderToStaticMarkup(
        <ProvidersView
          settings={settings}
          vendors={[]}
          models={null}
          error={null}
          saved={null}
          probing={false}
          onSave={async () => true}
          onProbe={() => undefined}
        />,
      ),
    ].join('')
    // 「简体中文」是语言选项本身的名字，按惯例用该语言自己的写法
    expect(html.replace('简体中文', '')).not.toMatch(CJK)
    expect(html).toContain('Interface language')
    expect(html).toContain('Default model')
  })

  test('中文：同一个组件照旧是中文', () => {
    const html = renderToStaticMarkup(<GeneralTab s={s} />)
    expect(html).toContain('界面语言')
  })
})
