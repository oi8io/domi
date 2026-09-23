/**
 * 配置回写与凭据 —— PRD-M8-011 AC-1 / AC-2 / AC-3 / AC-4
 *
 * 白名单先造违规证明（带 hooks 的补丁整体被拒、文件一个字节不动），
 * 再断言注释与写法保留、key 只进 secrets.yaml、掩码与来源。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigWriteError, loadConfig, maskSecret, readSettings, secretsPath, writeConfigPatch } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const ORIGINAL = `# 我的配置
model:
  provider: anthropic # 默认那一家
  name: claude-sonnet-4-5
  api_key: sk-ant-legacy-0123456789
permissions:
  rules:
    - { name: w, capability: fs.write, decision: ask }
`

function home(): { home: string; cfg: string; opts: { home: string; env: Record<string, string> } } {
  const h = mkdtempSync(join(tmpdir(), 'domi-cfg-'))
  dirs.push(h)
  mkdirSync(join(h, '.domi'))
  const cfg = join(h, '.domi', 'config.yaml')
  writeFileSync(cfg, ORIGINAL)
  return { home: h, cfg, opts: { home: h, env: {} } }
}

describe('PRD-M8-011 AC-2 / AC-4 · 白名单之外一律拒绝，注释与写法保留', () => {
  test('带 hooks / permissions / mcp / plugin 安装的补丁整体被拒，文件一个字节不动', () => {
    const { cfg, opts } = home()
    for (const bad of [
      { hooks: [] },
      { 'permissions.rules': [] },
      { 'mcp.servers': [] },
      { 'plugins.enabled': false },
      { 'model.name': 'claude-opus-4-1', hooks: [] },
    ]) {
      expect(() => writeConfigPatch(bad as never, opts)).toThrow(ConfigWriteError)
    }
    expect(readFileSync(cfg, 'utf8')).toBe(ORIGINAL)
  })

  test('白名单里的键改得动；注释、行内注释与 flow 写法都留着', () => {
    const { cfg, opts } = home()
    writeConfigPatch({ 'model.name': 'claude-opus-4-1', 'ui.accent': 'pink', 'context.compactAt': 75 }, opts)
    const text = readFileSync(cfg, 'utf8')
    expect(text).toContain('# 我的配置')
    expect(text).toContain('# 默认那一家')
    expect(text).toContain('{ name: w, capability: fs.write, decision: ask }')
    expect(text).toContain('claude-opus-4-1')
    expect(text).toContain('accent: pink')
    expect(loadConfig(opts).context.compactAt).toBe(75)
  })

  test('PRD-M10-003：loop.* 三键在白名单里，写得了也读得回；非法值整体拒绝且文件不动', () => {
    const { cfg, opts } = home()
    writeConfigPatch({ 'loop.maxToolCalls': 5, 'loop.maxArgParseRetries': 2, 'loop.maxWallClockMs': 30_000 }, opts)
    expect(loadConfig(opts).loop).toEqual({ maxToolCalls: 5, maxArgParseRetries: 2, maxWallClockMs: 30_000 })
    const read = readSettings(opts)
    expect(read.values['loop.maxToolCalls']).toBe(5)
    expect(read.values['loop.maxArgParseRetries']).toBe(2)
    expect(read.values['loop.maxWallClockMs']).toBe(30_000)
    for (const bad of [{ 'loop.maxToolCalls': -1 }, { 'loop.maxToolCalls': 1001 }, { 'loop.maxWallClockMs': 500 }]) {
      expect(() => writeConfigPatch(bad as never, opts)).toThrow(ConfigWriteError)
    }
    expect(readFileSync(cfg, 'utf8')).toContain('maxToolCalls: 5')
    expect(readFileSync(cfg, 'utf8')).not.toContain('maxToolCalls: -1')
  })

  test('值不合法时也整体拒绝（先在副本上校验过才写真文件）', () => {
    const { cfg, opts } = home()
    expect(() => writeConfigPatch({ 'ui.accent': 'red' } as never, opts)).toThrow()
    expect(() => writeConfigPatch({ 'context.compactAt': 5 } as never, opts)).toThrow()
    expect(readFileSync(cfg, 'utf8')).toBe(ORIGINAL)
  })

  test('空串 / null 是删除，删完空父级一起收掉', () => {
    const { cfg, opts } = home()
    writeConfigPatch({ 'providers.deepseek.base_url': 'https://api.deepseek.com/v1' }, opts)
    expect(readFileSync(cfg, 'utf8')).toContain('api.deepseek.com')
    writeConfigPatch({ 'providers.deepseek.base_url': null }, opts)
    const text = readFileSync(cfg, 'utf8')
    expect(text).not.toContain('api.deepseek.com')
    expect(text).not.toMatch(/deepseek:\s*\n\s*\n/)
  })
})

describe('PRD-M8-011 AC-1 / AC-3 · key 只进 secrets.yaml，界面只看得到掩码', () => {
  test('key 写进 secrets.yaml（0600），config.yaml 里没有它', () => {
    const { home: h, cfg, opts } = home()
    writeConfigPatch({ 'providers.deepseek.api_key': 'sk-deepseek-abcdef123456' }, opts)
    const secrets = secretsPath(join(h, '.domi'))
    expect(readFileSync(secrets, 'utf8')).toContain('sk-deepseek-abcdef123456')
    expect(statSync(secrets).mode & 0o777).toBe(0o600)
    expect(readFileSync(cfg, 'utf8')).not.toContain('sk-deepseek-abcdef123456')
  })

  test('config.get 只给掩码与来源，明文不出现在响应里', () => {
    const { home: h, opts } = home()
    writeConfigPatch({ 'providers.deepseek.api_key': 'sk-deepseek-abcdef123456' }, opts)
    const view = readSettings(opts)
    expect(view.secrets.deepseek).toMatchObject({ set: true, source: 'secrets' })
    expect(view.secrets.deepseek?.masked).toBe(maskSecret('sk-deepseek-abcdef123456'))
    expect(JSON.stringify(view)).not.toContain('abcdef123456')
    // M9 起只列出登记过的 provider（加上默认那一家），不再是写死的四家
    expect(view.secrets.openai).toBeUndefined()
    // 老写法（model.api_key）算默认那一家的
    expect(view.secrets.anthropic).toMatchObject({ set: true, source: 'config' })
    expect(view.paths.secrets).toBe(secretsPath(join(h, '.domi')))
  })

  test('环境变量优先，并且如实说来源是环境变量', () => {
    const { opts } = home()
    writeConfigPatch({ 'providers.deepseek.api_key': 'sk-deepseek-abcdef123456' }, opts)
    const view = readSettings({ ...opts, env: { DEEPSEEK_API_KEY: 'sk-env-999999999' } })
    expect(view.secrets.deepseek).toMatchObject({ set: true, source: 'env' })
    expect(JSON.stringify(view)).not.toContain('sk-env-999999999')
  })

  test('secrets.yaml 权限比 0600 宽时标出来（doctor 会提示），但仍然读得到', () => {
    const { home: h, opts } = home()
    writeConfigPatch({ 'providers.deepseek.api_key': 'sk-deepseek-abcdef123456' }, opts)
    const secrets = secretsPath(join(h, '.domi'))
    chmodSync(secrets, 0o644)
    const view = readSettings(opts)
    expect(view.secretsTooOpen).toBe(true)
    expect(view.secrets.deepseek?.set).toBe(true)
  })

  test('掩码只留头尾', () => {
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop')).toContain('…')
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop')).toContain('mnop')
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop')).not.toContain('abcdefghij')
  })

  test('secrets.yaml 不存在时也不报错（还没填过 key）', () => {
    const { home: h, opts } = home()
    expect(existsSync(secretsPath(join(h, '.domi')))).toBe(false)
    expect(readSettings(opts).secrets.anthropic).toMatchObject({ set: true, source: 'config' })
  })
})
