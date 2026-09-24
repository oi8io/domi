/**
 * 从设置页改配置 —— PRD-M8-011 AC-2 / AC-3 · SPEC-M8-011 · 取舍-9
 *
 * 两条硬规则：
 * 1. **白名单**。只有下面列出的键能从协议改；权限规则、钩子、MCP、插件安装不在里面——
 *    远程客户端拿着 token 就能调 config.set，改这些等于能在 daemon 那台机器上执行命令（INV-03）。
 *    整个补丁里只要有一个键不在白名单，整体拒绝、文件不动。
 * 2. **保留用户的文件**。用 yaml 的 Document API 只改补丁里的节点，注释、顺序、其它键原样留下。
 *
 * key（`providers.<id>.api_key`）只写进 secrets.yaml，绝不写进 config.yaml。
 *
 * M9（PRD-M9-002 AC-8）：provider 不再是写死的四家，而是任意 id 下固定的一组字段；`providers.<id>: null` 删掉整条（连同 secrets 里的 key）。
 * 默认模型所在的那一家不能停用、不能删（AC-5）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import { isMap, parseDocument } from 'yaml'
import { ConfigParseError } from './errors.ts'
import {
  type CredentialSource,
  configSource,
  type LoadOptions,
  loadConfig,
  readConfigFile,
  resolveCredential,
} from './load.ts'
import { type CapabilityOverrides, listProviders, PROVIDER_ID } from './providers.ts'
import type { DomiConfig } from './schema.ts'
import { maskSecret, readSecrets, secretsPath, secretsTooOpen, writeSecrets } from './secrets.ts'
import type { Protocol, VendorId } from './vendors.ts'

/** 白名单：文件里的键路径（点分）。provider 下的键按 `providers.<id>.<字段>` 另外判断（见 isWritable） */
export const WRITABLE_KEYS: readonly string[] = [
  'model.provider',
  'model.name',
  'memory.extractEvery',
  'memory.soul',
  'context.strategy',
  'context.keepTurns',
  'context.compactAt',
  'plugins.disabled',
  'verify.enabled',
  'budget.tokens',
  'budget.costUsd',
  'budget.toolCalls',
  'ui.accent',
  'ui.locale',
  'tui.theme',
  'tui.renderer',
  'tui.mouse',
  'loop.maxToolCalls',
  'loop.maxArgParseRetries',
  'loop.maxWallClockMs',
]

/** 每个 provider 能改的字段（PRD-M9-002 AC-8）。能力覆盖是模型特性，不是权限，放开 */
export const PROVIDER_FIELDS = [
  'name',
  'vendor',
  'protocol',
  'base_url',
  'api_key',
  'enabled',
  'models',
  'capabilities',
] as const

/** config.get 里给界面看的完整白名单（provider 部分用 `<id>` 占位） */
export const WRITABLE_DESCRIPTION: readonly string[] = [
  ...WRITABLE_KEYS,
  'providers.<id>',
  ...PROVIDER_FIELDS.map((f) => `providers.<id>.${f}`),
]

/** 解析 `providers.<id>` / `providers.<id>.<字段>`；不是这个形状 → null */
function providerKey(key: string): { id: string; field: string | null } | null {
  const m = key.match(/^providers\.([^.]+)(?:\.([^.]+))?$/)
  if (!m) return null
  return { id: m[1] as string, field: m[2] ?? null }
}

function isWritable(key: string, value: unknown, existing: ReadonlySet<string>): boolean {
  if (WRITABLE_KEYS.includes(key)) return true
  const pk = providerKey(key)
  if (pk === null) return false
  // 新 id 要合规；配置里已有的旧键（比如历史上写过的大写名）照样能改能删
  if (!PROVIDER_ID.test(pk.id) && !existing.has(pk.id)) return false
  if (pk.field === null) return value === null // 整条只能删，不能整块写
  return (PROVIDER_FIELDS as readonly string[]).includes(pk.field)
}

const SECRET_KEY = /^providers\.[^.]+\.api_key$/

export class ConfigWriteError extends Error {
  constructor(
    message: string,
    /** 结构化原因，协议里放进 data.reason（例如 DEFAULT_PROVIDER） */
    readonly reason?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ConfigWriteError'
  }

  /** 由文案 key 构造（PRD-M9-004 AC-4）：key 随错误走，端上按自己的语言渲染 */
  static keyed(key: MessageKey, params?: Params, reason?: string): ConfigWriteError {
    const cause = new KeyedError(key, params)
    return new ConfigWriteError(cause.message, reason, { cause })
  }
}

