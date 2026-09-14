/**
 * PRD-M0-001 · 会话以 append-only 事件流持久化
 * SPEC-M0-001（存储引擎）· §4.1 表结构
 *
 * 本文件在 TASK-M0-006 提交时**必须是红的**——实现留到 TASK-M0-007。
 * 红的原因必须是 NotImplementedError，不是加载失败或语法错误。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent } from '@domi/protocol'
import { SqliteEventLog } from '../src/index.ts'

const dirs: string[] = []
function tmpDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-store-'))
  dirs.push(d)
  return join(d, 'events.db')
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** 一轮完整对话：输入 → 模型 → 工具 → 结果 */
const ONE_TURN: DomiEvent[] = [
  { t: 'user.input', text: '把 README 的标题改成 domi' },
  { t: 'model.request', provider: 'stub', model: 'stub-1', tokensIn: 128 },
  { t: 'model.delta', text: '我先读一下文件' },
  { t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'README.md' } },
  { t: 'tool.result', id: 'c1', ok: true, payload: { lines: 3 }, ms: 12 },
  { t: 'model.usage', raw: { input_tokens: 128, cache_read_input_tokens: 96 } },
]

describe('PRD-M0-001 AC-1 · seq 连续、无空洞、无重复', () => {
  test('一轮完整对话后 seq 为 1..n 的连续序列', async () => {
    const log = new SqliteEventLog({ path: tmpDb() })
    const range = await log.append('s1', ONE_TURN)
    expect(range).toEqual({ from: 1, to: ONE_TURN.length })

    const rows = await log.read('s1')
    const seqs = rows.map((r) => r.seq)
    expect(seqs).toEqual(Array.from({ length: ONE_TURN.length }, (_, i) => i + 1))
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(await log.head('s1')).toBe(ONE_TURN.length)
    log.close()
  })

  test('多次 append across 会话不互相串号', async () => {
    const log = new SqliteEventLog({ path: tmpDb() })
    await log.append('a', ONE_TURN)
    await log.append('b', ONE_TURN.slice(0, 2))
    await log.append('a', ONE_TURN.slice(0, 1))
    expect(await log.head('a')).toBe(ONE_TURN.length + 1)
    expect(await log.head('b')).toBe(2)
    log.close()
  })
})

describe('PRD-M0-001 AC-2 · 崩溃后重放与崩溃前 JSON 深比较相等', () => {
  test('重开数据库后读出的事件流与关闭前完全一致', async () => {
    const path = tmpDb()
    const before = await (async () => {
      const log = new SqliteEventLog({ path })
      await log.append('s1', ONE_TURN)
      const rows = await log.read('s1')
      // 模拟 kill -9：不走优雅关闭
      return rows
    })()

    const reopened = new SqliteEventLog({ path })
    const after = await reopened.read('s1')
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)))
    reopened.close()
  })
})

describe('PRD-M0-001 AC-4 · 事务中途抛异常后不留半条事件', () => {
  test('append 中途失败则整批回滚，head 不前进', async () => {
    const path = tmpDb()
    const log = new SqliteEventLog({ path })
    await log.append('s1', ONE_TURN)
    const headBefore = await log.head('s1')

    // 第 2 条带一个无法序列化的值（循环引用），append 必须整批失败
    const poisoned = { t: 'tool.call', id: 'c2', name: 'fs.write', args: {} } as DomiEvent & { args: Record<string, unknown> }
    ;(poisoned.args as Record<string, unknown>).self = poisoned.args
    await expect(log.append('s1', [{ t: 'model.delta', text: 'ok' }, poisoned])).rejects.toThrow()

    expect(await log.head('s1')).toBe(headBefore)
    const rows = await log.read('s1')
    expect(rows).toHaveLength(headBefore)
    log.close()
  })
})
