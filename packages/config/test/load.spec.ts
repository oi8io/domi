/**
 * PRD-M0-008 · 配置与凭据（AC-1 / AC-3）· SPEC-M0-009 · INV-11
 * 配置格式：YAML（docs/adr/014，PRD v1.4 回写）；旧的 TOML 过渡期内仍可读
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigParseError,
  configPath,
  configSource,
  EXIT_CONFIG_ERROR,
  loadConfig,
  loadConfigOrThrow,
  MissingCredentialError,
  preflight,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** 建一个假 HOME；files 的键是 ~/.domi 下的文件名 */
function home(yaml?: string, files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-cfg-'))
  dirs.push(d)
  const all = yaml === undefined ? files : { 'config.yaml': yaml, ...files }
  if (Object.keys(all).length > 0) mkdirSync(join(d, '.domi'), { recursive: true })
  for (const [name, text] of Object.entries(all)) writeFileSync(join(d, '.domi', name), text, 'utf8')
  return d
}

const YAML = `
model:
  provider: anthropic
  name: claude-from-file
  base_url: https://gateway.example/v1
  api_key: sk-ant-from-file-0123456789abcdefghij

permissions:
  rules:
    - name: allow-read
      capability: fs.read
      decision: allow
`

/** 同一份配置的旧格式，用来测过渡期 */
const LEGACY_TOML = `
[model]
provider = "anthropic"
name = "claude-from-toml"
base_url = "https://gateway.example/v1"

[[permissions.rules]]
name = "allow-read"
capability = "fs.read"
decision = "allow"
`

describe('PRD-M0-008 AC-1 · 环境变量优先于配置文件', () => {
  test('只有配置文件时，读文件的值', () => {
    const cfg = loadConfig({ home: home(YAML), env: {} })
    expect(cfg.model.name).toBe('claude-from-file')
    expect(cfg.model.baseUrl).toBe('https://gateway.example/v1')
    expect(cfg.permissions.rules).toHaveLength(1)
  })

  test('环境变量覆盖文件里的同名项', () => {
    const cfg = loadConfig({
      home: home(YAML),
      env: { DOMI_MODEL: 'claude-from-env', DOMI_BASE_URL: 'https://env.example/v1' },
    })
    expect(cfg.model.name).toBe('claude-from-env')
    expect(cfg.model.baseUrl).toBe('https://env.example/v1')
  })

  test('凭据也是环境变量优先，且认 provider 惯用的变量名', () => {
    const h = home(YAML)
    expect(loadConfig({ home: h, env: { DOMI_API_KEY: 'sk-from-domi-env' } }).model.apiKey).toBe('sk-from-domi-env')
    expect(loadConfig({ home: h, env: { ANTHROPIC_API_KEY: 'sk-ant-env' } }).model.apiKey).toBe('sk-ant-env')
    // DOMI_API_KEY 是统一入口，优先于 provider 专用变量
    expect(
      loadConfig({ home: h, env: { DOMI_API_KEY: 'sk-unified', ANTHROPIC_API_KEY: 'sk-specific' } }).model.apiKey,
    ).toBe('sk-unified')
  })

  test('完全没有配置文件时也能跑，用内置默认', () => {
    const cfg = loadConfig({ home: home(), env: { DOMI_API_KEY: 'k' } })
    expect(cfg.model.provider).toBe('anthropic')
    expect(cfg.context.maxTokens).toBeGreaterThan(0)
    expect(cfg.permissions.rules).toEqual([])
  })

  test('DOMI_CONFIG 能指定配置文件位置', () => {
    const d = mkdtempSync(join(tmpdir(), 'domi-cfg2-'))
    dirs.push(d)
    const p = join(d, 'other.yaml')
    writeFileSync(p, 'model:\n  name: from-explicit-path\n', 'utf8')
    expect(configPath({ env: { DOMI_CONFIG: p } })).toBe(p)
    expect(loadConfig({ env: { DOMI_CONFIG: p, DOMI_API_KEY: 'k' } }).model.name).toBe('from-explicit-path')
  })
})

describe('配置文件坏掉时给人话，不是堆栈', () => {
  test('YAML 语法错误抛 ConfigParseError 并带上文件路径', () => {
    const h = home('model: [claude,\n  name: ')
    expect(() => loadConfig({ home: h, env: {} })).toThrow(ConfigParseError)
    try {
      loadConfig({ home: h, env: {} })
    } catch (e) {
      expect((e as ConfigParseError).message).toContain('error.config_invalid')
      expect((e as ConfigParseError).message).toContain('config.yaml')
    }
  })

  test('字段类型不对也是 ConfigParseError，不是 zod 的原始报错', () => {
    const h = home('context:\n  maxTokens: 很多\n')
    expect(() => loadConfig({ home: h, env: { DOMI_API_KEY: 'k' } })).toThrow(ConfigParseError)
  })
})

