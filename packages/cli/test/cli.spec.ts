/**
 * PRD-M1-008 · 分发与首次运行（AC-3/AC-4）
 * PRD-M1-010 · 卸载与数据清理（AC-1~3）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configSource, loadConfig } from '@domi/config'
import { SqliteEventLog } from '@domi/store'
import {
  CONFIG_TEMPLATE,
  type Command,
  diagnose,
  exportAll,
  exportableConfig,
  formatFindings,
  formatOnboarding,
  formatPurgePlan,
  HELP,
  ONBOARDING_STEPS,
  PURGE_CONFIRM_WORD,
  parseCli,
  planPurge,
  UnknownCommandError,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-cli-'))
  dirs.push(d)
  return d
}

const BASE = {
  configPath: '/nonexistent/config.yaml',
  hasCredential: false,
  credentialEnvNames: ['DOMI_API_KEY', 'ANTHROPIC_API_KEY'],
  dataDir: '/tmp',
  gitAvailable: false,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
}

describe('AC-4 · doctor 的每条问题都带可执行命令', () => {
  test('所有 not-ok 的条目都有一条 `$ ` 开头的命令', () => {
    const findings = diagnose(BASE)
    const bad = findings.filter((f) => !f.ok)
    expect(bad.length).toBeGreaterThan(0)
    for (const f of bad) {
      expect(f.fix).not.toBeNull()
      expect(f.fix as string).toMatch(/^\$ .+/)
    }
  })

  test('渲染后的输出里，每个问题下面都能匹配到 ^\\$ .+', () => {
    const out = formatFindings(diagnose(BASE))
    const cmdLines = out.split('\n').filter((l) => /^\s*\$ .+/.test(l))
    expect(cmdLines.length).toBe(diagnose(BASE).filter((f) => !f.ok).length)
  })

  test('一切正常时不编造问题', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'config.yaml'), CONFIG_TEMPLATE())
    const findings = diagnose({
      ...BASE,
      configPath: join(dir, 'config.yaml'),
      hasCredential: true,
      gitAvailable: true,
      dataDir: dir,
    })
    expect(findings.every((f) => f.ok)).toBe(true)
    expect(formatFindings(findings)).toContain('一切正常')
  })

  test('ADR-014 · 还在用旧的 config.toml → 给出迁移命令', () => {
    const f = diagnose({ ...BASE, legacyConfig: { path: '/h/.domi/config.toml', ignored: false } }).find((x) =>
      x.title.includes('TOML'),
    )!
    expect(f.ok).toBe(false)
    expect(f.fix).toBe('$ domi init --from-toml > /h/.domi/config.yaml')
  })

  test('ADR-014 · YAML 与旧 TOML 都在 → 说清楚 TOML 已被忽略', () => {
    const f = diagnose({ ...BASE, legacyConfig: { path: '/h/.domi/config.toml', ignored: true } }).find((x) =>
      x.title.includes('TOML'),
    )!
    expect(f.ok).toBe(false)
    expect(f.detail).toContain('被忽略')
    expect(f.fix).toMatch(/^\$ /)
  })

  test('git 缺失时说清楚「仍能跑，但没有安全网」', () => {
    const f = diagnose(BASE).find((x) => x.title.includes('步级快照'))!
    expect(f.detail).toContain('没有安全网')
    expect(f.fix).toContain('git --version')
  })
})

describe('AC-3 · 首次运行引导是固定四步', () => {
  test('四步齐全，顺序写死', () => {
    expect(ONBOARDING_STEPS().map((s) => s.id)).toEqual(['provider', 'credential', 'verify', 'chat'])
  })

  test('每一步的提示都能被冒烟脚本逐个断言', () => {
    const out = formatOnboarding()
    for (const s of ONBOARDING_STEPS()) expect(out).toContain(s.prompt)
    expect(out).toContain('第 1 步 / 共 4 步')
    expect(out).toContain('第 4 步 / 共 4 步')
  })

  test('全程无需外部文档：每步都自带提示', () => {
    for (const s of ONBOARDING_STEPS()) expect(s.hint.length).toBeGreaterThan(5)
  })
})

describe('命令面', () => {
  test('不带子命令就是进对话 —— 最常用的路径不该需要输入任何东西', () => {
    expect(parseCli([]).command).toBe('chat')
  })

  test.each<[Command]>([['doctor'], ['init'], ['session'], ['data'], ['prompt'], ['report-bug']])('%s 可用', (c) => {
    expect(parseCli([c]).command).toBe(c)
  })

  test('未知命令报错时列出可用命令，不是干巴巴一句 unknown', () => {
    expect(() => parseCli(['胡说'])).toThrow(UnknownCommandError)
    try {
      parseCli(['胡说'])
    } catch (e) {
      expect((e as Error).message).toContain('doctor')
      expect((e as Error).message).toContain('$ domi --help')
    }
  })

  test('子命令与参数', () => {
    const p = parseCli(['session', 'restore', 's-123'])
    expect(p.sub).toBe('restore')
    expect(p.args).toEqual(['s-123'])
  })

  test('PRD-M3-006 AC-1 · --connect 带地址，进的还是对话', () => {
    const p = parseCli(['--connect', 'ws://10.0.0.2:7437'])
    expect(p.command).toBe('chat')
    expect(p.flags.connect).toBe('ws://10.0.0.2:7437')
    expect(parseCli([]).flags.connect).toBeUndefined()
    expect(HELP()).toContain('--connect')
    expect(HELP()).toContain('DOMI_TOKEN')
  })

  test('help 把七个命令都列了', () => {
    for (const c of ['doctor', 'init', 'session', 'data', 'prompt', 'report-bug']) expect(HELP()).toContain(c)
  })
})

describe('PRD-M1-010 · 导出与清除', () => {
  test('配置模板本身就是合法配置（YAML，ADR-014）', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'config.yaml'), CONFIG_TEMPLATE())
    const cfg = loadConfig({ path: join(dir, 'config.yaml'), env: {} })
    expect(cfg.model.provider).toBe('anthropic')
    expect(cfg.permissions.rules.map((r) => r.name)).toContain('confirm-shell')
  })

  test('AC-1 · 导出是 JSONL + YAML，没有私有二进制', async () => {
    const dbDir = tmp()
    const log = new SqliteEventLog({ path: join(dbDir, 'e.db'), cwd: '/tmp/w' })
    await log.append('a', [{ t: 'user.input', text: '你好' }])
    await log.append('b', [{ t: 'user.input', text: '第二个会话' }])

    const out = join(tmp(), 'export')
    const r = await exportAll(log, out, CONFIG_TEMPLATE())
    log.close()

    expect(r.sessions).toBe(2)
    expect(r.events).toBe(2)
    expect(r.files.every((f) => f.endsWith('.jsonl') || f.endsWith('.yaml'))).toBe(true)
    // 导出的东西必须能被别的工具直接读
    const line = readFileSync(join(out, 'session-a.jsonl'), 'utf8').split('\n')[0] as string
    expect(() => JSON.parse(line)).not.toThrow()
    expect(readFileSync(join(out, 'config.yaml'), 'utf8')).toContain('model:')
  })

  test('BUG-M3-011 · 导出的是你自己的配置（不是模板），且不带 api_key', () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'config.yaml'),
      'model:\n  provider: anthropic\n  name: glm-mine\n  api_key: sk-ant-should-not-leave-0123456789\n',
    )
    const text = exportableConfig(configSource({ path: join(dir, 'config.yaml'), env: {} }))
    expect(text).toContain('glm-mine')
    expect(text).not.toContain('sk-ant-should-not-leave')
    expect(text).not.toContain('api_key')
  })

  test('BUG-M3-011 · 还没有配置文件时导出模板', () => {
    const text = exportableConfig(configSource({ path: join(tmp(), 'none.yaml'), env: {} }))
    expect(text).toBe(CONFIG_TEMPLATE())
  })

  test('AC-1 · 软删除的会话也导出 —— 「全部拿走」就是全部', async () => {
    const dbDir = tmp()
    const log = new SqliteEventLog({ path: join(dbDir, 'e.db'), cwd: '/tmp/w' })
    await log.append('gone', [{ t: 'user.input', text: '删掉的' }])
    log.sessions.softDelete('gone', 1)
    const out = join(tmp(), 'export')
    expect((await exportAll(log, out, '')).sessions).toBe(1)
    log.close()
  })

  test('AC-2 · purge 前列出目录与总大小，并要求输入确认词', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'shadows', 'abc'), { recursive: true })
    writeFileSync(join(dir, 'shadows', 'abc', 'blob'), 'x'.repeat(4096))
    writeFileSync(join(dir, 'events.db'), 'y'.repeat(1024))

    const plan = planPurge(dir)
    expect(plan.entries).toHaveLength(2)
    expect(plan.totalBytes).toBe(5120)
    expect(plan.confirmWord).toBe(PURGE_CONFIRM_WORD)

    const out = formatPurgePlan(plan)
    expect(out).toContain('不可恢复')
    expect(out).toContain(PURGE_CONFIRM_WORD)
    // 删之前提醒能先导出 —— 这一句能救回不少人
    expect(out).toContain('domi data export')
  })

  test('AC-3 · 目录不存在时 plan 为空而不是崩', () => {
    expect(planPurge(join(tmp(), '不存在')).entries).toEqual([])
  })
})
