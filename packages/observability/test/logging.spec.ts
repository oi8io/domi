/**
 * PRD-M1-009 · 日志与故障排查（AC-1~4）· INV-11
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildManifest,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_RETAIN_DAYS,
  formatManifest,
  Logger,
  parseLevel,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-log-'))
  dirs.push(d)
  return d
}

const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)

describe('AC-1 · 轮转与保留', () => {
  test('按天分文件', () => {
    const dir = tmp()
    let t = T0
    const log = new Logger({ dir, now: () => t })
    log.info('第一天')
    t += DAY
    log.info('第二天')
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['domi-2026-09-14.log', 'domi-2026-09-15.log'])
  })

  test('单文件超上限时切走，当天主文件继续写', () => {
    const dir = tmp()
    const log = new Logger({ dir, now: () => T0, maxFileBytes: 200 })
    for (let i = 0; i < 20; i++) log.info(`第 ${i} 条`.repeat(3))
    const files = readdirSync(dir)
    expect(files.some((f) => /\.log\.\d+$/.test(f))).toBe(true)
    expect(files).toContain('domi-2026-09-14.log')
  })

  test('保留 7 天，更早的删掉', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'domi-2026-08-01.log'), 'old\n')
    writeFileSync(join(dir, 'domi-2026-09-13.log'), 'recent\n')
    // 按文件名里的日期算，不看 mtime —— mtime 会被备份工具改掉
    new Logger({ dir, now: () => T0 }).info('今天')
    expect(existsSync(join(dir, 'domi-2026-08-01.log'))).toBe(false)
    expect(existsSync(join(dir, 'domi-2026-09-13.log'))).toBe(true)
  })

  test('默认值就是 AC 写的那两个数', () => {
    expect(DEFAULT_RETAIN_DAYS).toBe(7)
    expect(DEFAULT_MAX_FILE_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('AC-2 · 级别', () => {
  test('默认 info，debug 不写', () => {
    const lines: string[] = []
    const log = new Logger({ sink: (l) => lines.push(l), now: () => T0 })
    log.debug('看不见')
    log.info('看得见')
    log.warn('也看得见')
    expect(lines).toHaveLength(2)
  })

  test('DOMI_LOG 能覆盖级别，非法值退回默认而不是崩', () => {
    expect(parseLevel('debug')).toBe('debug')
    expect(parseLevel('ERROR')).toBe('error')
    expect(parseLevel('胡说')).toBe('info')
    expect(parseLevel(undefined)).toBe('info')
  })

  test('error 级别下只写 error', () => {
    const lines: string[] = []
    const log = new Logger({ sink: (l) => lines.push(l), level: 'error', now: () => T0 })
    log.warn('w')
    log.error('e')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('"level":"error"')
  })
})

describe('AC-3 · 日志也要脱敏（INV-11）', () => {
  test('凭据藏在任何字段里都跑不掉 —— 脱敏的是整条 JSON', () => {
    const lines: string[] = []
    const log = new Logger({ sink: (l) => lines.push(l), now: () => T0 })
    log.error('provider 连接失败', {
      url: 'https://api.example/v1',
      header: 'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz01',
      nested: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    })
    const all = lines.join('\n')
    expect(all).not.toContain('sk-ant-api03')
    expect(all).not.toContain('ghp_')
    expect(all).toContain('[REDACTED]')
    // 脱敏后仍是合法 JSON，不然日志就没法被机器读了
    expect(() => JSON.parse(lines[0] as string)).not.toThrow()
  })

  test('落盘的日志文件里扫不出凭据', () => {
    const dir = tmp()
    new Logger({ dir, now: () => T0 }).info('key=sk-proj-abcdefghijklmnopqrstuvwxyz012345')
    const content = readFileSync(join(dir, 'domi-2026-09-14.log'), 'utf8')
    expect(content).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz012345')
  })
})

describe('AC-4 · report-bug 打包前的清单', () => {
  test('列出文件、大小与环境信息', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'domi-2026-09-14.log'), 'x'.repeat(2048))
    const m = buildManifest(dir, '0.1.0')
    expect(m.entries).toHaveLength(1)
    expect(m.totalBytes).toBe(2048)
    expect(m.version).toBe('0.1.0')
    expect(m.platform).toContain(process.platform)
  })

  test('文案明说「脱敏挡的是凭据，挡不了路径和命令」', () => {
    const out = formatManifest(buildManifest(tmp(), '0.1.0'))
    expect(out).toContain('将要打包以下内容')
    expect(out).toContain('确认后再发出去')
    expect(out).toContain('文件路径与命令内容')
  })

  test('日志目录不存在时也不崩', () => {
    expect(() => buildManifest(join(tmp(), '不存在'), '0.1.0')).not.toThrow()
  })
})
