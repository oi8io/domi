/**
 * PRD-M14-007（SPEC-M14-007）· 产物 tab 投影
 * - 新建（net diff added 且当前仍在）→ 产物；后被删不算；renamed 归新路径
 * - 附件「你给的」单列；无快照降级（fs.snapshot 推断）
 * - 产生于哪一步：首次 fs.snapshot{after, sha≠null} 的 seq；shell 创建（无 snapshot）兜底 user.input seq 标「约」
 */
import { describe, expect, test } from 'bun:test'
import { artifactsView } from '../src/artifacts.ts'
import type { CheckpointDiffResult } from '../src/changes.ts'

const env = (seq: number, ts: number, ev: Record<string, unknown>) => ({
  seq,
  sessionId: 'a1',
  parentSeq: seq > 1 ? seq - 1 : null,
  ts,
  schemaVersion: 16,
  ev: ev as never,
})
const okDiff = (files: CheckpointDiffResult['files']): CheckpointDiffResult => ({
  available: true,
  files,
})
const noDiff = (): CheckpointDiffResult => ({ available: false, files: [] })

describe('artifactsView · 新建 / 后被删 / 被改名 / 附件 / 降级', () => {
  test('AC-1 · added + renamed 归产物（新路径）；modified 不算；deleted 不算（net diff 语义）', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: '做吧' }),
      env(2, 2000, { t: 'fs.snapshot', path: 'src/new.ts', phase: 'before', sha256: null, bytes: 0 }),
      env(3, 3000, { t: 'fs.snapshot', path: 'src/new.ts', phase: 'after', sha256: 'a', bytes: 120 }),
    ]
    const v = artifactsView(
      evs,
      okDiff([
        { path: 'src/new.ts', status: 'added', patch: '' },
        { path: 'old.ts', status: 'renamed', patch: '' },
        { path: 'src/touched.ts', status: 'modified', patch: '' },
        { path: 'gone.ts', status: 'deleted', patch: '' },
      ]),
    )
    expect(v.degraded).toBe(false)
    const paths = v.files.map((f) => f.path)
    expect(paths).toContain('src/new.ts')
    expect(paths).toContain('old.ts')
    expect(paths).not.toContain('src/touched.ts')
    expect(paths).not.toContain('gone.ts')
  })

  test('AC-2 · 产生于哪一步：首次 fs.snapshot{after, sha≠null} 的 seq + 大小', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: '做吧' }),
      env(2, 2000, { t: 'fs.snapshot', path: 'a.ts', phase: 'before', sha256: null, bytes: 0 }),
      env(3, 3000, { t: 'fs.snapshot', path: 'a.ts', phase: 'after', sha256: 'x', bytes: 42 }),
    ]
    const v = artifactsView(evs, okDiff([{ path: 'a.ts', status: 'added', patch: '' }]))
    const a = v.files.find((f) => f.path === 'a.ts')!
    expect(a.seq).toBe(3)
    expect(a.size).toBe(42)
    expect(a.approx).toBe(false)
  })

  test('AC-2 · shell 创建（无 fs.snapshot）→ 兜底最近一次 user.input 的 seq，标「约」', () => {
    const evs = [
      env(1, 1000, { t: 'user.input', text: '初始化' }),
      env(2, 2000, { t: 'tool.call', id: 't1', name: 'shell.exec', args: { command: 'touch out.txt' } }),
      env(3, 3000, { t: 'user.input', text: '再写' }),
      env(4, 4000, { t: 'tool.call', id: 't2', name: 'shell.exec', args: { command: 'echo x > out.txt' } }),
    ]
    const v = artifactsView(evs, okDiff([{ path: 'out.txt', status: 'added', patch: '' }]))
    const a = v.files.find((f) => f.path === 'out.txt')!
    expect(a.approx).toBe(true)
    // 兜底 = 产生它的那一轮起点（最后一个 ≤ 文件最后一次相关活动的 user.input）；无快照线索 → 会话最后一个 user.input
    expect(a.seq).toBe(3)
  })

  test('AC-1 · 附件「你给的」单列：UploadRef 名称 / 类型 / 大小', () => {
    const evs = [
      env(1, 1000, {
        t: 'user.input',
        text: '看图',
        uploads: [
          { id: 'u1', name: '设计.png', mime: 'image/png', size: 2048 },
          { id: 'u2', name: '清单.csv', mime: 'text/csv', size: 512 },
        ],
      }),
    ]
    const v = artifactsView(evs, noDiff())
    expect(v.uploads.map((u) => u.path)).toEqual(['设计.png', '清单.csv'])
    expect(v.uploads[0]!.size).toBe(2048)
    expect(v.uploads[0]!.seq).toBe(1)
  })

  test('AC-1 · 无 checkpoint.diff → 降级：fs.snapshot{after, sha≠null} 推断，标 degraded', () => {
    const evs = [
      env(1, 1000, { t: 'fs.snapshot', path: 'a.ts', phase: 'after', sha256: 'x', bytes: 10 }),
      env(2, 2000, { t: 'fs.snapshot', path: 'a.ts', phase: 'after', sha256: 'x', bytes: 10 }),
      env(3, 3000, { t: 'fs.snapshot', path: 'b.txt', phase: 'before', sha256: null, bytes: 0 }),
      env(4, 4000, { t: 'fs.snapshot', path: 'b.txt', phase: 'after', sha256: 'y', bytes: 5 }),
    ]
    const v = artifactsView(evs, noDiff())
    expect(v.degraded).toBe(true)
    const paths = v.files.map((f) => f.path)
    expect(paths).toEqual(['a.ts', 'b.txt'])
    expect(v.files.find((f) => f.path === 'a.ts')!.size).toBe(10)
  })

  test('AC-6 · 会话转任务产物不丢：同一事件流投影与会话类型无关（事件投影回归）', () => {
    const evs = [env(1, 1000, { t: 'fs.snapshot', path: 'x.md', phase: 'after', sha256: 'z', bytes: 7 })]
    const v = artifactsView(evs, okDiff([{ path: 'x.md', status: 'added', patch: '' }]))
    expect(v.files.map((f) => f.path)).toEqual(['x.md'])
  })
})
