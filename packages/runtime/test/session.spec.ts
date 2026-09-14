/**
 * PRD-M0-005 AC-3 · 退出前 flush，退出后重放不丢最后一轮
 * 以及 DomiSession 这层门面本身的行为（权限询问、事件推送）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-session-'))
  dirs.push(d)
  return d
}

const config = ConfigSchema.parse({
  model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
  permissions: { rules: [{ name: 'confirm-write', capability: 'fs.write', decision: 'ask' }] },
})

const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

describe('PRD-M0-005 AC-3 · 退出前 flush', () => {
  test('flushAndClose 之后重开数据库，最后一轮一条不少', async () => {
    const cwd = tmp()
    const db = join(tmp(), 'e.db')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: db,
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '最后一轮的回答' }]]),
    })
    const seen: EventEnvelope[] = []
    s.on('onEvents', (e) => seen.push(...e))

    await s.submit('最后一轮的提问')
    await s.flushAndClose()

    // 重开 —— 相当于进程被 Ctrl+C 之后再启动
    const reopened = new SqliteEventLog({ path: db })
    const replayed = await reopened.read('s1')
    reopened.close()

    const texts = JSON.stringify(replayed)
    expect(texts).toContain('最后一轮的提问')
    expect(texts).toContain('最后一轮的回答')
    expect(replayed.map((e) => e.seq)).toEqual(replayed.map((_, i) => i + 1))
    // 订阅者看到的和磁盘上的是同一批
    expect(seen.map((e) => e.seq)).toEqual(replayed.map((e) => e.seq))
  }, 15_000)
})

describe('DomiSession 的权限询问', () => {
  test('ask 会推给订阅者，回答 y 之后工具才真的执行', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), '旧', 'utf8')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: join(tmp(), 'e.db'),
      clock,
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: '新' } }],
        [{ type: 'delta', text: '写好了' }],
      ]),
    })

    const asks: Array<PendingAsk | null> = []
    s.on('onAsk', (a) => {
      asks.push(a)
      a?.answer(true)
    })

    await s.submit('改一下 a.txt')
    await s.flushAndClose()

    expect(asks.filter(Boolean)).toHaveLength(1)
    expect(asks.filter(Boolean)[0]?.capabilityId).toBe('fs.write')
    // 回答完要清掉，否则确认框会一直挂在屏幕上
    expect(asks.at(-1)).toBeNull()
    expect(await Bun.file(join(cwd, 'a.txt')).text()).toBe('新')
  }, 15_000)

  test('没有人订阅 onAsk 时直接拒绝，不是放行（非交互环境的立场）', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), '旧', 'utf8')
    const s = new DomiSession({
      config,
      sessionId: 's1',
      cwd,
      dbPath: join(tmp(), 'e.db'),
      clock,
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: '新' } }],
        [{ type: 'delta', text: '好的' }],
      ]),
    })
    await s.submit('改一下')
    await s.flushAndClose()
    expect(await Bun.file(join(cwd, 'a.txt')).text()).toBe('旧')
  }, 15_000)
})
