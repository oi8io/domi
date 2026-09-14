/**
 * PRD-M1-011 AC-6 · 回滚确认框明示副作用范围
 */
import { describe, expect, test } from 'bun:test'
import { REVERT_NOTICE, RevertDialog } from '../src/components/ConfirmDialog.tsx'
import { renderAt } from './render.tsx'

describe('AC-6 · 副作用范围', () => {
  test('文案明说 shell 命令、网络请求、已 push 的 commit 不会被撤销', async () => {
    const h = renderAt(100, <RevertDialog ask={{ toSeq: 12, scope: 'both', fileCount: 3 }} />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('shell 命令')
    expect(frame).toContain('网络请求')
    expect(frame).toContain('push')
    h.unmount()
  })

  test('三种粒度各自说清楚会发生什么', async () => {
    for (const [scope, expected] of [
      ['files', '只还原文件'],
      ['conversation', '只作废对话'],
      ['both', '还原文件并作废对话'],
    ] as const) {
      const h = renderAt(100, <RevertDialog ask={{ toSeq: 5, scope, fileCount: 1 }} />)
      await h.flush()
      expect(h.lastFrame()).toContain(expected)
      h.unmount()
    }
  })

  test('默认取消 —— 和权限确认框同一个立场（INV-03）', async () => {
    const h = renderAt(100, <RevertDialog ask={{ toSeq: 1, scope: 'both', fileCount: 0 }} />)
    await h.flush()
    expect(h.lastFrame()).toContain('默认取消')
    h.unmount()
  })

  test('影响的文件数要显示 —— 「回滚 3 个文件」和「回滚 300 个」是两回事', async () => {
    const h = renderAt(100, <RevertDialog ask={{ toSeq: 9, scope: 'files', fileCount: 42 }} />)
    await h.flush()
    expect(h.lastFrame()).toContain('42 个文件')
    h.unmount()
  })
})

describe('两份文案不许漂移', () => {
  test('apps 里的副本与 @domi/checkpoint 的原件逐字相同', async () => {
    // apps 不许 import checkpoint（INV-02），所以这里读源码比对，
    // 而不是 import 过来比。漂移了这条会红。
    const src = await Bun.file('packages/checkpoint/src/revert.ts').text()
    const m = src.match(/export const REVERT_SIDE_EFFECT_NOTICE =\s*'([^']+)'/)
    expect(m).not.toBeNull()
    expect((m as RegExpMatchArray)[1]).toBe(REVERT_NOTICE)
  })
})
