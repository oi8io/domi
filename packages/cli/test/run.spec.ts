/**
 * PRD-M1-008/009/010 · 命令分发的真实行为
 * 走的是和用户一样的入口，不是直接调实现函数。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@domi/config'
import { SqliteEventLog } from '@domi/store'
import { parseCli, runCommand, VERSION } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-run-'))
  dirs.push(d)
  return d
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCommand(parseCli(argv), {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('通用', () => {
  test('--help 退出码 0 且列出命令', async () => {
    const r = await run(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('domi doctor')
  })

  test('--version', async () => {
    expect((await run(['--version'])).out).toBe(VERSION)
  })

  test('init 打印的模板里权限是默认拒绝的形状', async () => {
    const r = await run(['init'])
    expect(r.out).toContain('permissions:\n  rules:')
    expect(r.out).toContain('decision: ask')
    // 模板里不该出现真 key
    expect(r.out).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
  })
})

describe('prompt dump', () => {
  test('打印层与稳定前缀边界', async () => {
    const r = await run(['prompt'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('builtin.identity')
    expect(r.out).toContain('稳定前缀到此为止')
  })

  test('BUG-M3-012 · config.yaml 里的 prompt.layers 出现在 dump 里（PRD-M1-003 AC-3）', async () => {
    const d = tmp()
    const file = join(d, 'config.yaml')
    writeFileSync(file, 'prompt:\n  layers:\n    - id: my.style\n      text: 回答要短，先给结论。\n', 'utf8')
    const prev = process.env.DOMI_CONFIG
    process.env.DOMI_CONFIG = file
    try {
      const r = await run(['prompt'])
      expect(r.code).toBe(0)
      expect(r.out).toContain('my.style')
      expect(r.out).toContain('builtin.guardrail')
    } finally {
      if (prev === undefined) delete process.env.DOMI_CONFIG
      else process.env.DOMI_CONFIG = prev
    }
  })
})

describe('data', () => {
  test('export 不给目录时给出用法并返回 2', async () => {
    const r = await run(['data', 'export'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('$ domi data export')
  })

  test('purge 会打印清单与确认词，且 --yes 不生效', async () => {
    const r = await run(['data', 'purge', '--yes'])
    expect(r.out).toContain('DELETE')
    expect(r.out).toContain('--yes 对 purge 无效')
    // 不可恢复的操作不该被一个 flag 绕过
    expect(r.out).toContain('不可恢复')
  })

  test('export 真的写出文件', async () => {
    const out = join(tmp(), 'dump')
    const r = await run(['data', 'export', out])
    expect(r.code).toBe(0)
    expect(readdirSync(out)).toContain('config.yaml')
  }, 15_000)
})

describe('session', () => {
  test('restore 不给 id 时给出用法', async () => {
    const r = await run(['session', 'restore'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('$ domi session restore')
  })

  describe('BUG-M3-002 · restore 要真的恢复', () => {
    const realHome = process.env.HOME
    afterEach(() => {
      process.env.HOME = realHome
    })

    test('软删除的会话恢复后重新出现在列表里', async () => {
      const home = tmp()
      process.env.HOME = home
      mkdirSync(join(home, '.domi'), { recursive: true })
      const log = new SqliteEventLog({ path: join(home, '.domi', 'events.db'), cwd: home })
      await log.append('s-gone', [{ t: 'user.input', text: '删掉的那次' }])
      log.sessions.softDelete('s-gone', 1)
      log.close()
      expect((await run(['session', 'list'])).out).not.toContain('s-gone')

      const r = await run(['session', 'restore', 's-gone'])
      expect(r.code).toBe(0)
      expect((await run(['session', 'list'])).out).toContain('s-gone')
    })

    test('不存在的 id 报错，而不是说「已恢复」', async () => {
      process.env.HOME = tmp()
      const r = await run(['session', 'restore', 's-nope'])
      expect(r.code).toBe(1)
      expect(r.out).not.toContain('已恢复')
      expect(r.err).toContain('s-nope')
    })
  })
})

describe('ADR-014 · init --from-toml', () => {
  const realHome = process.env.HOME
  afterEach(() => {
    process.env.HOME = realHome
  })

  test('把旧的 config.toml 原样换成 YAML 打印出来，读回来是同一份配置', async () => {
    const home = tmp()
    process.env.HOME = home
    mkdirSync(join(home, '.domi'), { recursive: true })
    const tomlPath = join(home, '.domi', 'config.toml')
    writeFileSync(
      tomlPath,
      '[model]\nprovider = "anthropic"\nname = "glm"\nbase_url = "https://api.z.ai/api/anthropic"\n\n' +
        '[model.capabilities]\ntoolCall = true\n\n[[permissions.rules]]\nname = "r"\ncapability = "fs.read"\ndecision = "allow"\n',
      'utf8',
    )
    const r = await run(['init', '--from-toml'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('注释') // 开头说明注释没法带过来

    const yamlPath = join(home, 'converted.yaml')
    writeFileSync(yamlPath, r.out, 'utf8')
    const env = { DOMI_API_KEY: 'k' }
    expect(loadConfig({ path: yamlPath, env })).toEqual(loadConfig({ path: tomlPath, env }))
  })

  test('没有旧文件时说清楚，退出码 1', async () => {
    process.env.HOME = tmp()
    const r = await run(['init', '--from-toml'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('config.toml')
  })
})

describe('report-bug', () => {
  test('打印清单并提醒确认', async () => {
    const r = await run(['report-bug'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('将要打包以下内容')
    expect(r.out).toContain('确认后再发出去')
  })
})

describe('chat 无凭据时走引导', () => {
  test('打印四步引导而不是报错退出', async () => {
    const r = await run([])
    expect(r.code).toBe(0)
    expect(r.out).toContain('第 1 步 / 共 4 步')
  })
})
