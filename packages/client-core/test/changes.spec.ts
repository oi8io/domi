/**
 * M14 改动 tab 投影 —— PRD-M14-005（SPEC-M14-005）
 *
 * 全部纯函数：范围换算 / 降级回退 / 选中保持 / 实时标记 / 词级 diff / patch 统计 / 折叠规则。
 * Web 与 TUI 共用这一份（009 复用，parity 关键）。
 */
import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@domi/protocol'
import { PROTOCOL_VERSION } from '@domi/protocol'
import { isGeneratedPath, isImagePath } from '../src/changes.ts'
import {
  changesRangeSeq,
  changesView,
  createSessionStore,
  DomiClient,
  fsSnapshotNames,
  inspectorDefault,
  keepSelection,
  lastUserInputSeq,
  patchStats,
  shouldFold,
  staleFiles,
  type WireSocket,
  wordDiff,
} from '../src/index.ts'

let seq = 0
const T0 = 1_700_000_000_000
const env = (ev: Record<string, unknown>, s?: number): EventEnvelope => {
  seq = s ?? seq + 1
  return { seq, sessionId: 's', parentSeq: seq > 1 ? seq - 1 : null, ts: T0 + seq, schemaVersion: 16, ev: ev as never }
}

function sampleEvents() {
  seq = 0
  return [
    env({ t: 'user.input', text: '第一轮' }),
    env({ t: 'fs.checkpoint', phase: 'baseline', toolCallId: 'w1', id: 'a1', files: 0, ok: true }),
    env({ t: 'fs.snapshot', path: 'src/a.ts', phase: 'before', sha256: null, bytes: 0 }),
    env({ t: 'fs.snapshot', path: 'src/a.ts', phase: 'after', sha256: 'x', bytes: 10 }),
    env({ t: 'fs.checkpoint', phase: 'after', toolCallId: 'w1', id: 'a2', files: 1, ok: true }),
    env({ t: 'user.input', text: '第二轮' }),
    env({ t: 'fs.checkpoint', phase: 'baseline', toolCallId: 'w2', id: 'b1', files: 1, ok: true }),
    env({ t: 'fs.snapshot', path: 'src/b.ts', phase: 'after', sha256: 'y', bytes: 20 }),
    env({ t: 'fs.checkpoint', phase: 'after', toolCallId: 'w2', id: 'b2', files: 1, ok: true }),
  ]
}

const DIFF_OK: Awaited<ReturnType<DomiClient['checkpointDiff']>> = {
  available: true,
  files: [
    { path: 'src/a.ts', status: 'modified', patch: '-old\n+new\n' },
    { path: 'src/b.ts', status: 'added', patch: '+b\n' },
  ],
}

describe('changesRangeSeq · 范围换算（SPEC-M14-005 取舍-1）', () => {
  test('本轮 = 最后一个 user.input 起；整个会话 = 1..head', () => {
    const evs = sampleEvents()
    const head = 9
    const turn = changesRangeSeq(evs, 'turn', head)
    expect(turn).toEqual({ fromSeq: 6, toSeq: 9 })
    const session = changesRangeSeq(evs, 'session', head)
    expect(session).toEqual({ fromSeq: 1, toSeq: 9 })
  })

  test('某一步 = 传入的步区间；baseline 不产生 checkpoint 范围（走 worktree.diff）', () => {
    const evs = sampleEvents()
    const step = changesRangeSeq(evs, { step: 's1' }, 9, { s1: { startSeq: 6, endSeq: 8 } })
    expect(step).toEqual({ fromSeq: 6, toSeq: 8 })
    expect(changesRangeSeq(evs, 'baseline', 9)).toBeNull()
  })

  test('没有 user.input / 步区间缺失 → 稳妥降级（不抛）', () => {
    const head = 9
    expect(changesRangeSeq([], 'turn', head)).toEqual({ fromSeq: 1, toSeq: 9 })
    expect(changesRangeSeq([], { step: 'x' }, head, {})).toBeNull()
  })
})

describe('lastUserInputSeq', () => {
  test('最后一个 ≤ atSeq 的 user.input 的 seq', () => {
    expect(lastUserInputSeq(sampleEvents(), 9)).toBe(6)
    expect(lastUserInputSeq(sampleEvents(), 5)).toBe(1)
    expect(lastUserInputSeq([], 9)).toBeNull()
  })
})

