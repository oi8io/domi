/**
 * PRD-M2-002 · 确定性上下文清理（AC-1~4）
 *
 * 这一层的全部价值在于**不花钱也不掷骰子**：
 * 同样的输入永远得到同样的输出，所以它可以进 CI，也不会把 L1 回放（PRD-M2-008）搅乱。
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventEnvelope } from '@domi/protocol'
import { approxTokens, cleanup, collectReferences, projectText, stableArgs, truncateStack } from '../src/index.ts'

const DIR = join('fixtures', 'contexts')

function load(name: string): EventEnvelope[] {
  return readFileSync(join(DIR, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('//'))
    .map((l) => JSON.parse(l) as EventEnvelope)
}

const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort()

describe('AC-1 · 四条清理规则各自生效', () => {
  test('去重：同一次调用的旧结果换成指针，最后一次保持原样', () => {
    const r = cleanup(load('01-repeated-reads.jsonl'))
    const results = r.items.filter((i) => i.appliedRules.includes('dedupe'))
    expect(results).toHaveLength(2) // 三次读，去掉前两次
    expect(results[0]?.text).toContain('已去重')
    // 最后一次必须是原文 —— 它才是当前状态
    const last = r.items[r.items.length - 2]
    expect(last?.appliedRules).not.toContain('dedupe')
    expect(last?.text).toContain('config line 60')
  })

  test('冗长输出：头尾都留，因为结论常常在尾巴上', () => {
    const r = cleanup(load('02-verbose-test-output.jsonl'))
    const hit = r.items.find((i) => i.appliedRules.includes('verbose'))
    expect(hit).toBeDefined()
    expect(hit?.text).toContain('已截断')
    expect(hit?.text).toContain('200 pass') // 尾巴上的结论还在
    expect(hit?.text).toContain('(pass) some test 1') // 头也还在
  })

  test('已解决的错误：失败之后同一调用又成功了，失败详情只留一行', () => {
    const r = cleanup(load('03-resolved-error.jsonl'))
    const hit = r.items.find((i) => i.appliedRules.includes('resolvedError'))
    expect(hit).toBeDefined()
    expect(hit?.text).toContain('错误已解决')
    expect(hit?.text).not.toContain('ERR_PNPM_FETCH')
  })

  test('堆栈：留前三帧，其余记个数', () => {
    const { text, saved } = truncateStack(
      `Error: x\n    at a (f.ts:1:1)\n    at b (f.ts:2:1)\n    at c (f.ts:3:1)\n    at d (f.ts:4:1)\n    at e (f.ts:5:1)`,
      3,
    )
    expect(saved).toBeGreaterThan(0)
    expect(text).toContain('at a')
    expect(text).toContain('at c')
    expect(text).not.toContain('at e (')
    expect(text).toContain('省略 2 帧')
  })

  test('本来就短的会话不硬省 —— 省不出来就别动它', () => {
    const r = cleanup(load('08-mixed-short.jsonl'))
    expect(r.items.every((i) => i.appliedRules.length === 0)).toBe(true)
    expect(r.tokensAfter).toBe(r.tokensBefore)
  })
})

describe('AC-2 · 十条 fixture 上平均减少 ≥15%，且引用过的内容 100% 保留', () => {
  test('fixture 数量就是 AC 说的十条', () => {
    expect(FILES).toHaveLength(10)
  })

  test('平均削减 ≥15%', () => {
    const rates = FILES.map((f) => {
      const r = cleanup(load(f))
      return r.tokensBefore === 0 ? 0 : (r.tokensBefore - r.tokensAfter) / r.tokensBefore
    })
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    // 允许削减为 0 的只有这两条，各有各的理由。**别的哪条掉到 0 都要红。**
    //   08：本来就短，没东西可省——硬省才是 bug
    //   05：唯一能省的那次重复读被引用标注挡住了，这正是 AC-2 后半句想要的效果
    const ZERO_OK = new Set(['05-referenced-read.jsonl', '08-mixed-short.jsonl'])
    for (const [i, rate] of rates.entries()) {
      const f = FILES[i] as string
      if (rate === 0) expect(ZERO_OK.has(f)).toBe(true)
      else expect(rate).toBeGreaterThan(0)
    }
    expect(avg).toBeGreaterThanOrEqual(0.15)
  })

  test('被显式引用的 seq 一个字都不许少 —— 逐条断言', () => {
    for (const f of FILES) {
      const events = load(f)
      const refs = collectReferences(events)
      if (refs.size === 0) continue
      const r = cleanup(events)
      for (const seq of refs) {
        const item = r.items.find((i) => i.seq === seq)
        const source = events.find((e) => e.seq === seq)
        expect(item).toBeDefined()
        expect(source).toBeDefined()
        expect(item?.preserved).toBe(true)
        expect(item?.appliedRules).toEqual([])
        // 判据是 byte 级相同，不是"差不多"
        expect(item?.text).toBe(projectText(source!.ev))
      }
    }
  })

  test('引用标注真的在起作用 —— 去掉标注同一条就会被去重', () => {
    const events = load('05-referenced-read.jsonl')
    const withRef = cleanup(events)
    expect(withRef.items.find((i) => i.seq === 3)?.appliedRules).toEqual([])

    const stripped = events.map((e) => ({ ...e, ev: { ...e.ev, refs: undefined } }) as EventEnvelope)
    const without = cleanup(stripped)
    expect(without.items.find((i) => i.seq === 3)?.appliedRules).toContain('dedupe')
  })
})

describe('AC-3 · 全程无 LLM，且同输入同输出', () => {
  test('清理期间 fetch 一次都没被调用 —— 换成会炸的也照样通过', () => {
    const original = globalThis.fetch
    let called = 0
    globalThis.fetch = (() => {
      called++
      throw new Error('确定性清理不许联网（AC-3）')
    }) as unknown as typeof globalThis.fetch
    try {
      for (const f of FILES) cleanup(load(f))
      expect(called).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })

  test('同输入同输出，byte 级一致（连跑 10 次）', () => {
    for (const f of FILES) {
      const events = load(f)
      const runs = Array.from({ length: 10 }, () => JSON.stringify(cleanup(events)))
      expect(new Set(runs).size).toBe(1)
    }
  })

  test('参数顺序不同算同一次调用 —— 否则去重会漏', () => {
    expect(stableArgs({ a: 1, b: 2 })).toBe(stableArgs({ b: 2, a: 1 }))
  })
})

describe('AC-4 · 产生 ctx.cleanup 事件，含各类别削减的 token 数', () => {
  test('事件字段齐全，且 saved 四类都在', () => {
    const events = load('10-long-session.jsonl')
    const r = cleanup(events)
    expect(r.event.t).toBe('ctx.cleanup')
    expect(r.event.fromSeq).toBe(1)
    expect(r.event.toSeq).toBe(events[events.length - 1]?.seq ?? -1)
    expect(Object.keys(r.event.saved).sort()).toEqual(['dedupe', 'resolvedError', 'stack', 'verbose'])
    expect(r.event.tokensAfter).toBeLessThan(r.event.tokensBefore)
  })

  test('各类别之和不超过总削减 —— 不许重复记账', () => {
    for (const f of FILES) {
      const r = cleanup(load(f))
      const sum = Object.values(r.saved).reduce((a, b) => a + b, 0)
      expect(sum).toBeLessThanOrEqual(r.tokensBefore - r.tokensAfter + 1)
    }
  })

  test('事件能被当前 schema 解析 —— 它得进得了事件流', async () => {
    const { parseEvent, isKnownEvent } = await import('@domi/protocol')
    const r = cleanup(load('01-repeated-reads.jsonl'))
    const parsed = parseEvent(r.event)
    expect(isKnownEvent(parsed)).toBe(true)
    expect(parsed.t).toBe('ctx.cleanup')
  })
})

describe('设计不变量 · 清理只缩短投影，从不删除事件', () => {
  test('每一条事件都还在，一条不少', () => {
    for (const f of FILES) {
      const events = load(f)
      const r = cleanup(events)
      expect(r.items.map((i) => i.seq)).toEqual(events.map((e) => e.seq))
    }
  })

  test('被动过的条目都留下可读的标记 —— 不许凭空消失', () => {
    for (const f of FILES) {
      for (const item of cleanup(load(f)).items) {
        if (item.appliedRules.length === 0) continue
        expect(item.text.length).toBeGreaterThan(0)
        expect(/已去重|已截断|错误已解决|省略/.test(item.text)).toBe(true)
      }
    }
  })

  test('token 估算与 @domi/prompt 同口径', () => {
    expect(approxTokens('12345678')).toBe(2)
  })
})
