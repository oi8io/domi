/**
 * PRD-M14-010 · SPEC-M14-010 取舍-2/3 —— Web 端回到这一步
 *
 * SSR 成字符串断言（不起浏览器）：RevertDialog 三选一 + 副作用 notice + busy 禁用；
 * StepRow 的「回到这一步之前」入口与已回滚标注；Transcript 的 data-dead 标注（AC-4：标已回滚但可读）。
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, type StepActivity } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepRow } from '../src/session/progressTab.tsx'
import { RevertDialog } from '../src/session/RevertDialog.tsx'
import { Transcript } from '../src/Transcript.tsx'

const planStep = (id: string, seq: number): StepActivity => ({
  step: { id, text: `步骤 ${id}`, status: 'done', depth: 0 },
  started: true,
  startSeq: seq,
  endSeq: seq + 10,
  durationMs: 123,
  toolCalls: 1,
  toolBreakdown: [{ name: 'fs.write', count: 1 }],
  files: [],
  tokens: 12,
  subagents: [],
  nodes: [],
})

describe('PRD-M14-010 AC-1/AC-3 · RevertDialog 三选一 + 副作用提示', () => {
  test('渲染三选一、notice 与确认/取消；busy 时确认禁用', () => {
    const html = renderToStaticMarkup(
      <RevertDialog busy={true} onCancel={() => undefined} onConfirm={() => undefined} />,
    )
    expect(html).toContain('data-scope="both"')
    expect(html).toContain('data-scope="files"')
    expect(html).toContain('data-scope="conversation"')
    expect(html).toContain('data-part="revert-notice"')
    expect(html).toContain('已执行的 shell 命令')
    expect(html).toContain('data-action="revert-confirm"')
    expect(html).toContain('disabled')
    expect(html).toContain('data-action="revert-cancel"')
  })
})

describe('PRD-M14-010 · 进度 tab 步骤「回到这一步之前」入口 + 已回滚标注', () => {
  test('started 且有 startSeq + onRevert → 入口按钮；dead=true → 标已回滚', () => {
    const store = createSessionStore()
    const html = renderToStaticMarkup(
      <StepRow
        s={planStep('s1', 5)}
        open={false}
        onToggle={() => undefined}
        onOpenStep={() => undefined}
        onOpenSubsession={() => undefined}
        onLocate={() => undefined}
        onRevert={() => undefined}
        dead={true}
      />,
    )
    expect(html).toContain('data-action="revert-step"')
    expect(html).toContain('data-part="step-dead"')
    expect(html).toContain(store === null ? 'x' : '回到这一步之前')
  })

  test('未 started 或无 onRevert → 不渲染入口', () => {
    const html = renderToStaticMarkup(
      <StepRow
        s={{ ...planStep('s2', 5), started: false, startSeq: null, endSeq: null }}
        open={false}
        onToggle={() => undefined}
        onOpenStep={() => undefined}
        onOpenSubsession={() => undefined}
        onLocate={() => undefined}
      />,
    )
    expect(html).not.toContain('data-action="revert-step"')
    expect(html).not.toContain('data-part="step-dead"')
  })
})

describe('PRD-M14-010 AC-4 · Transcript 对话标「已回滚」但可读', () => {
  test('dead 集合里的 seq 行标 data-dead + 徽标；不在的保持原样', () => {
    const store = createSessionStore()
    const env = (seq: number, ev: Record<string, unknown>): Parameters<typeof store.applyEvents>[0][number] => ({
      seq,
      sessionId: 't1',
      parentSeq: null,
      ts: seq,
      schemaVersion: 15,
      ev: ev as never,
    })
    store.applyEvents([
      env(1, { t: 'user.input', text: '改', refs: [] }),
      env(2, { t: 'tool.call', id: 'w1', name: 'fs.write', args: { path: 'a.txt' } }),
      env(3, { t: 'revert', toSeq: 1, scope: 'conversation', snapshotId: null, undoSnapshotId: null }),
    ])
    const html = renderToStaticMarkup(<Transcript items={store.$items.get()} dead={store.$dead.get()} />)
    expect(html).toContain('data-seq="2"')
    expect(html).toContain('data-dead="true"')
    expect(html).toContain('data-part="transcript-dead"')
    // seq 1（revert 之前）与 seq 3（revert 事件本身）不在 dead
    const row1 = html.slice(0, html.indexOf('data-seq="2"'))
    expect(row1).toContain('data-dead="false"')
    expect(html).not.toContain('data-seq="3"')
  })
})
