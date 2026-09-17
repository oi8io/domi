/**
 * 从设置页改配置 —— PRD-M8-011 AC-2 / AC-3 · SPEC-M8-011 · 取舍-9
 *
 * 两条硬规则：
 * 1. **白名单**。只有下面列出的键能从协议改；权限规则、钩子、MCP、插件安装不在里面——
 *    远程客户端拿着 token 就能调 config.set，改这些等于能在 daemon 那台机器上执行命令（INV-03）。
 *    整个补丁里只要有一个键不在白名单，整体拒绝、文件不动。
 * 2. **保留用户的文件**。用 yaml 的 Document API 只改补丁里的节点，注释、顺序、其它键原样留下。
 *
 * key（`providers.<名字>.api_key`）只写进 secrets.yaml，绝不写进 config.yaml。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import { maskSecret, readSecrets, secretsPath, secretsTooOpen, writeSecrets } from './secrets.ts'

/** 能从设置页改的 provider 名 */
export const EDITABLE_PROVIDERS = ['anthropic', 'openai', 'deepseek', 'openai-compatible'] as const

/** 白名单：文件里的键路径（点分；providers 下按上面四家展开）。值的类型由 ConfigSchema 最后校验 */
export const WRITABLE_KEYS: readonly string[] = [
  'model.provider',
  'model.name',
  ...EDITABLE_PROVIDERS.flatMap((p) => [`providers.${p}.base_url`, `providers.${p}.api_key`]),
  'providers.openai-compatible.models',
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
  'tui.theme',
]

const SECRET_KEY = /^providers\.[^.]+\.api_key$/

export class ConfigWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigWriteError'
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
  const denied = keys.filter((k) => !WRITABLE_KEYS.includes(k))
  if (denied.length > 0) throw new ConfigWriteError(`这些设置不能从这里改：${denied.join('、')}`)
  const src = configSource(opts)
  if (src.legacy)
    throw new ConfigWriteError(`配置还是旧的 TOML 格式（${src.path}），先迁移成 YAML：domi init --from-toml`)
  const sPath = secretsPath(dirname(src.path))

  const plain = Object.entries(patch).filter(([k]) => !SECRET_KEY.test(k))
  const secret = Object.entries(patch).filter(([k]) => SECRET_KEY.test(k))
  for (const [k, v] of secret) {
    if (v !== null && typeof v !== 'string') throw new ConfigWriteError(`${k} 必须是字符串`)
  }

  const oldConfig = src.exists ? readFileSync(src.path, 'utf8') : ''
  const newConfig = plain.length === 0 ? oldConfig : applyTo(oldConfig, plain, src.path)
  const oldSecrets = existsSync(sPath) ? readFileSync(sPath, 'utf8') : ''
  // 空字符串当作「删掉这个 key」
  const secretEntries = secret.map(([k, v]) => [k, v === '' ? null : v] as [string, unknown])
  const newSecrets = secret.length === 0 ? oldSecrets : applyTo(oldSecrets, secretEntries, sPath)
  readSecrets(sPath) // 现有的 secrets 文件本身要能读

  // 校验：用改过的文本走一遍正常装载。放在临时目录里，不碰真文件
  validate(newConfig, newSecrets)

  const configChanged = newConfig !== oldConfig
  const secretsChanged = newSecrets !== oldSecrets
  if (configChanged) {
    mkdirSync(dirname(src.path), { recursive: true })
    writeFileSync(src.path, newConfig, 'utf8')
  }
  if (secretsChanged) writeSecrets(sPath, newSecrets)
  return { configChanged, secretsChanged }
}

function validate(configText: string, secretsText: string): void {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'domi-cfg-check-'))
  try {
    writeFileSync(join(dir, 'config.yaml'), configText, 'utf8')
    writeFileSync(join(dir, 'secrets.yaml'), secretsText, 'utf8')
    try {
      // env 置空：校验的是文件本身，不受这台机器的环境变量影响
      loadConfig({ path: join(dir, 'config.yaml'), env: {} })
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

export interface SettingsView {
  /** 白名单里非凭据键的当前生效值（点分键 → 值）；没写的给默认值 */
  values: Record<string, unknown>
  /** 每家的 key：有没有、掩码、从哪来。绝不返回原文 */
  secrets: Record<string, { set: boolean; masked?: string; source?: CredentialSource }>
  paths: { config: string; secrets: string }
  /** secrets.yaml 权限比 0600 宽 */
  secretsTooOpen: boolean
  writable: readonly string[]
}

/** 设置页要显示的东西（PRD-M8-011 AC-1） */
export function readSettings(opts: LoadOptions = {}): SettingsView {
  const env = opts.env ?? process.env
  const cfg = loadConfig(opts)
  const src = configSource(opts)
  const file = readConfigFile(src)
  const sPath = secretsPath(dirname(src.path))
  const secrets = readSecrets(sPath)
  const fileProviders = (file.providers ?? {}) as Record<string, { base_url?: unknown; models?: unknown }>
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
    'tui.theme': cfg.tui.theme,
  }
  for (const p of EDITABLE_PROVIDERS) {
    const base = fileProviders[p]?.base_url
    values[`providers.${p}.base_url`] = typeof base === 'string' ? base : null
  }
  const models = fileProviders['openai-compatible']?.models
  values['providers.openai-compatible.models'] = Array.isArray(models) ? models : []
  const ctx = { env, file, secrets, defaultProvider: cfg.model.provider }
  const secretView: SettingsView['secrets'] = {}
  for (const p of EDITABLE_PROVIDERS) {
    const r = resolveCredential(p, ctx)
    secretView[p] = r === null ? { set: false } : { set: true, masked: maskSecret(r.value), source: r.source }
  }
  return {
    values,
    secrets: secretView,
    paths: { config: src.path, secrets: sPath },
    secretsTooOpen: secretsTooOpen(sPath),
    writable: WRITABLE_KEYS,
  }
}
