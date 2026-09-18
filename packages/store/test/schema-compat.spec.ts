/**
 * PRD-M0-001 AC-5 · 三个历史 schema 版本混合加载，全部可解析且重放成功
 * SPEC-M0-004（未知事件降级）· §4.2（迁移策略）
 *
 * 这条 AC 是 v1.0 PRD 漏掉、审计时补上的。它守的是 INV-01 里最容易被做漏的半句：
 * "**任意历史事件永远可解析**"。
 */

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isUnknownEvent, parseEvent, SCHEMA_VERSION } from '@domi/protocol'
import { META_SCHEMA_VERSION, SqliteEventLog } from '../src/index.ts'

interface RawEnvelope {
  seq: number
  sessionId: string
  parentSeq: number | null
  ts: number
  schemaVersion: number
  ev: Record<string, unknown>
}

function load(name: string): RawEnvelope[] {
  return readFileSync(join('fixtures/events', name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RawEnvelope)
}

const MIXED = [
  ...load('legacy-v1.jsonl'),
  ...load('legacy-v2.jsonl'),
  ...load('legacy-v3.jsonl'),
  ...load('legacy-v4.jsonl'),
  ...load('legacy-v5.jsonl'),
  ...load('legacy-v6.jsonl'),
  ...load('legacy-v7.jsonl'),
  ...load('legacy-v8.jsonl'),
  ...load('legacy-v9.jsonl'),
  ...load('legacy-v10.jsonl'),
  ...load('legacy-v11.jsonl'),
  ...load('legacy-v12.jsonl'),
]
/** v1 代码写下的 error（没有 counters）与 v2 新增的 fs.snapshot —— 新代码都得认得 */
const V1_V2 = load('legacy-v1-error.jsonl')
/** v2 写的普通事件 + v3 新增的三种类型 —— SCHEMA_VERSION 2 → 3 的兼容面 */
const V2_V3 = load('v2-to-v3.jsonl')

describe('PRD-M0-001 AC-5 / PRD-M2-007 AC-4 · 各历史版本混合 fixture', () => {
  test('每一条都能解析，且没有一条抛错', () => {
    expect(MIXED).toHaveLength(39)
    for (const e of MIXED) {
      expect(() => parseEvent(e.ev, e.schemaVersion)).not.toThrow()
    }
  })

  test('本版本认识的类型仍然是已知事件', () => {
    const known = MIXED.filter((e) => e.schemaVersion === 1)
    for (const e of known) {
      expect(isUnknownEvent(parseEvent(e.ev, e.schemaVersion))).toBe(false)
    }
  })

  test('未来版本的新类型降级但保留原文，不丢数据', () => {
    // ctx.compact 在 v5 已经成了已知类型（M2-003），从这张表里移走——
    // 这正是这条测试想要的：新增类型时，**旧 fixture 一个字不改**，只是不再降级
    // memory.write 在 v7 成了已知类型，但 v3 那条假想的形状（没有 op）对不上现在的 schema，仍然降级——
    // 这正是「字段畸形也降级，不抛错」那条规矩在历史数据上的样子
    const futureTypes = ['soul.evolve', 'memory.write']
    for (const t of futureTypes) {
      const raw = MIXED.find((e) => e.ev.t === t)
      expect(raw).toBeDefined()
      const ev = parseEvent(raw!.ev, raw!.schemaVersion)
      expect(isUnknownEvent(ev)).toBe(true)
      if (!isUnknownEvent(ev)) throw new Error('unreachable')
      expect(ev.__unparsed).toEqual(raw!.ev)
      expect(ev.__schemaVersion).toBe(raw!.schemaVersion)
    }
  })

  test('已知类型 + 未来新增字段：解析成功且字段必须留下来（passthrough）', () => {
    const req = MIXED.find((e) => e.ev.t === 'model.request' && 'cacheReadTokens' in e.ev)!
    const ev = parseEvent(req.ev, req.schemaVersion)
    expect(isUnknownEvent(ev)).toBe(false)
    expect((ev as Record<string, unknown>).cacheReadTokens).toBe(128)

    const res = MIXED.find((e) => e.ev.t === 'tool.result' && 'snapshotId' in e.ev)!
    const ev2 = parseEvent(res.ev, res.schemaVersion)
    expect((ev2 as Record<string, unknown>).snapshotId).toBe('sha:deadbeef')
  })

  test('重放：混合流按 seq 排序后连续无空洞，parentSeq 链可走通', () => {
    const sorted = [...MIXED].sort((a, b) => a.seq - b.seq)
    // 长度跟着 MIXED 走：每加一个历史版本的 fixture，这里自动覆盖到它（PRD-M2-007 AC-4）
    expect(sorted.map((e) => e.seq)).toEqual(Array.from({ length: MIXED.length }, (_, i) => i + 1))
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.parentSeq).toBe(sorted[i - 1]!.seq)
    }
    expect(sorted[0]!.parentSeq).toBeNull()
  })
})

describe('v1 → v2 的兼容（SCHEMA_VERSION 从 1 升到 2）', () => {
  test('v1 写的 error 事件没有 counters，新代码照样认得', () => {
    const ev = parseEvent(V1_V2[0]!.ev, 1)
    expect(isUnknownEvent(ev)).toBe(false)
    expect((ev as Record<string, unknown>).counters).toBeUndefined()
  })

  test('v2 新增的 fs.snapshot 是已知类型', () => {
    const ev = parseEvent(V1_V2[1]!.ev, 2)
    expect(isUnknownEvent(ev)).toBe(false)
    expect((ev as Record<string, unknown>).phase).toBe('after')
  })
})

describe('v2 → v3 的兼容（新增 model.switch / snapshot / revert）', () => {
  test('v2 写的事件在 v3 代码下仍是已知类型', () => {
    const ev = parseEvent(V2_V3[0]!.ev, 2)
    expect(isUnknownEvent(ev)).toBe(false)
    expect(ev.t).toBe('tool.result')
  })

  test.each(['model.switch', 'snapshot', 'revert'])('v3 新增的 %s 是已知类型', (t) => {
    const raw = V2_V3.find((e) => e.ev.t === t)!
    const ev = parseEvent(raw.ev, 3)
    expect(isUnknownEvent(ev)).toBe(false)
  })

  test('revert 携带 undoSnapshotId —— 没有它「回滚可回滚」就无从谈起', () => {
    const raw = V2_V3.find((e) => e.ev.t === 'revert')!
    const ev = parseEvent(raw.ev, 3) as Record<string, unknown>
    expect(ev.undoSnapshotId).toBe('def456')
    expect(ev.scope).toBe('both')
  })
})

describe('§4.2 · 磁盘版本高于代码版本时只读打开，不拒绝启动', () => {
  test('readOnlyFuture 置位，append 被拒，read 仍可用', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-migrate-'))
    const path = join(dir, 'e.db')

    const log = new SqliteEventLog({ path })
    await log.append('s', [{ t: 'user.input', text: 'hi' }])
    log.close()

    // 模拟"被更新版本的 domi 写过"
    const raw = new Database(path)
    raw.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_SCHEMA_VERSION, String(SCHEMA_VERSION + 5))
    raw.close(false)

    const reopened = new SqliteEventLog({ path })
    expect(reopened.readOnlyFuture).toBe(true)
    expect(await reopened.read('s')).toHaveLength(1)
    await expect(reopened.append('s', [{ t: 'user.input', text: 'nope' }])).rejects.toThrow(/只读/)
    reopened.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
