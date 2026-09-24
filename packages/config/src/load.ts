/**
 * 配置装载 —— PRD-M0-008 AC-1（环境变量优先）
 *
 * 优先级：环境变量 > ~/.domi/config.yaml > 内置默认。
 * 格式是 YAML（docs/adr/014）。旧的 config.toml 已于 2026-09-24 停止读取（过渡期结束），
 * 只在 doctor 里提示它还躺在那儿。
 * 这个顺序不是随便定的：出问题时人要能用一条 `DEEPSEEK_API_KEY=... domi` 临时绕开配置文件，
 * 反过来（文件覆盖环境变量）会让"我明明设了环境变量为什么没生效"变成常见困惑。
 * base_url 不走环境变量（`DOMI_BASE_URL` 已于 2026-09-20 废弃）：它随终端环境漂，
 * 两次把 deepseek 的请求打到 `/anthropic/chat/completions` 的 404 上，只认配置文件。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { t } from '@domi/i18n'
import { ConfigParseError } from './errors.ts'
import { providerConnection } from './providers.ts'
import { ConfigSchema, type DomiConfig } from './schema.ts'
import { readSecrets, type Secrets, secretsPath } from './secrets.ts'
import { DEFAULT_MODEL, inferVendor, isVendorId, providerEnvNames, type VendorId } from './vendors.ts'

export class MissingCredentialError extends Error {
  /** 文案 key 而非句子：TUI 与 CLI 各自渲染，测试也断言它（AC-3） */
  readonly messageKey = 'error.missing_credential'
  constructor(
    readonly envNames: string[],
    /** 缺的是哪一家的 key。domid 在提交时报这个错（OPT-M8-001），界面据此引导去设置页 */
    readonly provider?: string,
  ) {
    // 前缀是文案 key：preflight 原样打印，测试与脚本都认它（PRD-M0-008 AC-3）；后半句随界面语言
    super(`error.missing_credential: ${t('error.no_credential', { envNames: envNames.join(' / ') })}`)
    this.name = 'MissingCredentialError'
  }
}

export { ConfigParseError } from './errors.ts'

/** ~/.domi（或测试给的 home 下的 .domi） */
export function domiHome(opts: LoadOptions = {}): string {
  const env = opts.env ?? process.env
  return join(opts.home ?? env.HOME ?? homedir(), '.domi')
}

export interface LoadOptions {
  /** 覆盖配置文件路径，测试用；正常走 DOMI_CONFIG 或 ~/.domi/config.yaml */
  path?: string
  env?: Record<string, string | undefined>
  home?: string
}

export interface ConfigSource {
  path: string
  exists: boolean
  /** ~/.domi/config.toml 还在（ADR-014：已不再读取）。只给 doctor 提示用，不参与装载 */
  staleToml: string | null
}

/** 找配置文件：显式路径（DOMI_CONFIG）> ~/.domi/config.yaml > config.yml。一律按 YAML 解析 */
export function configSource(opts: LoadOptions = {}): ConfigSource {
  const env = opts.env ?? process.env
  const explicit = opts.path ?? env.DOMI_CONFIG
  if (explicit !== undefined) return { path: explicit, exists: existsSync(explicit), staleToml: null }
  const dir = join(opts.home ?? homedir(), '.domi')
  const tomlPath = join(dir, 'config.toml')
  const staleToml = existsSync(tomlPath) ? tomlPath : null
  for (const name of ['config.yaml', 'config.yml']) {
    const p = join(dir, name)
    if (existsSync(p)) return { path: p, exists: true, staleToml }
  }
  return { path: join(dir, 'config.yaml'), exists: false, staleToml }
}

export function configPath(opts: LoadOptions = {}): string {
  return configSource(opts).path
}

/** 读并解析配置文件，返回顶层映射。不存在或空文件 → {} */
export function readConfigFile(src: ConfigSource): Record<string, unknown> {
  if (!src.exists) return {}
  let raw: unknown
  try {
    const text = readFileSync(src.path, 'utf8')
    raw = Bun.YAML.parse(text)
  } catch (e) {
    throw new ConfigParseError(src.path, e instanceof Error ? e.message : String(e))
  }
  // 空文件或只有注释：等于没写
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigParseError(src.path, '顶层必须是键值映射（model: / context: / permissions: …）')
  }
  return raw as Record<string, unknown>
}

/**
 * 按 provider 找它惯用的环境变量名：`DOMI_<ID>_API_KEY` + 厂商模板的惯用名（如 `DEEPSEEK_API_KEY`）。
 * 不存在无后缀的统一入口（`DOMI_API_KEY` 已于 2026-09-20 废弃）：它的值随终端环境漂，
 * 出现过把一把旧 key 发给别家 / 请求打到 `/anthropic/chat/completions` 404 的两起事故。
 */
export function credentialEnvNames(provider: string, vendor?: VendorId): string[] {
  return providerEnvNames(provider, vendor)
}

