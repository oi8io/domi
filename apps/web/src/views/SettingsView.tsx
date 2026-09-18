/**
 * 设置（`#/settings/<tab>`）—— PRD-M8-012（原型 #view-settings，7 个 tab）。
 * 通用 / 模型供应商 / 记忆管理经 config.get / config.set 读写（PRD-M8-011）；通讯工具只留入口。
 * 模型供应商在 `settings/ProvidersTab.tsx`（PRD-M9-002：任意多家、增删改、默认是一个模型）。
 * Soul 与人格、插件两个 tab 吸收了原来的 SoulPanel / PluginPanel（PRD-M8-012 AC-5 / AC-6）。
 */

import { type DomiClient, PALETTES, TOKENS } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'
import { syncLocale } from '../locale.ts'
import { formatRoute, type SettingsTab } from '../router.ts'
import {
  $accent,
  $systemDark,
  $themeChoice,
  resolveMode,
  setAccent,
  setThemeChoice,
  type ThemeChoice,
} from '../theme/store.ts'
import { Notice, Page } from './Page.tsx'
import { Field, Saved, ToggleRow } from './settings/fields.tsx'
import { PluginsTab } from './settings/PluginsTab.tsx'
import { ProvidersTab } from './settings/ProvidersTab.tsx'
import { SoulTab } from './settings/SoulTab.tsx'
import { UsageTab } from './settings/UsageTab.tsx'
import { str, useSettings } from './settings/useSettings.ts'

const TABS = (): Array<[SettingsTab, string]> => [
  ['general', tr('web.settings.general')],
  ['models', tr('web.settings.models')],
  ['messaging', tr('web.settings.messaging')],
  ['memory', tr('web.settings.memory')],
  ['soul', tr('web.settings.soul')],
  ['plugins', tr('web.settings.plugins')],
  ['usage', tr('web.settings.usage')],
]

type TabProps = { s: ReturnType<typeof useSettings> }

export function GeneralTab({ s }: TabProps) {
  const choice = useStore($themeChoice)
  const accent = useStore($accent)
  const mode = resolveMode(choice, useStore($systemDark))
  return (
    <>
      <Saved error={s.error} saved={s.saved} />
      <Field label={tr('web.settings.language')} hint={tr('web.settings.languageHint')} id="set-lang">
        <select
          id="set-lang"
          className="field-input"
          value={str(s.data?.values['ui.locale']) || 'auto'}
          disabled={s.data === null}
          onChange={(e) => {
            const v = e.target.value
            void s.save({ 'ui.locale': v }).then((ok) => ok && syncLocale(v))
          }}
        >
          <option value="auto">{tr('common.followSystem')}</option>
          <option value="zh">{tr('web.settings.langZh')}</option>
          <option value="en">{tr('web.settings.langEn')}</option>
        </select>
      </Field>
      <Field label={tr('web.settings.theme')} hint={tr('web.settings.themeHint')} id="set-theme">
        <select
          id="set-theme"
          className="field-input mb-2.5"
          value={choice}
          onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
        >
          <option value="system">{tr('common.followSystem')}</option>
          <option value="dark">{tr('web.settings.dark')}</option>
          <option value="light">{tr('web.settings.light')}</option>
        </select>
        <fieldset className="flex flex-wrap gap-2" aria-label={tr('web.settings.accent')}>
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={accent === p.id}
              aria-label={p.label}
              title={p.label}
              data-palette={p.id}
              onClick={() => {
                setAccent(p.id)
                if (s.data !== null) void s.save({ 'ui.accent': p.id })
              }}
              className={cn(
                'relative h-9 w-[54px] overflow-hidden rounded-sm border-2',
                accent === p.id ? 'border-accent' : 'border-border',
              )}
              style={{ background: TOKENS[mode].bg }}
            >
              <span
                className="absolute right-[5px] bottom-[5px] size-2.5 rounded-full"
                style={{ background: p[mode].accent }}
              />
            </button>
          ))}
        </fieldset>
      </Field>
    </>
  )
}

