/**
 * 配置装载 —— PRD-M0-008 AC-1（环境变量优先）
 *
 * 优先级：环境变量 > ~/.domi/config.yaml > 内置默认。
 * 格式是 YAML（docs/adr/014）；旧的 config.toml 过渡期内仍可读，到 M4 再批准门删掉。
 * 这个顺序不是随便定的：出问题时人要能用一条 `DOMI_API_KEY=... domi` 临时绕开配置文件，
 * 反过来（文件覆盖环境变量）会让"我明明设了环境变量为什么没生效"变成常见困惑。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, type DomiConfig } from './schema.ts'

export class MissingCredentialError extends Error {
  /** 文案 key 而非句子：TUI 与 CLI 各自渲染，测试也断言它（AC-3） */
  readonly messageKey = 'error.missing_credential'
  constructor(readonly envNames: string[]) {
    super(
      `error.missing_credential: 没有找到模型凭据。设置 ${envNames.join(' 或 ')}，或写进 ~/.domi/config.yaml（model.api_key）。`,
    )
    this.name = 'MissingCredentialError'
  }
}

export class ConfigParseError extends Error {
  readonly messageKey = 'error.config_invalid'
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`error.config_invalid: ${path} 解析失败 —— ${detail}`)
    this.name = 'ConfigParseError'
  }
}

export interface LoadOptions {
  /** 覆盖配置文件路径，测试用；正常走 DOMI_CONFIG 或 ~/.domi/config.yaml */
  path?: string
  env?: Record<string, string | undefined>
  home?: string
}

export interface ConfigSource {
  path: string
  format: 'yaml' | 'toml'
  exists: boolean
  /** 读的是旧格式（ADR-014 过渡期）。doctor 据此给出迁移命令 */
  legacy: boolean
  /** YAML 与旧 TOML 同时存在时，被忽略的那个 TOML 的路径 */
  ignoredLegacy: string | null
}

/** 找配置文件：显式路径 > ~/.domi/config.yaml > config.yml > 旧的 config.toml */
export function configSource(opts: LoadOptions = {}): ConfigSource {
  const env = opts.env ?? process.env
  const explicit = opts.path ?? env.DOMI_CONFIG
  if (explicit !== undefined) {
    const toml = explicit.endsWith('.toml')
    return {
      path: explicit,
      format: toml ? 'toml' : 'yaml',
      exists: existsSync(explicit),
      legacy: toml,
      ignoredLegacy: null,
    }
  }
  const dir = join(opts.home ?? homedir(), '.domi')
  const legacyPath = join(dir, 'config.toml')
  const hasLegacy = existsSync(legacyPath)
  for (const name of ['config.yaml', 'config.yml']) {
    const p = join(dir, name)
    if (existsSync(p)) {
      return { path: p, format: 'yaml', exists: true, legacy: false, ignoredLegacy: hasLegacy ? legacyPath : null }
    }
  }
  if (hasLegacy) return { path: legacyPath, format: 'toml', exists: true, legacy: true, ignoredLegacy: null }
  return { path: join(dir, 'config.yaml'), format: 'yaml', exists: false, legacy: false, ignoredLegacy: null }
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
    raw = src.format === 'toml' ? Bun.TOML.parse(text) : Bun.YAML.parse(text)
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

/** 按 provider 找它惯用的环境变量名，顺带保留 DOMI_API_KEY 这个统一入口 */
export function credentialEnvNames(provider: string): string[] {
  const perProvider: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  }
  const specific = perProvider[provider]
  return specific ? ['DOMI_API_KEY', specific] : ['DOMI_API_KEY']
}

export function loadConfig(opts: LoadOptions = {}): DomiConfig {
  const env = opts.env ?? process.env
  const src = configSource(opts)
  const path = src.path
  const fromFile = readConfigFile(src)

  const fileModel = (fromFile.model ?? {}) as Record<string, unknown>
  const provider = env.DOMI_MODEL_PROVIDER ?? (fileModel.provider as string | undefined) ?? 'anthropic'
  const apiKey =
    credentialEnvNames(provider)
      .map((n) => env[n])
      .find((v) => v !== undefined && v !== '') ?? (fileModel.api_key as string | undefined)

  const merged = {
    ...fromFile,
    model: {
      provider,
      name: env.DOMI_MODEL ?? (fileModel.name as string | undefined) ?? 'claude-sonnet-4-5',
      ...((env.DOMI_BASE_URL ?? fileModel.base_url)
        ? { baseUrl: env.DOMI_BASE_URL ?? (fileModel.base_url as string) }
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
  if (!cfg.model.apiKey) throw new MissingCredentialError(credentialEnvNames(cfg.model.provider))
  return cfg
}
