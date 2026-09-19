/**
 * PRD-M10-001 · 会话标题接入运行时（AC-1/AC-2 的运行时侧）
 *
 * maybeAutoTitle 是 fire-and-forget（submit 不等待），所以断言用轮询等标题落库。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider, type ModelEvent } from '@domi/model'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-session-title-'))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

const config = ConfigSchema.parse({ model: { provider: 'openai-compatible', name: 'm', apiKey: 'k' } })

function session(titleTurns: string[]) {
  const cwd = tmp()
  return new DomiSession({
    config,
    sessionId: 's1',
    cwd,
    dbPath: join(cwd, 'e.db'),
    clock,
    provider: new StubProvider([[{ type: 'delta', text: '好的' }]], {
      onExhausted: 'repeat-last',
      titleScript: titleTurns.map((t): ModelEvent[] => [{ type: 'delta', text: t }]),
    }),
  })
}

/** 标题写库是异步的（maybeAutoTitle 不阻塞 submit），轮询等到它出现 */
async function waitTitle(
  s: DomiSession,
  pred: (t: string) => boolean,
  timeoutMs = 3_000,
): Promise<string> {
  const log = (s as unknown as { log: { sessions: { get(id: string): { title: string } | null } } }).log
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const t = log.sessions.get('s1')?.title ?? ''
    if (pred(t)) return t
    if (Date.now() > deadline) throw new Error(`标题未在 ${timeoutMs}ms 内满足条件（当前：${JSON.stringify(t)}）`)
    await Bun.sleep(20)
  }
}

const LONG = '帮我把这个项目里所有用到旧版配置格式的地方都找出来并且逐个迁移到新格式上去，注意保持向后兼容'

describe('PRD-M10-001 AC-1 · 第一轮结束后自动生成标题', () => {
  test('submit 第一轮后标题被写入（LLM 标题），不阻塞 submit 返回', async () => {
    const s = session(['{"title":"迁移旧配置格式"}'])
    await s.submit(LONG) // resolves 即证明没被标题生成拖住
    const title = await waitTitle(s, (t) => t === '迁移旧配置格式')
    expect(title).toBe('迁移旧配置格式')
    await s.flushAndClose()
  }, 15_000)

  test('第二轮不再重复触发：标题保持第一轮的值，generateTitle 只跑一次', async () => {
    let calls = 0
    const cwd = tmp()
    const stub = new StubProvider([[{ type: 'delta', text: '好的' }]], {
      onExhausted: 'repeat-last',
      titleScript: [[{ type: 'delta' as const, text: '{"title":"唯一标题"}' }]],
    })
    // 包一层计数：StubProvider 的 calls 含对话轮，用 generate 次数区分太脆，直接数「标题轮」出现次数
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: join(cwd, 'e.db'),
      clock,
      provider: stub,
    })
    await s.submit('第一轮')
    await waitTitle(s, (t) => t === '唯一标题')
    await s.submit('第二轮')
    await Bun.sleep(100) // 给 fire-and-forget 一点时间：若重复触发会再调一次 generateTitle
    const title = (s as unknown as { log: { sessions: { get(id: string): { title: string } | null } } }).log.sessions
      .get('s1')?.title
    expect(title).toBe('唯一标题')
    calls = stub.calls.filter((c) => c.messages.some((m) => String(m.content).includes('起一个不超过 20 字的标题')))
      .length
    expect(calls).toBe(1)
    await s.flushAndClose()
  }, 15_000)

  test('生成失败降级为首条输入前 40 字，且失败不阻塞 submit', async () => {
    const s = session(['不是 JSON', '还不是', '仍然不是'])
    await s.submit(LONG)
    const title = await waitTitle(s, (t) => t === LONG.slice(0, 40))
    expect(title).toHaveLength(40)
    // 降级不该让对话看起来出错了：不产生 error 事件
    const errs = (await s.pumpAll()).filter((e) => e.ev.t === 'error')
    expect(errs).toEqual([])
    await s.flushAndClose()
  }, 15_000)

  test('还没有 assistant 事件时不触发（第一轮进行中 / 空会话）', async () => {
    const s = session([])
    // 不 submit：事件流为空，maybeAutoTitle 无从触发（也没有入口），标题保持空
    await Bun.sleep(50)
    const t = (s as unknown as { log: { sessions: { get(id: string): { title: string } | null } } }).log.sessions.get(
      's1',
    )?.title
    expect(t ?? '').toBe('')
    await s.flushAndClose()
  }, 15_000)
})