function MessagingTab() {
  return (
    <>
      <Notice>{tr('web.settings.messagingSoon')}</Notice>
      <ToggleRow label={tr('web.settings.telegram')} hint={tr('web.settings.telegramHint')} on={false} disabled />
      <ToggleRow label={tr('web.settings.wechat')} hint={tr('web.settings.wechatHint')} on={false} disabled />
    </>
  )
}

const STRATEGY = () =>
  [
    ['full', tr('web.settings.strategyFull')],
    ['clean', tr('web.settings.strategyClean')],
    ['compact', tr('web.settings.strategyCompact')],
  ] as const

export function MemoryTab({ s }: TabProps) {
  const d = s.data
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (d === null) return <Saved error={s.error} saved={null} />
  const val = (k: string): string => draft[k] ?? str(d.values[k])
  const set = (k: string, v: string): void => setDraft({ ...draft, [k]: v })
  const compact = val('context.strategy') === 'compact'
  const num = (k: string, label: string, hint: string, disabled = false) => (
    <Field label={label} hint={hint}>
      <input
        className="field-input"
        type="number"
        aria-label={label}
        disabled={disabled}
        value={val(k)}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const patch: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(draft)) patch[k] = k === 'context.strategy' ? v : Number(v)
        void s.save(patch).then((ok) => ok && setDraft({}))
      }}
    >
      <Saved error={s.error} saved={s.saved} />
      <Field label={tr('web.settings.strategy')} hint={tr('web.settings.strategyHint')}>
        <select
          className="field-input"
          aria-label={tr('web.settings.strategy')}
          value={val('context.strategy')}
          onChange={(e) => set('context.strategy', e.target.value)}
        >
          {STRATEGY().map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {num('context.keepTurns', tr('web.settings.keepTurns'), tr('web.settings.keepTurnsHint'), !compact)}
      {num('context.compactAt', tr('web.settings.compactAt'), tr('web.settings.compactAtHint'), !compact)}
      {num('memory.extractEvery', tr('web.settings.extractEvery'), tr('web.settings.extractEveryHint'))}
      <Button type="submit" variant="primary" disabled={Object.keys(draft).length === 0}>
        {tr('common.save')}
      </Button>
    </form>
  )
}

export function SettingsView({ client, tab, online }: { client: DomiClient; tab: SettingsTab; online: boolean }) {
  const s = useSettings(client, online)
  return (
    <Page view="settings" title={tr('web.sidebar.settings')} sub={tr('web.settings.sub')}>
      <div className="grid grid-cols-[160px_1fr] gap-7">
        <nav className="flex flex-col gap-0.5" aria-label={tr('web.settings.nav')}>
          {TABS().map(([id, label]) => (
            <a
              key={id}
              href={formatRoute({ view: 'settings', tab: id })}
              aria-current={tab === id ? 'page' : undefined}
              className={cn(
                'rounded-sm px-2.5 py-1.5 text-[13px] text-ink2 hover:bg-panel-h',
                tab === id && 'bg-accent-d font-medium text-accent hover:bg-accent-d',
              )}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="min-w-0" data-tab={tab}>
          {tab === 'general' && <GeneralTab s={s} />}
          {tab === 'models' &&
            (online ? <ProvidersTab client={client} s={s} /> : <Notice>{tr('web.common.connectFirstDot')}</Notice>)}
          {tab === 'messaging' && <MessagingTab />}
          {tab === 'memory' && (online ? <MemoryTab s={s} /> : <Notice>{tr('web.common.connectFirstDot')}</Notice>)}
          {tab === 'usage' &&
            (online ? <UsageTab client={client} /> : <Notice>{tr('web.common.connectFirstDot')}</Notice>)}
          {(tab === 'soul' || tab === 'plugins') &&
            (online ? (
              tab === 'soul' ? (
                <SoulTab client={client} />
              ) : (
                <PluginsTab client={client} />
              )
            ) : (
              <Notice>{tr('web.common.connectFirstDot')}</Notice>
            ))}
        </div>
      </div>
    </Page>
  )
}
