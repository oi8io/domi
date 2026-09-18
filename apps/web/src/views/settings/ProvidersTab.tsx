/**
 * 设置 › 模型供应商 —— PRD-M9-002 AC-4/AC-5 · PRD-M9-003 AC-1 · PRD-M9-001 AC-3
 *
 * 一个 provider = 名称 / 厂商模板 / 协议 / 地址 / key / 启停 / 能力 / 手填模型，可增删改；
 * 「默认」是一个**模型**（在某一家的模型列表里点「设为默认」），provider 上没有默认开关。
 * 厂商名单来自 daemon 的 `provider.vendors`，这里不写一份（`guard:providers`）。
 *
 * 纯展示（ProvidersView）与取数（ProvidersTab）分开：前者测试直接渲染，后者只管请求。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Field, Saved, ToggleRow } from './fields.tsx'
import type { Settings } from './useSettings.ts'

export type ProviderRow = Settings['providers'][number]
export type Vendor = Awaited<ReturnType<DomiClient['listVendors']>>['vendors'][number]
export type ModelList = Awaited<ReturnType<DomiClient['listModels']>>
type Caps = Vendor['capabilities']

const CAP_LABEL = (): Array<[keyof Caps, string, string]> => [
  ['toolCall', tr('web.providers.cap.toolCall'), tr('web.providers.cap.toolCallHint')],
  ['vision', tr('web.providers.cap.vision'), tr('web.providers.cap.visionHint')],
  ['reasoning', tr('web.providers.cap.reasoning'), tr('web.providers.cap.reasoningHint')],
  ['promptCache', tr('web.providers.cap.promptCache'), tr('web.providers.cap.promptCacheHint')],
  ['structuredOutput', tr('web.providers.cap.structured'), tr('web.providers.cap.structuredHint')],
]

/** 协议下拉：每种协议取第一家说这种协议、且不是 custom 的厂商名作标签（openai → 「OpenAI 兼容」） */
export function protocolOptions(vendors: readonly Vendor[]): Array<[Vendor['protocol'], string]> {
  const out = new Map<Vendor['protocol'], string>()
  for (const v of vendors) if (v.id !== 'custom' && !out.has(v.protocol)) out.set(v.protocol, v.label)
  return [...out].map(([p, label]) => [p, tr('web.providers.compatible', { label })])
}

const SOURCE_LABEL = () => ({ env: tr('common.envVar'), secrets: 'secrets.yaml', config: 'config.yaml' }) as const

/** 编辑中的一家 */
export interface ProviderForm {
  id: string
  name: string
  vendor: string
  protocol: Vendor['protocol']
  baseUrl: string
  apiKey: string
  enabled: boolean
  models: string
  caps: Caps
}

