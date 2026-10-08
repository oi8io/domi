/**
 * domi doctor --context —— SPEC-M15-001（尺子 · PRD-M15-001 AC-5）
 *
 * 只读扫库、不改库；输出 R0 基线表；断裂归因来自 ctx.prefix.break。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { formatContextReport, scanContext } from '../src/doctor-context.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function db(): { path: string; log: SqliteEventLog } {
  const dir = mkdtempSync(join(tmpdir(), 'domi-doctor-ctx-'))
  dirs.push(dir)
  const log = new SqliteEventLog({ path: join(dir, 'e.db'), cwd: '/tmp/w' })
  return { path: join(dir, 'e.db'), log }
}

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts: 1_000 + seq, schemaVersion: 17, ev }
}

describe('scanContext', () => {
  test('只读扫描出 R0 表字段：命中率 / 输入 / 工具结果占比 / 可避免损失与断裂归因', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'domi-doctor-ctx-')), 'e.db')
    dirs.push(path.slice(0, path.lastIndexOf('/')))
    const log2 = new SqliteEventLog({ path, cwd: '/tmp/w' })
    seq = 0
    await log2.append('s1', [
      { t: 'user.input', text: '把减号改成加号' },
      {
        t: 'model.request',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tokensIn: 3,
        fingerprint: { toolHash: 'a', layers: [], messages: ['1', '2'] },
      },
      { t: 'model.delta', text: '先看看。' },
      { t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } },
      { t: 'tool.result', id: 'c1', ok: true, payload: { lines: 'x'.repeat(4000) }, ms: 4 },
      {
        t: 'model.request',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tokensIn: 9,
        fingerprint: { toolHash: 'a', layers: [], messages: ['1', '3'] },
      },
      { t: 'model.usage', raw: { input_tokens: 5000, output_tokens: 100 } },
      { t: 'ctx.prefix.break', prevSeq: 2, nextSeq: 6, cause: 'plan.update', layer: 'session.plan', msgIndex: 1 },
    ])
    log2.close()

    const r = await scanContext(path)
    expect(r.sessions).toHaveLength(1)
    const s = r.sessions[0]
    if (!s) throw new Error('空')
    expect(s.steps).toBe(2)
    expect(s.cacheHitPercent).toBe(0)
    expect(s.toolResultTokens).toBeGreaterThan(0)
    expect(s.breakCount).toBe(1)
    expect(s.avoidableLoss).toBe(5000)
    expect(r.totals.breakdown['plan.update']).toBe(1)
    expect(r.totals.memorySuccessRate).toBeNull()

    const out = formatContextReport(r)
    expect(out).toContain('上下文诊断')
    expect(out).toContain('断裂归因：plan.update ×1')
  })

  test('改库会被 SQLite 拒吗——只读不改（扫描后事件数不变）', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'domi-doctor-ctx-')), 'e.db')
    dirs.push(path.slice(0, path.lastIndexOf('/')))
    const log2 = new SqliteEventLog({ path, cwd: '/tmp/w' })
    seq = 0
    await log2.append('s1', [{ t: 'user.input', text: 'hi' }])
    log2.close()
    await scanContext(path)
    const check = new SqliteEventLog({ path, cwd: '/tmp/w' })
    const evs = await check.read('s1')
    check.close()
    expect(evs).toHaveLength(1)
  })
})
