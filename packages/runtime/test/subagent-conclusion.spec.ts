/**
 * PRD-M15-007 AC-3 · 子 agent 结论与编排节点输出上限（约 2k token），超出写文件给路径
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateTextTokens } from '@domi/protocol'
import { truncateConclusion } from '../src/subagent.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('PRD-M15-007 AC-3 · 子 agent 结论 ≤2k token', () => {
  test('短结论原样返回，不写文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-sub-'))
    dirs.push(dir)
    const out = truncateConclusion('完成了：改了 a.ts 的导出。', dir)
    expect(out).toBe('完成了：改了 a.ts 的导出。')
    expect(readdirSync(dir)).toHaveLength(0)
  })

  test('长结论（>2k token）写文件给路径，内联只留提示', () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-sub-'))
    dirs.push(dir)
    const long = '结论内容 '.repeat(3000) // ≈9000 CJK token，远超 2k
    const out = truncateConclusion(long, dir)
    expect(estimateTextTokens(long)).toBeGreaterThan(2000)
    expect(out).toContain('超过')
    // 给路径（/private/var 与 /var 符号链接差异，按模式匹配）
    expect(out).toMatch(/全文在 .*\/subagent-[a-z0-9]+\.md/)
    // 内联部分本身很小
    expect(estimateTextTokens(out)).toBeLessThan(200)
    // 全文真的落盘了
    const files = readdirSync(dir)
    expect(files.length).toBeGreaterThan(0)
    expect(readFileSync(join(dir, files[0]!), 'utf8')).toBe(long)
  })
})
