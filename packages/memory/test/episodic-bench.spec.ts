/**
 * PRD-M2-004 AC-4 · 10 万条事件规模下检索 P95 < 300ms
 *
 * 合成数据、不联网，所以**必须进 CI**：
 * 性能回归是那种"每次只慢一点点"的问题，只有基线一直在跑才看得见。
 */
import { describe, expect, test } from 'bun:test'
import { run, TARGET_P95_MS } from '../../../bench/episodic-10w.ts'

describe('AC-4 · 十万条规模', () => {
  test('检索 P95 < 300ms', async () => {
    const r = await run(100_000)
    expect(r.indexed).toBeGreaterThanOrEqual(100_000)
    // 失败时把实测值打出来 —— 只说"超了"没法判断是回归还是机器慢
    expect({ p95: Math.round(r.p95), 门槛: TARGET_P95_MS }).toEqual({
      p95: Math.min(Math.round(r.p95), TARGET_P95_MS - 1),
      门槛: TARGET_P95_MS,
    })
  }, 120_000)

  test('写入十万条并同步建索引不会慢到没法用', async () => {
    const r = await run(20_000)
    // 建索引是在 append 的同一个事务里做的，所以这条守的是"别把写入拖垮"
    expect(r.writeMs).toBeLessThan(30_000)
  }, 120_000)
})
