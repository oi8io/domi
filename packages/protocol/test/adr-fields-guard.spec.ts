/**
 * PRD-M0-007 · spike 结论落盘的守卫，同样先红一次
 * 这个守卫挡的是"做了 spike 但结论只留下一句『性能还行』"。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const ADR = 'docs/adr/001-runtime-choice.md'
const BAK = 'docs/adr/.001.bak'

afterEach(() => {
  if (!existsSync(BAK)) return
  // 恢复原文是关键；删备份失败（没有删除权限的挂载）不该让测试红——
  // .bak 已经在 .gitignore 里，残留不会被提交
  copyFileSync(BAK, ADR)
  try {
    rmSync(BAK)
  } catch {
    /* 留着就留着 */
  }
})

async function run(): Promise<number> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-adr-fields.ts'], { stdout: 'pipe', stderr: 'pipe' })
  await new Response(p.stderr).text()
  return await p.exited
}

describe('守卫会红', () => {
  test('P95 段里没有具体毫秒数时不通过', async () => {
    copyFileSync(ADR, BAK)
    const text = readFileSync(ADR, 'utf8')
    const start = text.indexOf('## 实测-渲染帧耗时P95')
    const end = text.indexOf('## 实测-native模块兼容清单')
    writeFileSync(ADR, `${text.slice(0, start)}## 实测-渲染帧耗时P95\n\n性能还行，够用。\n\n${text.slice(end)}`, 'utf8')
    expect(await run()).not.toBe(0)
  })

  test('缺少「若不通的退路」段时不通过', async () => {
    copyFileSync(ADR, BAK)
    const text = readFileSync(ADR, 'utf8')
    writeFileSync(ADR, text.slice(0, text.indexOf('## 若不通的退路')), 'utf8')
    expect(await run()).not.toBe(0)
  })
})

describe('真实 ADR 是合格的', () => {
  test('001 与 005 的字段齐备', async () => {
    expect(await run()).toBe(0)
  })
})
