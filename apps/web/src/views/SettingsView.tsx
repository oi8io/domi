/**
 * 设置（`#/settings/<tab>`）—— PRD-M8-012（原型 #view-settings，7 个 tab）。
 * 通用 / 模型供应商 / 记忆管理经 config.get / config.set 读写（PRD-M8-011）；通讯工具只留入口。
 * Soul 与人格、插件两个 tab 吸收了原来的 SoulPanel / PluginPanel（PRD-M8-012 AC-5 / AC-6）。
 */
import { type DomiClient, PALETTES, TOKENS } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { cn } from '../lib/cn.ts'
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
import { SoulTab } from './settings/SoulTab.tsx'
import { UsageTab } from './settings/UsageTab.tsx'
import { str, useSettings } from './settings/useSettings.ts'

const TABS: Array<[SettingsTab, string]> = [
  ['general', '通用'],
  ['models', '模型供应商'],
  ['messaging', '通讯工具'],
  ['memory', '记忆管理'],
  ['soul', 'Soul 与人格'],
  ['plugins', '插件'],
  ['usage', '用量统计'],
]

type TabProps = { s: ReturnType<typeof useSettings> }

function GeneralTab({ s }: TabProps) {
  const choice = useStore($themeChoice)
  const accent = useStore($accent)
  const mode = resolveMode(choice, useStore($systemDark))
  return (
    <>
      <Saved error={s.error} saved={s.saved} />
      <Field label="界面语言" hint="选择 domi 界面显示语言" id="set-lang">
        <select id="set-lang" className="field-input" defaultValue="zh-CN">
          <option value="zh-CN">简体中文</option>
          <option value="en" disabled>
            English（即将支持）
          </option>
          <option value="ja" disabled>
            日本語（即将支持）
          </option>
        </select>
      </Field>
      <Field label="主题" hint="深浅跟随这台设备；主题色在 Web 与 TUI 之间共用" id="set-theme">
        <select
          id="set-theme"
          className="field-input mb-2.5"
          value={choice}
          onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
        >
          <option value="system">跟随系统</option>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
        <fieldset className="flex flex-wrap gap-2" aria-label="主题色">
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

const PROVIDERS: Array<{ id: string; label: string; key: string; url: string }> = [
  { id: 'anthropic', label: 'Anthropic', key: 'sk-ant-...', url: 'https://api.anthropic.com' },
  { id: 'openai', label: 'OpenAI', key: 'sk-...', url: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', key: 'sk-...', url: 'https://api.deepseek.com/v1' },
]
const SOURCE_LABEL = { env: '环境变量', secrets: 'secrets.yaml', config: 'config.yaml' } as const

function keyHint(
  sec: { set: boolean; masked?: string | undefined; source?: 'env' | 'secrets' | 'config' | undefined } | undefined,
): string {
  if (!sec?.set) return '还没有 key'
  const where = sec.source === undefined ? '' : `（来自${SOURCE_LABEL[sec.source]}）`
  const env = sec.source === 'env' ? '，环境变量优先，这里改了不会生效' : ''
  return `当前 ${sec.masked ?? ''}${where}${env}。留空不改`
}

function ModelsTab({ s }: TabProps) {
  const d = s.data
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (d === null) return <Saved error={s.error} saved={null} />
  const val = (k: string): string => draft[k] ?? str(d.values[k])
  const set = (k: string, v: string): void => setDraft({ ...draft, [k]: v })
  const submit = async (): Promise<void> => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(draft)) {
      if (k.endsWith('.api_key')) {
        if (v.trim() !== '') patch[k] = v.trim()
      } else if (k === 'providers.openai-compatible.models') {
        patch[k] = v
          .split(/[,，\s]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      } else {
        patch[k] = v.trim() === '' ? null : v.trim()
      }
    }
    if (Object.keys(patch).length === 0) return
    if (await s.save(patch)) setDraft({})
  }
  const compat = 'openai-compatible'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Saved error={s.error} saved={s.saved} />
      <Field label="默认模型" hint="新建会话时使用；已经开着的会话不受影响">
        <div className="grid grid-cols-[180px_1fr] gap-2.5">
          <select
            className="field-input"
            aria-label="默认供应商"
            value={val('model.provider')}
            onChange={(e) => set('model.provider', e.target.value)}
          >
            {[...PROVIDERS.map((p) => [p.id, p.label]), [compat, 'OpenAI 兼容网关']].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="field-input font-mono"
            aria-label="默认模型名"
            value={val('model.name')}
            onChange={(e) => set('model.name', e.target.value)}
          />
        </div>
      </Field>
      {PROVIDERS.map((p) => (
        <Field key={p.id} label={p.label} hint={keyHint(d.secrets[p.id])}>
          <div className="grid grid-cols-2 gap-2.5">
            <input
              className="field-input font-mono"
              type="password"
              autoComplete="off"
              aria-label={`${p.label} API Key`}
              placeholder={p.key}
              value={draft[`providers.${p.id}.api_key`] ?? ''}
              onChange={(e) => set(`providers.${p.id}.api_key`, e.target.value)}
            />
            <input
              className="field-input font-mono"
              type="text"
              aria-label={`${p.label} Base URL`}
              placeholder={p.url}
              value={val(`providers.${p.id}.base_url`)}
              onChange={(e) => set(`providers.${p.id}.base_url`, e.target.value)}
            />
          </div>
        </Field>
      ))}
      <Field label="OpenAI 兼容网关" hint={keyHint(d.secrets[compat])}>
        <div className="grid grid-cols-2 gap-2.5">
          <input
            className="field-input font-mono"
            type="text"
            aria-label="网关 Base URL"
            placeholder="Base URL"
            value={val(`providers.${compat}.base_url`)}
            onChange={(e) => set(`providers.${compat}.base_url`, e.target.value)}
          />
          <input
            className="field-input font-mono"
            type="password"
            autoComplete="off"
            aria-label="网关 API Key"
            placeholder="API Key"
            value={draft[`providers.${compat}.api_key`] ?? ''}
            onChange={(e) => set(`providers.${compat}.api_key`, e.target.value)}
          />
        </div>
        <input
          className="field-input mt-1.5 font-mono"
          aria-label="网关模型"
          placeholder="网关上的模型名，逗号分隔"
          value={draft[`providers.${compat}.models`] ?? (d.values[`providers.${compat}.models`] as string[]).join(', ')}
          onChange={(e) => set(`providers.${compat}.models`, e.target.value)}
        />
      </Field>
      <p className="mb-4 text-[11.5px] text-mut">
        key 只写进 <code>{d.paths.secrets}</code>（权限 0600），不写进 <code>{d.paths.config}</code>，也不会回显到这里。
        {d.secretsTooOpen && <span className="text-bad"> 这个文件的权限比 0600 宽，建议 chmod 600。</span>}
      </p>
      <Button type="submit" variant="primary" disabled={Object.keys(draft).length === 0}>
        保存
      </Button>
    </form>
  )
}

function MessagingTab() {
  return (
    <>
      <Notice>通讯工具即将支持。</Notice>
      <ToggleRow label="Telegram 桥接" hint="只读轨迹 + 远程审批（即将支持）" on={false} disabled />
      <ToggleRow label="微信桥接" hint="仅只读通知（即将支持）" on={false} disabled />
    </>
  )
}

const STRATEGY = [
  ['full', '不处理（整段历史原样发给模型）'],
  ['clean', '结构化清理（去重工具结果、清错误、截断堆栈）'],
  ['compact', '清理 + 自动压缩（到阈值时摘要旧的轮次）'],
] as const

function MemoryTab({ s }: TabProps) {
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
      <Field label="上下文策略" hint="发给模型之前怎么处理历史">
        <select
          className="field-input"
          aria-label="上下文策略"
          value={val('context.strategy')}
          onChange={(e) => set('context.strategy', e.target.value)}
        >
          {STRATEGY.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {num('context.keepTurns', '最近 N 轮逐字保留', '压缩时最近 N 轮不摘要，建议 6-10（自动压缩时才用）', !compact)}
      {num(
        'context.compactAt',
        'Context 压缩触发阈值',
        '上下文占用超此百分比自动压缩，建议 70-75（自动压缩时才用）',
        !compact,
      )}
      {num('memory.extractEvery', '记忆抽取间隔', '每多少轮自动抽取 L3 语义记忆，0 = 不自动抽（重启 domid 后生效）')}
      <Button type="submit" variant="primary" disabled={Object.keys(draft).length === 0}>
        保存
      </Button>
    </form>
  )
}

export function SettingsView({ client, tab, online }: { client: DomiClient; tab: SettingsTab; online: boolean }) {
  const s = useSettings(client, online)
  return (
    <Page view="settings" title="设置" sub="配置 domi 的行为、外观和连接。">
      <div className="grid grid-cols-[160px_1fr] gap-7">
        <nav className="flex flex-col gap-0.5" aria-label="设置分类">
          {TABS.map(([id, label]) => (
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
          {tab === 'models' && (online ? <ModelsTab s={s} /> : <Notice>连上 daemon 后显示。</Notice>)}
          {tab === 'messaging' && <MessagingTab />}
          {tab === 'memory' && (online ? <MemoryTab s={s} /> : <Notice>连上 daemon 后显示。</Notice>)}
          {tab === 'usage' && (online ? <UsageTab client={client} /> : <Notice>连上 daemon 后显示。</Notice>)}
          {(tab === 'soul' || tab === 'plugins') &&
            (online ? (
              tab === 'soul' ? (
                <SoulTab client={client} />
              ) : (
                <PluginsTab client={client} />
              )
            ) : (
              <Notice>连上 daemon 后显示。</Notice>
            ))}
        </div>
      </div>
    </Page>
  )
}
