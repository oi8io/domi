/**
 * PRD-M15-002 AC-3 · 降级链（SPEC-M15-002 取舍-17）
 * - 遮蔽档 → 遮蔽一批（落 ctx.mask）→ 重估
 * - 压缩档 → 压缩（可轮中）→ 重估
 * - 硬顶 → 停 + error{scope:'context', recoverable:true} + 出路
 * 动作由调用方注入；本函数只编排与落事件。
 */
import { expect, test } from 'bun:test'
import type { DomiEvent } from '@domi/protocol'
import { type DegradeActions, degrade } from '../src/degrade.ts'

const noop = async () => ({ freed: 0, ev: {} as DomiEvent })

function actions(over: Partial<DegradeActions> = {}): DegradeActions {
  return { mask: noop, compact: async () => ({ ok: true, freed: 0 }), ...over }
}

test('ok 档：不动，直接 proceed', async () => {
  const r = await degrade(5_000, 10_000, actions())
  expect(r.action).toBe('proceed')
  expect(r.events).toEqual([])
  expect(r.levels).toEqual(['ok'])
})

test('mask 档：遮蔽一批 → 重估 → 落到 ok → proceed（落 ctx.mask）', async () => {
  const r = await degrade(
    6_500,
    10_000,
    actions({
      mask: async () => ({
        freed: 2_000,
        ev: { t: 'ctx.mask', seqs: [3, 5], reason: 'threshold', freedTokens: 2_000 } as DomiEvent,
      }),
    }),
  )
  expect(r.action).toBe('proceed')
  expect(r.events.map((e) => e.t)).toEqual(['ctx.mask'])
  expect(r.levels).toEqual(['mask', 'ok'])
})

test('mask 腾不出 → 链继续：压缩档 → 压缩 → ok', async () => {
  const r = await degrade(8_500, 10_000, actions({ compact: async () => ({ ok: true, freed: 3_000 }) }))
  expect(r.action).toBe('proceed')
  expect(r.events).toEqual([])
  expect(r.levels).toEqual(['compact', 'ok'])
})

test('压缩后仍超硬顶 → 停 + error（scope=context, recoverable）', async () => {
  const r = await degrade(9_500, 10_000, actions())
  expect(r.action).toBe('stop')
  const err = r.events.find((e) => e.t === 'error') as
    | { scope?: string; recoverable?: boolean; message?: string }
    | undefined
  expect(err).toBeDefined()
  expect(err!.scope).toBe('context')
  expect(err!.recoverable).toBe(true)
  expect(String(err!.message)).toContain('开一个新会话')
})

test('遮蔽成功但仍在 hard 档 → 压缩 → 仍 hard → 停', async () => {
  const r = await degrade(
    9_800,
    10_000,
    actions({
      mask: async () => ({
        freed: 500,
        ev: { t: 'ctx.mask', seqs: [1], reason: 'threshold', freedTokens: 500 } as DomiEvent,
      }),
    }),
  )
  expect(r.action).toBe('stop')
  expect(r.levels).toEqual(['hard', 'hard', 'hard'])
})
