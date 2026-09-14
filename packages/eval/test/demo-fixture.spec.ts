/**
 * 提交在仓库里的示范 fixture 不许腐烂 —— PRD-M2-008 AC-2
 *
 * `fixtures/sessions/*.json` 是**提测的第一条命令**（`domi eval run`）会跑的东西。
 * 如果哪天 kernel 的循环改了形状、fixture 格式动了，这里先红，
 * 而不是等提测的人 clone 下来跑出一句看不懂的错。
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, replay } from '../src/index.ts'

const DIR = join('fixtures', 'sessions')

describe('随仓库提交的 fixture', () => {
  test('目录存在且至少有一条 —— 新克隆的仓库要能立刻跑通回放', () => {
    expect(existsSync(DIR)).toBe(true)
    expect(readdirSync(DIR).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
  })

  for (const file of existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : []) {
    test(`${file} 回放通过`, async () => {
      const r = await replay(parse(readFileSync(join(DIR, file), 'utf8')))
      expect(r.divergence).toBeNull()
      expect(r.ok).toBe(true)
      expect(r.actualCalls).toBeGreaterThan(0)
    })

    test(`${file} 被改坏时会红 —— 否则这条测试等于没有`, async () => {
      const f = parse(readFileSync(join(DIR, file), 'utf8'))
      const broken = structuredClone(f)
      const first = broken.expectedCalls[0]
      expect(first).toBeDefined()
      if (first) first.name = 'fs.read.WRONG'
      const r = await replay(broken)
      expect(r.ok).toBe(false)
      expect(r.divergence?.index).toBe(0)
    })
  }
})