describe('PRD-M0-008 AC-3 · 缺凭据的退出路径', () => {
  test('loadConfigOrThrow 抛 MissingCredentialError 并列出该设哪个变量', () => {
    try {
      loadConfigOrThrow({ home: home(), env: {} })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCredentialError)
      const err = e as MissingCredentialError
      expect(err.messageKey).toBe('error.missing_credential')
      expect(err.envNames).toEqual(['DOMI_API_KEY', 'ANTHROPIC_API_KEY'])
    }
  })

  test('preflight 输出文案 key、退出码 2、且不含堆栈特征', () => {
    const lines: string[] = []
    const codes: number[] = []
    preflight({ err: (l) => lines.push(l), exit: (c) => codes.push(c) }, { home: home(), env: {} })

    expect(codes).toEqual([EXIT_CONFIG_ERROR])
    expect(lines.join('\n')).toContain('error.missing_credential')
    expect(lines.join('\n')).not.toContain('at Object.<anonymous>')
    expect(lines.join('\n')).not.toMatch(/\n\s+at /)
  })

  test('有凭据时 preflight 不吭声、不退出', () => {
    const lines: string[] = []
    const codes: number[] = []
    preflight({ err: (l) => lines.push(l), exit: (c) => codes.push(c) }, { home: home(), env: { DOMI_API_KEY: 'k' } })
    expect(codes).toEqual([])
    expect(lines).toEqual([])
  })

  test('真的 spawn 一次：退出码与 stderr 都对（AC-3 要的是进程行为）', async () => {
    const h = home()
    const p = Bun.spawn(['bun', 'packages/config/src/preflight.ts'], {
      env: { PATH: process.env.PATH ?? '', HOME: h },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const err = await new Response(p.stderr).text()
    const exit = await p.exited

    expect(exit).toBe(EXIT_CONFIG_ERROR)
    expect(err).toContain('error.missing_credential')
    expect(err).not.toContain('at Object.<anonymous>')
    expect(err).not.toMatch(/\n\s+at /)
  }, 15_000)
})

describe('INV-11 · 凭据不进事件流是分层保证的', () => {
  test('配置里的 key 原样返回给调用方（它要拿去建 provider），脱敏发生在写入边界', () => {
    const cfg = loadConfig({ home: home(YAML), env: {} })
    // 这里**不**脱敏是对的：provider 需要真 key。
    // 真正的防线在 EventLog.append 的前置钩子（packages/store/src/redact.ts），
    // 那里有专门的测试证明落盘的事件里扫不出凭据。
    expect(cfg.model.apiKey).toContain('sk-ant-')
  })
})

describe('model.capabilities —— 能力矩阵的显式覆盖（PRD-M1-001 AC-2）', () => {
  // UnsupportedCapabilityError 的报错文案一直在教用户「在 model.capabilities 里显式打开」，
  // 但这一节原来根本没有被读取：openai-compatible 网关因此永远用不了工具
  test('配置文件里写的开关读得出来', () => {
    const cfg = loadConfig({
      home: home(`
model:
  provider: my-gateway
  name: qwen
  capabilities:
    toolCall: true
`),
      env: { DOMI_API_KEY: 'k' },
    })
    expect(cfg.model.capabilities).toEqual({ toolCall: true })
  })

  test('没写就是没有覆盖，不是全 false', () => {
    const cfg = loadConfig({ home: home(YAML), env: {} })
    expect(cfg.model.capabilities).toBeUndefined()
  })

  test('写错类型直接报配置错误，而不是悄悄当成 false', () => {
    expect(() =>
      loadConfig({ home: home('model:\n  provider: x\n  capabilities:\n    toolCall: "yes"\n'), env: {} }),
    ).toThrow(/capabilities/)
  })
})

describe('ADR-014 · YAML 与旧 TOML 的过渡', () => {
  test('默认位置是 ~/.domi/config.yaml', () => {
    const h = home()
    expect(configPath({ home: h, env: {} })).toBe(join(h, '.domi', 'config.yaml'))
    expect(configSource({ home: h, env: {} })).toMatchObject({ format: 'yaml', exists: false, legacy: false })
  })

  test('也认 config.yml', () => {
    const h = home(undefined, { 'config.yml': 'model:\n  name: from-yml\n' })
    expect(loadConfig({ home: h, env: {} }).model.name).toBe('from-yml')
  })

  test('只有旧的 config.toml：照常读，并标记为 legacy', () => {
    const h = home(undefined, { 'config.toml': LEGACY_TOML })
    const src = configSource({ home: h, env: {} })
    expect(src).toMatchObject({ format: 'toml', exists: true, legacy: true, ignoredLegacy: null })
    expect(src.path).toBe(join(h, '.domi', 'config.toml'))
    const cfg = loadConfig({ home: h, env: {} })
    expect(cfg.model.name).toBe('claude-from-toml')
    expect(cfg.permissions.rules).toHaveLength(1)
  })

  test('两个都在：只读 YAML，并报出被忽略的 TOML', () => {
    const h = home(YAML, { 'config.toml': LEGACY_TOML })
    const src = configSource({ home: h, env: {} })
    expect(src.format).toBe('yaml')
    expect(src.ignoredLegacy).toBe(join(h, '.domi', 'config.toml'))
    expect(loadConfig({ home: h, env: {} }).model.name).toBe('claude-from-file')
  })

  test('DOMI_CONFIG 指到 .toml 时按 TOML 解析', () => {
    const d = mkdtempSync(join(tmpdir(), 'domi-cfg3-'))
    dirs.push(d)
    const p = join(d, 'old.toml')
    writeFileSync(p, LEGACY_TOML, 'utf8')
    expect(configSource({ env: { DOMI_CONFIG: p } })).toMatchObject({ format: 'toml', legacy: true })
    expect(loadConfig({ env: { DOMI_CONFIG: p } }).model.name).toBe('claude-from-toml')
  })

  test('空的 YAML 文件等于没写，不是报错', () => {
    expect(loadConfig({ home: home('# 先空着\n'), env: {} }).model.provider).toBe('anthropic')
  })

  test('顶层不是映射（比如写成了列表）→ 配置错误', () => {
    expect(() => loadConfig({ home: home('- model\n- name\n'), env: {} })).toThrow(ConfigParseError)
  })

  test('YAML 的隐式类型不会悄悄混进来：maxTokens 写成 "1e5" 字符串会被 zod 拦下', () => {
    expect(() => loadConfig({ home: home('context:\n  maxTokens: "1e5"\n'), env: {} })).toThrow(ConfigParseError)
  })
})
