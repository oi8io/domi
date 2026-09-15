/**
 * PRD-M0-008 · 配置与凭据（AC-1 / AC-3）· SPEC-M0-009 · INV-11
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigParseError,
  configPath,
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

function home(toml?: string): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-cfg-'))
  dirs.push(d)
  if (toml !== undefined) {
    mkdirSync(join(d, '.domi'), { recursive: true })
    writeFileSync(join(d, '.domi', 'config.toml'), toml, 'utf8')
  }
  return d
}

const TOML = `
[model]
provider = "anthropic"
name = "claude-from-file"
base_url = "https://gateway.example/v1"
api_key = "sk-ant-from-file-0123456789abcdefghij"

[[permissions.rules]]
name = "allow-read"
capability = "fs.read"
decision = "allow"
`

describe('PRD-M0-008 AC-1 · 环境变量优先于配置文件', () => {
  test('只有配置文件时，读文件的值', () => {
    const cfg = loadConfig({ home: home(TOML), env: {} })
    expect(cfg.model.name).toBe('claude-from-file')
    expect(cfg.model.baseUrl).toBe('https://gateway.example/v1')
    expect(cfg.permissions.rules).toHaveLength(1)
  })

  test('环境变量覆盖文件里的同名项', () => {
    const cfg = loadConfig({
      home: home(TOML),
      env: { DOMI_MODEL: 'claude-from-env', DOMI_BASE_URL: 'https://env.example/v1' },
    })
    expect(cfg.model.name).toBe('claude-from-env')
    expect(cfg.model.baseUrl).toBe('https://env.example/v1')
  })

  test('凭据也是环境变量优先，且认 provider 惯用的变量名', () => {
    const h = home(TOML)
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
    const p = join(d, 'other.toml')
    writeFileSync(p, '[model]\nname = "from-explicit-path"\n', 'utf8')
    expect(configPath({ env: { DOMI_CONFIG: p } })).toBe(p)
    expect(loadConfig({ env: { DOMI_CONFIG: p, DOMI_API_KEY: 'k' } }).model.name).toBe('from-explicit-path')
  })
})

describe('配置文件坏掉时给人话，不是堆栈', () => {
  test('TOML 语法错误抛 ConfigParseError 并带上文件路径', () => {
    const h = home('[model\nname = ')
    expect(() => loadConfig({ home: h, env: {} })).toThrow(ConfigParseError)
    try {
      loadConfig({ home: h, env: {} })
    } catch (e) {
      expect((e as ConfigParseError).message).toContain('error.config_invalid')
      expect((e as ConfigParseError).message).toContain('config.toml')
    }
  })

  test('字段类型不对也是 ConfigParseError，不是 zod 的原始报错', () => {
    const h = home('[context]\nmaxTokens = "很多"\n')
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
    const cfg = loadConfig({ home: home(TOML), env: {} })
    // 这里**不**脱敏是对的：provider 需要真 key。
    // 真正的防线在 EventLog.append 的前置钩子（packages/store/src/redact.ts），
    // 那里有专门的测试证明落盘的事件里扫不出凭据。
    expect(cfg.model.apiKey).toContain('sk-ant-')
  })
})

describe('[model.capabilities] —— 能力矩阵的显式覆盖（PRD-M1-001 AC-2）', () => {
  // UnsupportedCapabilityError 的报错文案一直在教用户「在 [model.capabilities] 里显式打开」，
  // 但这一节原来根本没有被读取：openai-compatible 网关因此永远用不了工具
  test('配置文件里写的开关读得出来', () => {
    const cfg = loadConfig({
      home: home(`
[model]
provider = "my-gateway"
name = "qwen"

[model.capabilities]
toolCall = true
`),
      env: { DOMI_API_KEY: 'k' },
    })
    expect(cfg.model.capabilities).toEqual({ toolCall: true })
  })

  test('没写就是没有覆盖，不是全 false', () => {
    const cfg = loadConfig({ home: home(TOML), env: {} })
    expect(cfg.model.capabilities).toBeUndefined()
  })

  test('写错类型直接报配置错误，而不是悄悄当成 false', () => {
    expect(() =>
      loadConfig({ home: home('[model]\nprovider = "x"\n[model.capabilities]\ntoolCall = "yes"\n'), env: {} }),
    ).toThrow(/capabilities/)
  })
})
