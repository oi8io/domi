/**
 * SPEC-M15-004 取舍-2：老配置 full / clean / compact 读时映射为 balanced，不回写。
 * _full 不暴露（取舍-28）
 */
import { describe, expect, test } from 'bun:test'
import { ConfigSchema } from '../src/schema.ts'

const base = { model: { provider: 'stub', name: 's', apiKey: 'k' } }

describe('context.strategy 映射（取舍-2）', () => {
  test('默认 balanced', () => {
    const c = ConfigSchema.parse(base)
    expect(c.context.strategy).toBe('balanced')
  })
  test('balanced / economical 保留', () => {
    expect(ConfigSchema.parse({ ...base, context: { strategy: 'balanced' } }).context.strategy).toBe('balanced')
    expect(ConfigSchema.parse({ ...base, context: { strategy: 'economical' } }).context.strategy).toBe('economical')
  })
  test('旧值 full / clean / compact → balanced', () => {
    for (const old of ['full', 'clean', 'compact']) {
      expect(ConfigSchema.parse({ ...base, context: { strategy: old } }).context.strategy).toBe('balanced')
    }
  })
  test('非法策略名拒绝', () => {
    expect(() => ConfigSchema.parse({ ...base, context: { strategy: 'whatever' } })).toThrow()
  })
})

/** readSettings 的升级标志（SPEC 取舍-2：文件里还写旧值 → strategyUpgraded=true） */
import { afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSettings } from '../src/index.ts'

describe('readSettings 升级标志（取舍-2）', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })
  function home(): string {
    const d = mkdtempSync(join(tmpdir(), 'domi-cfg-'))
    dirs.push(d)
    return d
  }
  test('文件写旧值 full/clean/compact → strategyUpgraded=true 且 strategy=balanced', () => {
    for (const old of ['full', 'clean', 'compact']) {
      const h = home()
      mkdirSync(join(h, '.domi'), { recursive: true })
      mkdirSync(join(h, '.domi'), { recursive: true })
      writeFileSync(
        join(h, '.domi', 'config.yaml'),
        `model:\n  provider: stub\n  name: s\n  apiKey: k\ncontext:\n  strategy: ${old}\n`,
      )
      const v = readSettings({ home: h })
      expect(v.values['context.strategyUpgraded']).toBe(true)
      expect(v.values['context.strategy']).toBe('balanced')
    }
  })
  test('文件写新值或不写 → strategyUpgraded=false', () => {
    const h = home()
    mkdirSync(join(h, '.domi'), { recursive: true })
    writeFileSync(join(h, '.domi', 'config.yaml'), `model:\n  provider: stub\n  name: s\n  apiKey: k\n`)
    expect(readSettings({ home: h }).values['context.strategyUpgraded']).toBe(false)
    const h2 = home()
    mkdirSync(join(h2, '.domi'), { recursive: true })
    writeFileSync(
      join(h2, '.domi', 'config.yaml'),
      `model:\n  provider: stub\n  name: s\n  apiKey: k\ncontext:\n  strategy: economical\n`,
    )
    expect(readSettings({ home: h2 }).values['context.strategyUpgraded']).toBe(false)
  })
})