/** 从名字生成 id：只留小写字母数字与 -；名字里没有能用的字符（例如全中文）就用厂商名 + 序号 */
export function idFromName(name: string, vendor: string, taken: readonly string[]): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const base = slug === '' ? vendor : slug
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`
}

export function formOf(p: ProviderRow | null, vendor: Vendor): ProviderForm {
  const caps = Object.fromEntries(
    (Object.keys(vendor.capabilities) as Array<keyof Caps>).map((c) => [
      c,
      p?.capabilities[c] ?? vendor.capabilities[c],
    ]),
  ) as Caps
  return {
    id: p?.id ?? '',
    name: p?.name ?? vendor.label,
    vendor: vendor.id,
    protocol: p?.protocol ?? vendor.protocol,
    baseUrl: p?.baseUrl ?? '',
    apiKey: '',
    enabled: p?.enabled ?? true,
    models: (p?.models ?? []).join(', '),
    caps,
  }
}

/**
 * 表单 → config.set 补丁。只写变了的；能力只存与模板不同的项（模板改了默认值，用户没碰过的项跟着走）；
 * key 留空 = 不改。新建时名字、厂商、协议都写上（不靠推断）
 */
export function providerPatch(f: ProviderForm, original: ProviderRow | null, vendor: Vendor): Record<string, unknown> {
  const k = (field: string) => `providers.${f.id}.${field}`
  const patch: Record<string, unknown> = {}
  const isNew = original === null
  if (isNew || f.name !== original.name) patch[k('name')] = f.name.trim()
  if (isNew || original.inferred || f.vendor !== original.vendor) patch[k('vendor')] = f.vendor
  if (f.vendor === 'custom' && (isNew || original.inferred || f.protocol !== original.protocol))
    patch[k('protocol')] = f.protocol
  const base = f.baseUrl.trim()
  if (isNew ? base !== '' : base !== (original.baseUrl ?? '')) patch[k('base_url')] = base === '' ? null : base
  if (f.apiKey.trim() !== '') patch[k('api_key')] = f.apiKey.trim()
  if (isNew || f.enabled !== original.enabled) patch[k('enabled')] = f.enabled
  const models = f.models
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (isNew ? models.length > 0 : models.join(',') !== original.models.join(',')) patch[k('models')] = models
  const diff = Object.fromEntries(
    (Object.keys(f.caps) as Array<keyof Caps>)
      .filter((c) => f.caps[c] !== vendor.capabilities[c])
      .map((c) => [c, f.caps[c]]),
  )
  const before = JSON.stringify(original?.capabilities ?? {})
  const after = JSON.stringify(diff)
  if (before !== after) patch[k('capabilities')] = Object.keys(diff).length === 0 ? null : diff
  return patch
}

function keyHint(key: ProviderRow['key'] | undefined, envNames: readonly string[]): string {
  if (!key?.set)
    return envNames.length > 0
      ? tr('web.providers.noKeyEnv', { join: envNames.join(' / ') })
      : tr('web.providers.noKey')
  const where = key.source === undefined ? '' : tr('web.providers.keyFrom', { v: SOURCE_LABEL()[key.source] })
  const env = key.source === 'env' ? tr('web.providers.envWins') : ''
  return tr('web.providers.keyCurrent', { v: key.masked ?? '', where, env })
}

export interface ProvidersViewProps {
  settings: Settings
  vendors: readonly Vendor[]
  models: ModelList | null
  error: string | null
  saved: string | null
  probing: boolean
  onSave: (patch: Record<string, unknown>) => Promise<boolean>
  onProbe: () => void
  /** 测试用：初始就打开某一家的编辑表单（'new' = 新增） */
  initialEditing?: string | null
}

export function ProvidersView(props: ProvidersViewProps) {
  const { settings, vendors, models } = props
  const [editing, setEditing] = useState<string | null>(props.initialEditing ?? null)
  const [armed, setArmed] = useState<string | null>(null)
  const current = { provider: String(settings.values['model.provider']), name: String(settings.values['model.name']) }
  // 厂商模板还没拿到（首屏）或 daemon 不认识这个厂商时是 undefined：只少了厂商名与环境变量提示，不能让整页崩掉
  const vendorOf = (id: string): Vendor | undefined => vendors.find((v) => v.id === id)
  const saveAndClose = async (patch: Record<string, unknown>): Promise<boolean> => {
    const ok = await props.onSave(patch)
    if (ok) setEditing(null)
    return ok
  }
  const setDefault = (provider: string, name: string) =>
    void props.onSave({ 'model.provider': provider, 'model.name': name })

  return (
    <div>
      <Saved error={props.error} saved={props.saved} />
      <Field label={tr('web.providers.defaultModel')} hint={tr('web.providers.defaultModelHint')}>
        <div className="font-mono text-[13px]" data-testid="default-model">
          {current.name}
          <span className="text-mut">
            {' · '}
            {settings.providers.find((p) => p.id === current.provider)?.name ?? current.provider}
          </span>
        </div>
      </Field>

      <div className="mb-3 flex items-center gap-2">
        <Button variant="primary" onClick={() => setEditing('new')} disabled={vendors.length === 0}>
          {tr('web.providers.add')}
        </Button>
        <Button onClick={props.onProbe} disabled={props.probing}>
          {props.probing ? tr('web.providers.probing') : tr('web.providers.reprobe')}
        </Button>
      </div>

      {editing === 'new' && vendors.length > 0 && (
        <ProviderEditor
          original={null}
          vendors={vendors}
          taken={settings.providers.map((p) => p.id)}
          onCancel={() => setEditing(null)}
          onSave={saveAndClose}
        />
      )}

      {settings.providers.map((p) => {
        const status = models?.providers.find((x) => x.id === p.id)
        const list = models?.models.filter((m) => m.provider === p.id) ?? []
        const vendor = vendorOf(p.vendor)
        return (
          <section
            key={p.id}
            className={cn('mb-3 rounded-md border border-border p-3', !p.enabled && 'opacity-60')}
            aria-label={p.name}
          >
            <header className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-medium">{p.name}</span>
              <span className="rounded-sm bg-panel-h px-1.5 text-[11px] text-mut">{vendor?.label ?? p.vendor}</span>
              <span className="font-mono text-[11px] text-mut">{p.id}</span>
              {p.isDefault && <span className="text-[11px] text-accent">{tr('web.providers.hasDefault')}</span>}
              <span className="ml-auto flex gap-1.5">
                <Button size="xs" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                  {tr('common.edit')}
                </Button>
                <Button
                  size="xs"
                  variant={armed === p.id ? 'armed' : 'danger'}
                  disabled={p.isDefault}
                  title={p.isDefault ? tr('web.providers.cannotDelete') : undefined}
                  onClick={() => {
                    if (armed !== p.id) return setArmed(p.id)
                    setArmed(null)
                    void props.onSave({ [`providers.${p.id}`]: null })
                  }}
                >
                  {armed === p.id ? tr('common.confirmDelete') : tr('common.delete')}
                </Button>
              </span>
            </header>
            <div className="mb-2 text-[11.5px] text-mut">
              {keyHint(p.key, vendor?.envNames ?? [])}
              {p.inferred && tr('web.providers.inferred')}
            </div>
            {!p.enabled ? (
              <div className="text-[12px] text-mut">{tr('web.providers.disabled')}</div>
            ) : (
              <>
                {status?.status === 'fallback' && (
                  <div className="mb-1.5 text-[12px] text-warn">
                    {tr('web.providers.probeFailed', { v: status.error ?? tr('common.unknownReason') })}
                  </div>
                )}
                <ul className="flex flex-wrap gap-1.5" aria-label={tr('web.providers.modelsOf', { name: p.name })}>
                  {list.map((m) => {
                    const isDefault = m.provider === current.provider && m.name === current.name
                    return (
                      <li key={m.name}>
                        <button
                          type="button"
                          className={cn(
                            'rounded-sm border px-2 py-0.5 font-mono text-[12px]',
                            isDefault ? 'border-accent text-accent' : 'border-border text-ink2 hover:bg-panel-h',
                          )}
                          title={isDefault ? tr('web.providers.defaultModel') : tr('web.providers.setDefault')}
                          aria-pressed={isDefault}
                          disabled={isDefault}
                          onClick={() => setDefault(m.provider, m.name)}
                        >
                          {m.name}
                          {m.source === 'manual' && <span className="text-mut"> {tr('web.providers.manualTag')}</span>}
                        </button>
                      </li>
                    )
                  })}
                  {list.length === 0 && <li className="text-[12px] text-mut">{tr('web.providers.noModels')}</li>}
                </ul>
              </>
            )}
            {editing === p.id && (
              <ProviderEditor
                original={p}
                vendors={vendors}
                taken={settings.providers.map((x) => x.id)}
                onCancel={() => setEditing(null)}
                onSave={saveAndClose}
              />
            )}
          </section>
        )
      })}

      <p className="mb-4 text-[11.5px] text-mut">
        {tr('web.providers.keyOnlyIn')} <code>{settings.paths.secrets}</code>
        {tr('web.providers.keyNotIn')} <code>{settings.paths.config}</code>
        {tr('web.providers.keyNoEcho')}
        {settings.secretsTooOpen && <span className="text-bad"> {tr('web.providers.tooOpen')}</span>}
      </p>
    </div>
  )
}

function ProviderEditor({
  original,
  vendors,
  taken,
  onCancel,
  onSave,
}: {
  original: ProviderRow | null
  vendors: readonly Vendor[]
  taken: readonly string[]
  onCancel: () => void
  onSave: (patch: Record<string, unknown>) => Promise<boolean>
}) {
  const first = vendors.find((v) => v.id === (original?.vendor ?? vendors[0]?.id)) as Vendor
  const [f, setF] = useState<ProviderForm>(() => formOf(original, first))
  const [idTouched, setIdTouched] = useState(false)
  const vendor = vendors.find((v) => v.id === f.vendor) ?? first
  const isNew = original === null
  const id = isNew && !idTouched ? idFromName(f.name, f.vendor, taken) : f.id
  const form = { ...f, id }
  const patch = providerPatch(form, original, vendor)
  const idOk = /^[a-z0-9][a-z0-9-]{0,31}$/.test(id) && (!isNew || !taken.includes(id))
  const up = (x: Partial<ProviderForm>) => setF({ ...f, ...x })
  return (
    <form
      className="mt-3 border-t border-border pt-3"
      aria-label={isNew ? tr('web.providers.add') : tr('web.providers.editing', { name: original.name })}
      onSubmit={(e) => {
        e.preventDefault()
        if (idOk && Object.keys(patch).length > 0) void onSave(patch)
      }}
    >
      <div className="grid grid-cols-2 gap-x-3">
        <Field label={tr('web.providers.name')} hint={tr('web.providers.nameHint')}>
          <input
            className="field-input"
            aria-label={tr('web.providers.name')}
            value={f.name}
            onChange={(e) => up({ name: e.target.value })}
          />
        </Field>
        <Field label="ID" hint={isNew ? tr('web.providers.idHint') : tr('web.providers.idFixed')}>
          <input
            className="field-input font-mono"
            aria-label="ID"
            value={id}
            disabled={!isNew}
            onChange={(e) => {
              setIdTouched(true)
              up({ id: e.target.value })
            }}
          />
        </Field>
        <Field label={tr('web.providers.vendor')} hint={tr('web.providers.vendorHint')}>
          <select
            className="field-input"
            aria-label={tr('web.providers.vendor')}
            value={f.vendor}
            onChange={(e) => {
              const v = vendors.find((x) => x.id === e.target.value) as Vendor
              up({ vendor: v.id, protocol: v.protocol, caps: { ...v.capabilities } })
            }}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={tr('web.providers.protocol')}
          hint={f.vendor === 'custom' ? tr('web.providers.protocolHint') : tr('web.providers.protocolFixed')}
        >
          <select
            className="field-input"
            aria-label={tr('web.providers.protocol')}
            value={f.protocol}
            disabled={f.vendor !== 'custom'}
            onChange={(e) => up({ protocol: e.target.value as ProviderForm['protocol'] })}
          >
            {/* 协议取值来自厂商模板（每种协议对应一家说这种话的厂商），这里不写死 */}
            {protocolOptions(vendors).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL" hint={tr('web.providers.baseUrlHint')}>
          <input
            className="field-input font-mono"
            aria-label="Base URL"
            placeholder={vendor.defaultBaseUrl ?? 'http://localhost:11434/v1'}
            value={f.baseUrl}
            onChange={(e) => up({ baseUrl: e.target.value })}
          />
        </Field>
        <Field
          label="API Key"
          hint={original === null ? tr('web.providers.keyNew') : keyHint(original.key, vendor.envNames)}
        >
          <input
            className="field-input font-mono"
            type="password"
            autoComplete="off"
            aria-label="API Key"
            placeholder={vendor.keyHint}
            value={f.apiKey}
            onChange={(e) => up({ apiKey: e.target.value })}
          />
        </Field>
      </div>
      <Field label={tr('web.providers.models')} hint={tr('web.providers.modelsHint')}>
        <input
          className="field-input font-mono"
          aria-label={tr('web.providers.models')}
          value={f.models}
          onChange={(e) => up({ models: e.target.value })}
        />
      </Field>
      <ToggleRow
        label={tr('common.enabled')}
        hint={tr('web.providers.enabledHint')}
        on={f.enabled}
        onChange={(on) => up({ enabled: on })}
      />
      <div className="mb-1 text-[13px] font-medium">{tr('web.providers.caps')}</div>
      <div className="mb-2 text-[11.5px] text-mut">{tr('web.providers.capsHint')}</div>
      {CAP_LABEL().map(([c, label, hint]) => (
        <ToggleRow
          key={c}
          label={label}
          hint={hint}
          on={f.caps[c]}
          onChange={(on) => up({ caps: { ...f.caps, [c]: on } })}
        />
      ))}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!idOk || Object.keys(patch).length === 0}>
          {tr('common.save')}
        </Button>
        <Button onClick={onCancel}>{tr('common.cancel')}</Button>
      </div>
    </form>
  )
}

/** 取数：设置 + 厂商模板 + 模型清单（带探测状态） */
export function ProvidersTab({
  client,
  s,
}: {
  client: DomiClient
  s: {
    data: Settings | null
    error: string | null
    saved: string | null
    save: (p: Record<string, unknown>) => Promise<boolean>
  }
}) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [models, setModels] = useState<ModelList | null>(null)
  const [probing, setProbing] = useState(false)
  const loadModels = useCallback(
    (refresh: boolean) => {
      setProbing(true)
      client
        .listModels(refresh)
        .then(setModels, () => setModels(null))
        .finally(() => setProbing(false))
    },
    [client],
  )
  useEffect(() => {
    client.listVendors().then(
      (r) => setVendors(r.vendors),
      () => setVendors([]),
    )
    loadModels(false)
  }, [client, loadModels])
  if (s.data === null) return <Saved error={s.error} saved={null} />
  return (
    <ProvidersView
      settings={s.data}
      vendors={vendors}
      models={models}
      error={s.error}
      saved={s.saved}
      probing={probing}
      onProbe={() => loadModels(true)}
      onSave={async (patch) => {
        const ok = await s.save(patch)
        // 改了 provider：清单跟着变（缓存靠指纹失效，这里只是重新拿一次）
        if (ok) loadModels(false)
        return ok
      }}
    />
  )
}
