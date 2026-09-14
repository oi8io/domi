/**
 * PRD-M0-007 AC-1 / AC-2 · spike 结论落盘的守卫，同样先红一次
 *
 * AC-1 要求 `docs/adr/001-runtime-choice.md` 含四个固定字段且 P95 是具体毫秒数；
 * AC-2 已回写（见 `docs/adr/005`），改为要求 ADR-005 含「触发重新激活压测的条件」。
 * 这个守卫挡的是「做了 spike 但结论只留下一句『性能还行』」。
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
  test('AC-1 / AC-2：001 与 005 的字段齐备', async () => {
    expect(await run()).toBe(0)
  })
})

describe('PRD-M0-007 AC-3 · spike 代码不许留在仓库里', () => {
  test('没有 spike/* 分支', async () => {
    const p = Bun.spawn(['git', 'branch', '-a'], { stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(p.stdout).text()
    await p.exited
    expect(out).not.toMatch(/spike\//)
  }, 30_000)

  test('工作树里没有 spike 目录 —— AGENTS.md：spike 代码必须删除重写', async () => {
    const p = Bun.spawn(['git', 'ls-files', '--', '*spike*'], { stdout: 'pipe', stderr: 'pipe' })
    const out = (await new Response(p.stdout).text()).trim()
    await p.exited
    // 文档里提到 spike 是正常的，被跟踪的**代码**不行
    const codeFiles = out.split('\n').filter((f) => f !== '' && /\.(ts|tsx|js|mjs)$/.test(f))
    expect(codeFiles).toEqual([])
  }, 30_000)
})
