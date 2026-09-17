/**
 * 设置（`#/settings/<tab>`）—— PRD-M8-012（原型 #view-settings，7 个 tab）。
 * 「通用」的主题与色板现在就能用；需要配置读写接口（TASK-M8-007）的 tab 先按原型画出来并置灰。
 * Soul 与插件暂时装着原来的面板，在 TASK-M8-008 里按原型重写。
 */
import { type DomiClient, PALETTES, TOKENS } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { PluginPanel } from '../PluginPanel.tsx'
import { formatRoute, type SettingsTab } from '../router.ts'
import { SoulPanel } from '../SoulPanel.tsx'
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

const TABS: Array<[SettingsTab, string]> = [
  ['general', '通用'],
  ['models', '模型供应商'],
  ['messaging', '通讯工具'],
  ['memory', '记忆管理'],
  ['soul', 'Soul 与人格'],
  ['plugins', '插件'],
  ['usage', '用量统计'],
]

const PENDING = '这一页的设置要等配置读写接口，目前只能在 ~/.domi/config.yaml 里改。'

function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <div className="mb-[18px]">
      <label className="mb-[3px] block text-[13px] font-medium" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && <div className="mb-[5px] text-[11.5px] text-mut">{hint}</div>}
      {children}
    </div>
  )
}

function ToggleRow({ label, hint, on, disabled }: { label: string; hint: string; on: boolean; disabled?: boolean }) {
  return (
    <div className="mb-[18px] flex items-center justify-between py-1.5">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11.5px] text-mut">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-[10px] transition-colors duration-150',
          on ? 'bg-accent-e' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] left-[3px] size-3.5 rounded-full bg-white transition-transform duration-150',
            on && 'translate-x-4',
          )}
        />
      </button>
    </div>
  )
}

function GeneralTab() {
  const choice = useStore($themeChoice)
  const accent = useStore($accent)
  const mode = resolveMode(choice, useStore($systemDark))
  return (
    <>
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
      <Field label="主题" hint="跟随系统或手动选择；主题色在 Web 与 TUI 之间共用" id="set-theme">
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
              onClick={() => setAccent(p.id)}
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

function ModelsTab() {
  return (
    <fieldset disabled className="contents">
      <Notice>{PENDING}</Notice>
      <Field label="默认模型" hint="新建会话时使用">
        <select className="field-input">
          <option>claude-sonnet-4-5 (Anthropic)</option>
        </select>
      </Field>
      {(
        [
          ['Anthropic', 'sk-ant-...', 'https://api.anthropic.com'],
          ['OpenAI', 'sk-...', 'https://api.openai.com/v1'],
          ['DeepSeek', 'sk-...', 'https://api.deepseek.com'],
        ] as const
      ).map(([name, key, url]) => (
        <Field key={name} label={name} hint={`不填则用环境变量里的 key`}>
          <div className="grid grid-cols-2 gap-2.5">
            <input className="field-input font-mono" type="password" placeholder={key} />
            <input className="field-input font-mono" type="text" placeholder={url} />
          </div>
        </Field>
      ))}
      <Field label="OpenAI 兼容网关">
        <div className="grid grid-cols-2 gap-2.5">
          <input className="field-input font-mono" type="text" placeholder="Base URL" />
          <input className="field-input font-mono" type="password" placeholder="API Key" />
        </div>
      </Field>
    </fieldset>
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

function MemoryTab() {
  return (
    <fieldset disabled className="contents">
      <Notice>{PENDING}</Notice>
      <Field label="最近 N 轮逐字保留" hint="压缩时最近 N 轮不摘要，建议 6-10">
        <input className="field-input" type="number" defaultValue={8} />
      </Field>
      <Field label="Context 压缩触发阈值" hint="上下文占用超此百分比自动压缩，建议 70-75%">
        <input className="field-input" type="number" defaultValue={72} />
      </Field>
      <Field label="记忆抽取间隔" hint="每多少轮自动抽取 L3 语义记忆">
        <input className="field-input" type="number" defaultValue={5} />
      </Field>
      <ToggleRow label="结构化清理" hint="去重工具结果、清错误、截断堆栈" on disabled />
    </fieldset>
  )
}

function UsageTab() {
  return <Notice>用量统计即将可用：按月、按模型汇总 tokens、花费与 cache 命中率。</Notice>
}

export function SettingsView({ client, tab, online }: { client: DomiClient; tab: SettingsTab; online: boolean }) {
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
          {tab === 'general' && <GeneralTab />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'messaging' && <MessagingTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'usage' && <UsageTab />}
          {(tab === 'soul' || tab === 'plugins') &&
            (online ? (
              <div className="legacy">
                {tab === 'soul' ? <SoulPanel client={client} /> : <PluginPanel client={client} />}
              </div>
            ) : (
              <Notice>连上 daemon 后显示。</Notice>
            ))}
        </div>
      </div>
    </Page>
  )
}