type FileProviders = Record<
  string,
  {
    api_key?: unknown
    base_url?: unknown
    models?: unknown
    name?: unknown
    vendor?: unknown
    protocol?: unknown
    enabled?: unknown
    capabilities?: unknown
  }
>

/** 文件里写的 vendor（写错了留给 schema 报），没写按键名推断 */
function vendorOf(file: Record<string, unknown>, provider: string): VendorId {
  const v = ((file.providers ?? {}) as FileProviders)[provider]?.vendor
  return typeof v === 'string' && isVendorId(v) ? v : inferVendor(provider)
}

/** 凭据从哪来（PRD-M8-011 AC-1）。env > secrets.yaml > config.yaml */
export type CredentialSource = 'env' | 'secrets' | 'config'

export interface ResolvedCredential {
  value: string
  source: CredentialSource
}

/**
 * 某一家的 key：环境变量 > secrets.yaml 的 providers.<p>.api_key > config.yaml 的 providers.<p>.api_key；
 * model.provider 那一家还认 config.yaml 的 model.api_key（旧写法）
 */
export function resolveCredential(
  provider: string,
  ctx: {
    env: Record<string, string | undefined>
    file: Record<string, unknown>
    secrets: Secrets
    defaultProvider: string
  },
): ResolvedCredential | null {
  const fromEnv = credentialEnvNames(provider, vendorOf(ctx.file, provider))
    .map((n) => ctx.env[n])
    .find((v) => v !== undefined && v !== '')
  if (fromEnv !== undefined) return { value: fromEnv, source: 'env' }
  const sec = ctx.secrets.providers?.[provider]?.api_key
  if (typeof sec === 'string' && sec !== '') return { value: sec, source: 'secrets' }
  const fileProviders = (ctx.file.providers ?? {}) as FileProviders
  const inFile = fileProviders[provider]?.api_key
  if (typeof inFile === 'string' && inFile !== '') return { value: inFile, source: 'config' }
  if (provider === ctx.defaultProvider) {
    const legacy = ((ctx.file.model ?? {}) as Record<string, unknown>).api_key
    if (typeof legacy === 'string' && legacy !== '') return { value: legacy, source: 'config' }
  }
  return null
}

export function loadConfig(opts: LoadOptions = {}): DomiConfig {
  const env = opts.env ?? process.env
  const src = configSource(opts)
  const path = src.path
  const fromFile = readConfigFile(src)
  // secrets.yaml 与配置文件放在同一个目录
  const secrets = readSecrets(secretsPath(dirname(src.path)))

  const fileModel = (fromFile.model ?? {}) as Record<string, unknown>
  const provider = env.DOMI_MODEL_PROVIDER ?? (fileModel.provider as string | undefined) ?? DEFAULT_MODEL.provider
  const ctx = { env, file: fromFile, secrets, defaultProvider: provider }
  const apiKey = resolveCredential(provider, ctx)?.value
  const fileProviders = (fromFile.providers ?? {}) as FileProviders
  const providerNames = new Set([...Object.keys(fileProviders), ...Object.keys(secrets.providers ?? {})])
  const providers = Object.fromEntries(
    [...providerNames].map((p) => {
      const fp = fileProviders[p] ?? {}
      const key = resolveCredential(p, ctx)?.value
      return [
        p,
        {
          ...(key === undefined ? {} : { apiKey: key }),
          ...(typeof fp.base_url === 'string' && fp.base_url !== '' ? { baseUrl: fp.base_url } : {}),
          ...(Array.isArray(fp.models) ? { models: fp.models } : {}),
          // 其余字段原样交给 schema 校验（类型不对就在那里报，带着路径）
          ...(fp.name === undefined ? {} : { name: fp.name }),
          ...(fp.vendor === undefined ? {} : { vendor: fp.vendor }),
          ...(fp.protocol === undefined ? {} : { protocol: fp.protocol }),
          ...(fp.enabled === undefined ? {} : { enabled: fp.enabled }),
          ...(fp.capabilities === undefined ? {} : { capabilities: fp.capabilities }),
        },
      ]
    }),
  )
  const providerBase = providers[provider]?.baseUrl

  const merged = {
    ...fromFile,
    providers,
    model: {
      provider,
      name: env.DOMI_MODEL ?? (fileModel.name as string | undefined) ?? DEFAULT_MODEL.name,
      ...((fileModel.base_url ?? providerBase)
        ? { baseUrl: (fileModel.base_url as string | undefined) ?? providerBase }
        : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(fileModel.capabilities === undefined ? {} : { capabilities: fileModel.capabilities }),
    },
  }

  const parsed = ConfigSchema.safeParse(merged)
  if (!parsed.success) {
    throw new ConfigParseError(path, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  return parsed.data
}

/** 装载 + 强制要求凭据。缺了就抛 MissingCredentialError（AC-3 的来源） */
export function loadConfigOrThrow(opts: LoadOptions = {}): DomiConfig {
  const cfg = loadConfig(opts)
  if (!providerConnection(cfg, cfg.model.provider).apiKey)
    throw new MissingCredentialError(credentialEnvNames(cfg.model.provider))
  return cfg
}
