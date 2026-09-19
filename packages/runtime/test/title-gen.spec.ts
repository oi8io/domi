/**
 * PRD-M1-006 AC-1 · 会话标题自动生成与降级
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-title-'))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

const config = ConfigSchema.parse({ model: { provider: 'openai-compatible', name: 'm', apiKey: 'k' } })

function session(titleTurns: string[]) {
  return new DomiSession({
    config,
    sessionId: 's1',
    cwd: tmp(),
    dbPath: join(tmp(), 'e.db'),
    clock,
    provider: new StubProvider([[{ type: 'delta', text: '好的' }]], {
      onExhausted: 'repeat-last',
      // 标题生成是独立剧本，不占对话轮次（M10-001 起自动标题插队会打乱 turn 序列）
      titleScript: titleTurns.map((t) => [{ type: 'delta' as const, text: t }]),
    }),
  })
}

const LONG = '帮我把这个项目里所有用到旧版配置格式的地方都找出来并且逐个迁移到新格式上去，注意保持向后兼容'

describe('AC-1 · 标题生成', () => {
  test('结构化输出成功时用模型给的标题，并写进会话', async () => {
    const s = session(['{"title":"迁移旧配置格式"}'])
    await s.submit(LONG)
    expect(await s.generateTitle()).toBe('迁移旧配置格式')
    await s.flushAndClose()
  }, 15_000)

  test('失败三次后降级为首条用户输入的前 40 字符', async () => {
    const s = session(['不是 JSON', '还不是', '仍然不是'])
    await s.submit(LONG)
    const title = await s.generateTitle()
    expect(title).toBe(LONG.slice(0, 40))
    expect(title).toHaveLength(40)
    await s.flushAndClose()
  }, 15_000)

  test('降级不该让一次正常对话看起来「出错了」—— 不抛错、不产生 error 事件', async () => {
    const s = session(['坏', '坏', '坏'])
    await s.submit('短输入')
    await expect(s.generateTitle()).resolves.toBe('短输入')
    const errs = (await s.pumpAll()).filter((e) => e.ev.t === 'error')
    expect(errs).toEqual([])
    await s.flushAndClose()
  }, 15_000)

  test('模型返回空标题也降级，不留一个空白条目', async () => {
    const s = session(['{"title":"   "}'])
    await s.submit('短输入')
    expect(await s.generateTitle()).toBe('短输入')
    await s.flushAndClose()
  }, 15_000)
})