/** null = 删除这个键（回到默认 / 环境变量） */
export type ConfigPatch = Record<string, unknown>

function pathOf(key: string): string[] {
  // provider 名里有「-」没有「.」，按点切就行
  return key.split('.')
}

function applyTo(text: string, entries: Array<[string, unknown]>, file: string): string {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) throw new ConfigParseError(file, doc.errors[0]?.message ?? 'YAML 语法错误')
  if (doc.contents !== null && !isMap(doc.contents)) throw new ConfigParseError(file, '顶层必须是键值映射')
  for (const [key, value] of entries) {
    const path = pathOf(key)
    if (value === null || value === undefined) {
      if (doc.hasIn(path)) doc.deleteIn(path)
      // 删空了的父级一并去掉，免得留下 `providers: {}` 之类的空壳
      for (let i = path.length - 1; i > 0; i--) {
        const parent = doc.getIn(path.slice(0, i))
        if (isMap(parent) && parent.items.length === 0) doc.deleteIn(path.slice(0, i))
      }
    } else {
      doc.setIn(path, value)
    }
  }
  const out = doc.toString()
  return out.trim() === '{}' ? '' : out
}

export interface WriteResult {
  configChanged: boolean
  secretsChanged: boolean
}

/**
 * 应用补丁：先全部校验（白名单 + 合并后的配置能通过 schema），再写文件。
 * 任一步失败抛 ConfigWriteError / ConfigParseError，两个文件都不动
 */
export function writeConfigPatch(patch: ConfigPatch, opts: LoadOptions = {}): WriteResult {
  const keys = Object.keys(patch)
  const src = configSource(opts)
  const existing = new Set(Object.keys((readConfigFile(src).providers ?? {}) as Record<string, unknown>))
  const denied = keys.filter((k) => !isWritable(k, patch[k], existing))
  if (denied.length > 0) throw ConfigWriteError.keyed('error.config.denied', { keys: denied.join(', ') })
  const sPath = secretsPath(dirname(src.path))

  // 删整条 provider：config 里那一节删掉，secrets 里那一家的 key 也删掉
  const removed = keys.filter((k) => providerKey(k)?.field === null).map((k) => providerKey(k)?.id as string)
  const plain = Object.entries(patch).filter(([k]) => !SECRET_KEY.test(k))
  const secret = [
    ...Object.entries(patch).filter(([k]) => SECRET_KEY.test(k)),
    ...removed.map((id) => [`providers.${id}`, null] as [string, unknown]),
  ]
  for (const [k, v] of secret) {
    if (v !== null && typeof v !== 'string') throw ConfigWriteError.keyed('error.config.notString', { key: k })
  }

  const oldConfig = src.exists ? readFileSync(src.path, 'utf8') : ''
  const newConfig = plain.length === 0 ? oldConfig : applyTo(oldConfig, plain, src.path)
  const oldSecrets = existsSync(sPath) ? readFileSync(sPath, 'utf8') : ''
  // 空字符串当作「删掉这个 key」
  const secretEntries = secret.map(([k, v]) => [k, v === '' ? null : v] as [string, unknown])
  const newSecrets = secret.length === 0 ? oldSecrets : applyTo(oldSecrets, secretEntries, sPath)
  readSecrets(sPath) // 现有的 secrets 文件本身要能读

  // 校验：用改过的文本走一遍正常装载。放在临时目录里，不碰真文件
  const next = validate(newConfig, newSecrets)
  // 默认模型所在的那一家不能停用、不能删（PRD-M9-002 AC-5）——先换默认模型
  const def = next.model.provider
  if (removed.includes(def) || next.providers[def]?.enabled === false) {
    throw ConfigWriteError.keyed('error.config.defaultProvider', { provider: def }, 'DEFAULT_PROVIDER')
  }

  const configChanged = newConfig !== oldConfig
  const secretsChanged = newSecrets !== oldSecrets
  if (configChanged) {
    mkdirSync(dirname(src.path), { recursive: true })
    writeFileSync(src.path, newConfig, 'utf8')
  }
  if (secretsChanged) writeSecrets(sPath, newSecrets)
  return { configChanged, secretsChanged }
}

