/** PRD-M14-003 / PRD-M14-005 / PRD-M14-008 / PRD-M14-010 · 右侧栏协议契约（SPEC-M14-003 取舍-6 · SPEC-M14-008 取舍-2 · SPEC-M14-010 取舍-2） */
import { describe, expect, test } from 'bun:test'
import { METHODS } from '../src/index.ts'

describe('PRD-M14-003 AC-3 · checkpoint.diff', () => {
  test('params：sessionId 必填，fromSeq/toSeq/path 可选', () => {
    const p = METHODS['checkpoint.diff'].params
    expect(p.safeParse({ sessionId: 's' }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', fromSeq: 10, toSeq: 20 }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', fromSeq: 0, toSeq: 5, path: 'a.ts' }).success).toBe(true)
    expect(p.safeParse({}).success).toBe(false)
    expect(p.safeParse({ sessionId: 's', fromSeq: -1 }).success).toBe(false)
  })

  test('result：available + files（与 worktree.diff 同形）；降级 available:false + reason', () => {
    const r = METHODS['checkpoint.diff'].result
    const ok = {
      available: true,
      files: [{ path: 'a.ts', status: 'modified', patch: 'diff', truncated: false }],
    }
    expect(r.safeParse(ok).success).toBe(true)
    const degraded = { available: false, reason: 'git 没装', files: [] }
    expect(r.safeParse(degraded).success).toBe(true)
    expect(r.safeParse({ available: true, files: [{ path: 'a', status: 'rewritten', patch: '' }] }).success).toBe(false)
  })
})

describe('PRD-M14-005 AC-7 · checkpoint.discard / checkpoint.discard.undo', () => {
  test('discard：path + fromSeq/toSeq；回 eventSeq', () => {
    const p = METHODS['checkpoint.discard'].params
    expect(p.safeParse({ sessionId: 's', path: 'a.ts', fromSeq: 10, toSeq: 20 }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', path: 'a.ts' }).success).toBe(false)
    expect(METHODS['checkpoint.discard'].result.safeParse({ ok: true, eventSeq: 5 }).success).toBe(true)
  })

  test('undo：按 eventSeq；回 path', () => {
    expect(METHODS['checkpoint.discard.undo'].params.safeParse({ sessionId: 's', eventSeq: 5 }).success).toBe(true)
    expect(METHODS['checkpoint.discard.undo'].result.safeParse({ ok: true, path: 'a.ts' }).success).toBe(true)
    expect(METHODS['checkpoint.discard.undo'].params.safeParse({ sessionId: 's' }).success).toBe(false)
  })
})

describe('PRD-M14-008 AC-3 · session.submit.refs 可含文件行引用', () => {
  test('refs 同时收 RefLink 与 FileRef；非法行号拒绝', () => {
    const p = METHODS['session.submit'].params
    const base = { sessionId: 's', text: 'hi' }
    expect(p.safeParse({ ...base, refs: [{ sessionId: 'other', fromSeq: 1, toSeq: 5 }] }).success).toBe(true)
    expect(p.safeParse({ ...base, refs: [{ kind: 'file', path: 'a.ts', lineStart: 1, lineEnd: 3 }] }).success).toBe(
      true,
    )
    expect(
      p.safeParse({
        ...base,
        refs: [{ kind: 'file', path: 'a.ts', lineStart: 2, lineEnd: 5, side: 'new', text: '这里要改' }],
      }).success,
    ).toBe(true)
    expect(p.safeParse({ ...base, refs: [{ kind: 'file', path: 'a.ts', lineStart: 0, lineEnd: 3 }] }).success).toBe(
      false,
    )
    expect(p.safeParse({ ...base, refs: [{ kind: 'file', path: 'a.ts', lineStart: 5, lineEnd: 2 }] }).success).toBe(
      false,
    )
    expect(p.safeParse({ ...base, refs: [{ kind: 'chat', id: 'x' }] }).success).toBe(false)
    expect(
      p.safeParse({
        ...base,
        refs: [
          { sessionId: 'o', fromSeq: 1, toSeq: 5 },
          { kind: 'file', path: 'b', lineStart: 1, lineEnd: 1 },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('PRD-M14-010 AC-1 · session.revertTo', () => {
  test('params：toSeq + scope；result 带 snapshotId / undoSnapshotId（可空）', () => {
    const p = METHODS['session.revertTo'].params
    expect(p.safeParse({ sessionId: 's', toSeq: 42, scope: 'both' }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', toSeq: 42, scope: 'conversation' }).success).toBe(true)
    expect(p.safeParse({ sessionId: 's', toSeq: 0, scope: 'both' }).success).toBe(false)
    expect(p.safeParse({ sessionId: 's', toSeq: 42, scope: 'all' }).success).toBe(false)
    const r = METHODS['session.revertTo'].result
    expect(r.safeParse({ ok: true, snapshotId: 'x', undoSnapshotId: 'y' }).success).toBe(true)
    expect(r.safeParse({ ok: true, snapshotId: null, undoSnapshotId: null }).success).toBe(true)
  })
})

describe('PRD-M14-006 AC-5 · session.context', () => {
  test('result：trusted/rules/skillsTotal/mcp/context', () => {
    const r = METHODS['session.context'].result
    expect(
      r.safeParse({
        trusted: true,
        rules: ['/repo/AGENTS.md'],
        skillsTotal: 12,
        mcp: [{ server: 'github', tools: ['mcp.github.create_issue'] }],
        context: { strategy: 'compact', thresholdPercent: 70 },
        pending: { soul: false, rules: false, catalog: false, skills: false },
      }).success,
    ).toBe(true)
    expect(
      r.safeParse({
        trusted: null,
        rules: [],
        skillsTotal: 0,
        mcp: [],
        context: { strategy: 'full', thresholdPercent: null },
        pending: { soul: false, rules: false, catalog: false, skills: true },
      }).success,
    ).toBe(true)
    expect(r.safeParse({ trusted: true }).success).toBe(false)
  })
})