describe('fsSnapshotNames · 降级回退数据', () => {
  test('该范围内 fs.snapshot 出现过的路径，去重', () => {
    const evs = sampleEvents()
    expect(fsSnapshotNames(evs, 1, 9)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(fsSnapshotNames(evs, 6, 9)).toEqual(['src/b.ts'])
  })
})

describe('changesView · 数据源与降级（取舍-1 / 取舍-4）', () => {
  test('available 时用 checkpoint.diff 的文件列表，并算出 +N −M', () => {
    const v = changesView(sampleEvents(), DIFF_OK, 'session', 9)
    expect(v.available).toBe(true)
    expect(v.files).toHaveLength(2)
    expect(v.files[0]).toMatchObject({ path: 'src/a.ts', status: 'modified', added: 1, removed: 1 })
    expect(v.files[1]).toMatchObject({ path: 'src/b.ts', status: 'added', added: 1, removed: 0 })
  })

  test('降级（available:false / 无 diff）→ 回退列 fs.snapshot 文件名（无 diff 内容）', () => {
    const v = changesView(sampleEvents(), { available: false, reason: '这一步没有快照', files: [] }, 'turn', 9)
    expect(v.available).toBe(false)
    expect(v.reason).toBe('这一步没有快照')
    expect(v.fallbackNames).toEqual(['src/b.ts'])
    // 完全没有 diff 数据也一样不炸
    const v2 = changesView(sampleEvents(), null, 'session', 9)
    expect(v2.available).toBe(false)
    expect(v2.fallbackNames).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('keepSelection / staleFiles · 切换不丢选中、实时标记（AC-1 / AC-6）', () => {
  const prev = DIFF_OK.files
  test('新范围还有该文件 → 保持；没有 → 回列表', () => {
    expect(keepSelection(prev, prev, 'src/a.ts')).toBe('src/a.ts')
    expect(keepSelection(prev, [{ path: 'src/b.ts', status: 'added', patch: '+b\n' }], 'src/a.ts')).toBeNull()
  })

  test('正在看的文件有新改动 → 标 stale（不自动替换）', () => {
    const next = [
      { path: 'src/a.ts', status: 'modified', patch: '-old\n-new2\n+new\n' },
      { path: 'src/b.ts', status: 'added', patch: '+b\n' },
    ]
    expect(staleFiles(prev, next, 'src/a.ts')).toEqual(['src/a.ts'])
    expect(staleFiles(prev, next, 'src/b.ts')).toEqual([])
  })
})

describe('wordDiff · 词级高亮（AC-2）', () => {
  test('改一个词 → 只有那个词标 del/add，其余 same（相邻 same 合并成一个 span）', () => {
    const d = wordDiff('const a = 1', 'const a = 2')
    expect(d.old).toEqual([
      { text: 'const a = ', kind: 'same' },
      { text: '1', kind: 'del' },
    ])
    expect(d.add).toEqual([
      { text: 'const a = ', kind: 'same' },
      { text: '2', kind: 'add' },
    ])
    // 词级而非整行：same 段还在
    expect(d.old.some((t) => t.kind === 'same' && t.text.includes('const'))).toBe(true)
  })

  test('中文按字、空白与标点各自成 token；完全不同的行 → 全 del / 全 add', () => {
    const d = wordDiff('你好世界', '你好宇宙')
    expect(d.old).toEqual([
      { text: '你好', kind: 'same' },
      { text: '世界', kind: 'del' },
    ])
    expect(d.add).toEqual([
      { text: '你好', kind: 'same' },
      { text: '宇宙', kind: 'add' },
    ])
    const d2 = wordDiff('a', 'b')
    expect(d2.old).toEqual([{ text: 'a', kind: 'del' }])
    expect(d2.add).toEqual([{ text: 'b', kind: 'add' }])
  })

  test('相同行 → 全是 same；空串不炸', () => {
    const d = wordDiff('hello', 'hello')
    expect(d.old.every((t) => t.kind === 'same')).toBe(true)
    expect(d.add.every((t) => t.kind === 'same')).toBe(true)
    expect(wordDiff('', '').old).toEqual([])
    expect(wordDiff('', 'x').add).toEqual([{ text: 'x', kind: 'add' }])
  })
})

describe('patchStats · +N −M', () => {
  test('数内容行（不算 +++ / --- 头）', () => {
    expect(patchStats('--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n')).toEqual({ added: 1, removed: 1 })
    expect(patchStats('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('折叠规则（AC-5）', () => {
  test('锁文件 / 生成文件 / 大 patch / 二进制（patch 空）默认折叠', () => {
    expect(isGeneratedPath('pnpm-lock.yaml')).toBe(true)
    expect(isGeneratedPath('dist/out.js')).toBe(true)
    expect(isGeneratedPath('src/a.ts')).toBe(false)
    expect(shouldFold({ path: 'src/big.ts', patch: 'x'.repeat(100_001) })).toBe(true)
    expect(shouldFold({ path: 'src/bin', patch: '' })).toBe(true)
    expect(shouldFold({ path: 'src/a.ts', patch: '-old\n+new\n' })).toBe(false)
  })

  test('图片不折叠（前后对照渲染）', () => {
    expect(isImagePath('img/logo.png')).toBe(true)
    expect(isImagePath('src/a.ts')).toBe(false)
    expect(shouldFold({ path: 'img/logo.png', patch: '' })).toBe(false)
  })
})

describe('store 扩展：$events 原始事件 + $inspector（SPEC-M14-001 取舍-3）', () => {
  test('applyEvents 同步维护 $events；$inspector 默认按会话类型（task 开 progress / chat 关 changes）', () => {
    const s = createSessionStore()
    s.applyEvents(sampleEvents())
    expect(s.$events.get()).toHaveLength(9)
    expect(s.$events.get()[0]?.ev).toMatchObject({ t: 'user.input' })
    expect(inspectorDefault('task')).toMatchObject({ open: true, tab: 'progress' })
    expect(inspectorDefault('chat')).toMatchObject({ open: false, tab: 'changes' })
    expect(inspectorDefault(undefined)).toMatchObject({ open: false })
  })

  test('prependEvents 把更早的事件插到 $events 头部（与 $items 同窗口）', () => {
    const s = createSessionStore()
    s.applyEvents(sampleEvents())
    s.prependEvents([env({ t: 'user.input', text: '更早' }, 0)])
    expect(s.$events.get()[0]?.seq).toBe(0)
    expect(s.$events.get()).toHaveLength(10)
  })

  test('setInspector 部分更新', () => {
    const s = createSessionStore()
    s.setInspector({ tab: 'changes', changesRange: 'session' })
    expect(s.$inspector.get()).toMatchObject({ tab: 'changes', changesRange: 'session' })
  })
})

describe('client：checkpoint 三个 RPC 的请求形状', () => {
  type Listener = (ev: { data: unknown }) => void
  type Req = { id: number; method: string; params: Record<string, unknown> }
  class FakeSocket implements WireSocket {
    readyState = 0
    readonly sent: Req[] = []
    private readonly on: Record<string, Listener[]> = {}
    constructor(private readonly reply: (req: Req, sock: FakeSocket) => unknown) {
      queueMicrotask(() => {
        this.readyState = 1
        for (const l of this.on.open ?? []) l({ data: undefined } as never)
      })
    }
    addEventListener(type: 'open' | 'close' | 'error', fn: () => void): void
    addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void
    addEventListener(type: 'open' | 'close' | 'error' | 'message', fn: Listener): void {
      const arr = this.on[type] ?? []
      this.on[type] = [...arr, fn as Listener]
    }
    send(data: string): void {
      const req = JSON.parse(data) as Req
      this.sent.push(req)
      queueMicrotask(() => {
        for (const l of this.on.message ?? [])
          l({ data: JSON.stringify({ id: req.id, result: this.reply(req, this) }) })
      })
    }
    close(): void {}
  }

  const okHandshake = { protocolVersion: PROTOCOL_VERSION, serverVersion: 't', methods: [] }
  const start = async (reply: (req: Req) => unknown): Promise<{ c: DomiClient; s: FakeSocket }> => {
    const s = new FakeSocket((req) => (req.method === 'handshake' ? okHandshake : reply(req)))
    const c = new DomiClient({ connect: () => s, clientName: 't', protocolVersion: PROTOCOL_VERSION })
    await c.start()
    return { c, s }
  }

  test('checkpointDiff 带 fromSeq/toSeq/path 可选', async () => {
    const { c, s } = await start(() => ({ available: true, files: [] }))
    await c.checkpointDiff('sid', { fromSeq: 3, toSeq: 9 })
    await c.checkpointDiff('sid', { fromSeq: 1, toSeq: 9, path: 'a.ts' })
    const calls = s.sent.filter((r) => r.method !== 'handshake')
    expect(calls.map((r) => r.params)).toEqual([
      { sessionId: 'sid', fromSeq: 3, toSeq: 9 },
      { sessionId: 'sid', fromSeq: 1, toSeq: 9, path: 'a.ts' },
    ])
  })

  test('checkpointDiscard / checkpointDiscardUndo 的形状', async () => {
    const { c, s } = await start((req) =>
      req.method === 'checkpoint.discard' ? { ok: true, eventSeq: 12 } : { ok: true },
    )
    await c.checkpointDiscard('sid', 'a.ts', 1, 9)
    await c.checkpointDiscardUndo('sid', 12)
    const calls = s.sent.filter((r) => r.method !== 'handshake')
    expect(calls.map((r) => r.method)).toEqual(['checkpoint.discard', 'checkpoint.discard.undo'])
    expect(calls[0]?.params).toEqual({ sessionId: 'sid', path: 'a.ts', fromSeq: 1, toSeq: 9 })
    expect(calls[1]?.params).toEqual({ sessionId: 'sid', eventSeq: 12 })
  })
})