function validate(configText: string, secretsText: string): DomiConfig {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'domi-cfg-check-'))
  try {
    writeFileSync(join(dir, 'config.yaml'), configText, 'utf8')
    writeFileSync(join(dir, 'secrets.yaml'), secretsText, 'utf8')
    try {
      // env 置空：校验的是文件本身，不受这台机器的环境变量影响
      return loadConfig({ path: join(dir, 'config.yaml'), env: {} })
    } catch (e) {
      throw new ConfigWriteError(
        e instanceof Error ? e.message.replace(join(dir, 'config.yaml'), 'config.yaml') : String(e),
      )
    }
  } finally {
    try {
      rmSync(join(dir, 'config.yaml'), { force: true })
      rmSync(join(dir, 'secrets.yaml'), { force: true })
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 没有删除权限的环境：留在临时目录里
    }
  }
}

export interface ProviderView {
  id: string
  name: string
  vendor: VendorId
  protocol: Protocol
  /** 文件里写的地址；没写是 null（界面显示模板默认地址作占位） */
  baseUrl: string | null
  enabled: boolean
  models: string[]
  capabilities: CapabilityOverrides
  /** vendor / protocol 是按键名推断的 */
  inferred: boolean
  /** 默认模型所在的那一家 */
  isDefault: boolean
  key: { set: boolean; masked?: string; source?: CredentialSource }
}

export interface SettingsView {
  /** 白名单里非凭据键的当前生效值（点分键 → 值）；没写的给默认值 */
  values: Record<string, unknown>
  /** 每家的 key：有没有、掩码、从哪来。绝不返回原文 */
  secrets: Record<string, { set: boolean; masked?: string; source?: CredentialSource }>
  /** 全部 provider（PRD-M9-002）：配置里写了的 + 默认模型所在的那一家 */
  providers: ProviderView[]
  paths: { config: string; secrets: string }
  /** secrets.yaml 权限比 0600 宽 */
  secretsTooOpen: boolean
  writable: readonly string[]
}

/** 设置页要显示的东西（PRD-M8-011 AC-1 · PRD-M9-002 AC-4） */
export function readSettings(opts: LoadOptions = {}): SettingsView {
  const env = opts.env ?? process.env
  const cfg = loadConfig(opts)
  const src = configSource(opts)
  const file = readConfigFile(src)
  const sPath = secretsPath(dirname(src.path))
  const secrets = readSecrets(sPath)
  const fileProviders = (file.providers ?? {}) as Record<string, { base_url?: unknown }>
  const values: Record<string, unknown> = {
    'model.provider': cfg.model.provider,
    'model.name': cfg.model.name,
    'memory.extractEvery': cfg.memory.extractEvery,
    'memory.soul': cfg.memory.soul,
    'context.strategy': cfg.context.strategy,
    'context.keepTurns': cfg.context.keepTurns,
    'context.compactAt': cfg.context.compactAt,
    'plugins.disabled': cfg.plugins.disabled,
    'verify.enabled': cfg.verify.enabled,
    'budget.tokens': cfg.budget.tokens ?? null,
    'budget.costUsd': cfg.budget.costUsd ?? null,
    'budget.toolCalls': cfg.budget.toolCalls ?? null,
    'ui.accent': cfg.ui.accent,
    'ui.locale': cfg.ui.locale,
    'tui.theme': cfg.tui.theme,
    'tui.renderer': cfg.tui.renderer,
    'tui.mouse': cfg.tui.mouse,
    'loop.maxToolCalls': cfg.loop.maxToolCalls,
    'loop.maxArgParseRetries': cfg.loop.maxArgParseRetries,
    'loop.maxWallClockMs': cfg.loop.maxWallClockMs,
  }
  const ctx = { env, file, secrets, defaultProvider: cfg.model.provider }
  const secretView: SettingsView['secrets'] = {}
  const providers: ProviderView[] = listProviders(cfg).map((p) => {
    const r = resolveCredential(p.id, ctx)
    const key = r === null ? { set: false } : { set: true, masked: maskSecret(r.value), source: r.source }
    secretView[p.id] = key
    const base = fileProviders[p.id]?.base_url
    const baseUrl = typeof base === 'string' && base !== '' ? base : null
    values[`providers.${p.id}.base_url`] = baseUrl
    values[`providers.${p.id}.models`] = p.models
    return {
      id: p.id,
      name: p.name,
      vendor: p.vendor,
      protocol: p.protocol,
      baseUrl,
      enabled: p.enabled,
      models: p.models,
      capabilities: p.capabilities ?? {},
      inferred: p.inferred,
      isDefault: p.id === cfg.model.provider,
      key,
    }
  })
  return {
    values,
    secrets: secretView,
    providers,
    paths: { config: src.path, secrets: sPath },
    secretsTooOpen: secretsTooOpen(sPath),
    writable: WRITABLE_DESCRIPTION,
  }
}
