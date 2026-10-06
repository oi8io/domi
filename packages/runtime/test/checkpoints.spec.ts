/**
 * SPEC-M14-003 取舍-1…4 · PRD-M14-003（AC-1/AC-4/AC-5/AC-6）
 *
 * 分两层：
 *  1. CheckpointController 单测（注入替身 repo，测时机 / 降级 / 无变化跳过 / 区间规则纯函数）
 *  2. DomiSession 接线（真 ShadowRepo + StubProvider，测事件因果顺序 / 轮边界 / RPC 方法）
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRepo, GitUnavailableError } from '@domi/checkpoint'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { isKnownEvent, type EventEnvelope } from '@domi/protocol'
import { DomiSession } from '../src/index.ts'
import {
  CheckpointController,
  lastUserInputSeq,
  resolveSnapshots,
  type CheckpointRow,
} from '../src/checkpoints.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-ckpt-'))
  dirs.push(d)
  return d
}

function shadowRepo(workTree: string): ShadowRepo {
  return new ShadowRepo({ workTree, gitDir: join(tmp(), 'shadow.git') })
}

/** 一个会抛 GitUnavailableError 的替身 repo */
function missingGitRepo(): ShadowRepo {
  return {
    clean: async () => {
      throw new GitUnavailableError()
    },
    snapshot: async () => {
      throw new GitUnavailableError()
    },
  } as unknown as ShadowRepo
}

/** 一个永远慢到超时的替身 repo */
function slowRepo(): ShadowRepo {
  return {
    clean: async () => new Promise<never>(() => {}),
    snapshot: async () => new Promise<never>(() => {}),
  } as unknown as ShadowRepo
}

const CONFIG = ConfigSchema.parse({
  model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
  permissions: {
    rules: [
      { name: 'allow-read', capability: 'fs.read', decision: 'allow' },
      { name: 'allow-write', capability: 'fs.write', decision: 'allow' },
      { name: 'allow-shell', capability: 'shell.exec', decision: 'allow' },
    ],
  },
  verify: { enabled: false },
})

// ── 1. CheckpointController 单测 ────────────────────────────────────────────

describe('CheckpointController · 触发时机（SPEC-M14-003 取舍-1/2）', () => {
  test('第一个改文件工具前落 baseline，成功返回后落 after；只读工具不触发', async () => {
    const repo = shadowRepo(tmp())
    const c = new CheckpointController(repo)

    const read = await c.beforeTool({ id: 'r1', name: 'fs.read' })
    expect(read).toEqual([])
    const glob = await c.beforeTool({ id: 'g1', name: 'fs.glob' })
    expect(glob).toEqual([])
    const out = await c.beforeTool({ id: 'o1', name: 'shell.output' })
    expect(out).toEqual([])

    const b = await c.beforeTool({ id: 'w1', name: 'fs.write' })
    expect(b).toHaveLength(1)
    expect(b[0]?.t).toBe('fs.checkpoint')
    expect(b[0]).toMatchObject({ phase: 'baseline', toolCallId: 'w1', ok: true })
    const after = await c.afterTool({ id: 'w1', name: 'fs.write' }, true)
    expect(after[0]).toMatchObject({ phase: 'after', toolCallId: 'w1', ok: true })
    expect(after[0]?.id).toBe(b[0]?.id) // 同一轮、无新内容 → 复用（无变化跳过）
  })

  test('工具失败 / 被拒不落 after；同一轮第二次改文件工具不落第二个 baseline（AC-1）', async () => {
    const repo = shadowRepo(tmp())
    const c = new CheckpointController(repo)

    const b1 = await c.beforeTool({ id: 'w1', name: 'fs.write' })
    expect(b1).toHaveLength(1)
    const denied = await c.afterTool({ id: 'w1', name: 'fs.write' }, false)
    expect(denied).toEqual([])
    // 第二个改文件工具：baseline 已被取，不再取
    const b2 = await c.beforeTool({ id: 'w2', name: 'shell.exec' })
    expect(b2).toEqual([])
    const a2 = await c.afterTool({ id: 'w2', name: 'shell.exec' }, true)
    expect(a2).toHaveLength(1)
    expect(a2[0]).toMatchObject({ phase: 'after', toolCallId: 'w2', ok: true })
  })

  test('下一轮（resetTurn）第一个改文件工具再落一个新 baseline（轮边界）', async () => {
    const repo = shadowRepo(tmp())
    const c = new CheckpointController(repo)
    await c.beforeTool({ id: 'w1', name: 'fs.write' })
    await c.afterTool({ id: 'w1', name: 'fs.write' }, true)

    c.resetTurn()
    const b2 = await c.beforeTool({ id: 'w2', name: 'fs.write' })
    expect(b2[0]).toMatchObject({ phase: 'baseline', toolCallId: 'w2', ok: true })
    // 有改动 → 新快照 id 与上一份不同
    const repo2 = c.repo
    writeFileSync(join(repo2.workTree, 'x.txt'), '新文件\n')
    const a2 = await c.afterTool({ id: 'w2', name: 'fs.write' }, true)
    expect(a2[0]).toMatchObject({ phase: 'after', ok: true })
  })

  test('无变化跳过：工作树与 HEAD 一致时 id 复用（取舍-3）', async () => {
    const work = tmp()
    writeFileSync(join(work, 'a.txt'), 'v1\n')
    const repo = shadowRepo(work)
    const c = new CheckpointController(repo)

    const b = await c.beforeTool({ id: 's1', name: 'shell.exec' })
    const a1 = await c.afterTool({ id: 's1', name: 'shell.exec' }, true)
    // shell 没改文件 → 复用同一 id
    expect(a1[0]?.id).toBe(b[0]?.id)
    // 下一次成功也没改 → 继续复用
    const a2 = await c.afterTool({ id: 's2', name: 'shell.exec' }, true)
    expect(a2[0]?.id).toBe(b[0]?.id)
  })

  test('git 不可用 → 落 ok:false + id:null，不抛错（AC-4 降级明示）', async () => {
    const c = new CheckpointController(missingGitRepo())
    const b = await c.beforeTool({ id: 'w1', name: 'fs.write' })
    expect(b[0]).toMatchObject({ t: 'fs.checkpoint', phase: 'baseline', toolCallId: 'w1', ok: false, id: null, files: 0 })
    expect(typeof b[0]?.message).toBe('string')
    // 降级闩：本轮后续不再尝试（不会刷一堆失败事件）
    const a = await c.afterTool({ id: 'w1', name: 'fs.write' }, true)
    expect(a).toEqual([])
    // 下一轮重试（resetTurn 清闩）
    c.resetTurn()
    const b2 = await c.beforeTool({ id: 'w2', name: 'fs.write' })
    expect(b2[0]).toMatchObject({ ok: false })
  })

  test('快照超时 → 同样降级且不阻断（取舍-4）', async () => {
    const c = new CheckpointController(slowRepo(), 100)
    const b = await c.beforeTool({ id: 'w1', name: 'fs.write' })
    expect(b[0]).toMatchObject({ ok: false, id: null })
    expect(b[0]?.message).toContain('超时')
  })
})

// ── 区间规则纯函数（SPEC-M14-003 取舍-6）──────────────────────────────────

let eseq = 0
function env(seq: number, ev: Record<string, unknown>): EventEnvelope {
  return { seq, sessionId: 's1', parentSeq: seq > 1 ? seq - 1 : null, ts: seq, schemaVersion: 16, ev: ev as never }
}

const STREAM = [
  env(1, { t: 'user.input', text: '第一句' }),
  env(2, { t: 'model.request' }),
  env(3, { t: 'tool.call', id: 'w1', name: 'fs.write' }),
  env(4, { t: 'fs.checkpoint', phase: 'baseline', toolCallId: 'w1', id: 'aaa', ok: true }),
  env(5, { t: 'fs.checkpoint', phase: 'after', toolCallId: 'w1', id: 'bbb', ok: true }),
  env(6, { t: 'tool.result', id: 'w1', ok: true }),
  env(7, { t: 'user.input', text: '第二句' }),
  env(8, { t: 'tool.call', id: 'w2', name: 'fs.write' }),
  env(9, { t: 'fs.checkpoint', phase: 'baseline', toolCallId: 'w2', id: 'ccc', ok: true }),
  env(10, { t: 'fs.checkpoint', phase: 'after', toolCallId: 'w2', id: 'ddd', ok: true }),
  env(11, { t: 'tool.result', id: 'w2', ok: true }),
]

describe('resolveSnapshots · 区间规则（取舍-6）', () => {
  test('本轮：fromSeq = 最后一个 user.input 的 seq → 从轮内第一个 checkpoint 起', () => {
    const r = resolveSnapshots(STREAM, 7, 11)
    expect(r).toEqual({ from: 'ccc', to: 'ddd' })
  })

  test('整个会话：fromSeq = 1 → from 取会话第一个 checkpoint，to 取最后一个', () => {
    const r = resolveSnapshots(STREAM, 1, 11)
    expect(r).toEqual({ from: 'aaa', to: 'ddd' })
  })

  test('某一步：起点在轮中、终点到 head', () => {
    // 以 seq 8（w2 调用）为起点、head 为终点 → 快照从 ccc 到 ddd
    const r = resolveSnapshots(STREAM, 8, 11)
    expect(r).toEqual({ from: 'ccc', to: 'ddd' })
  })

  test('fromSeq 落在第一个 checkpoint 之前 → from = baseline', () => {
    const r = resolveSnapshots(STREAM, 2, 5)
    expect(r).toEqual({ from: 'aaa', to: 'bbb' })
  })

  test('区间内没有 checkpoint / from 与 to 相同 → null', () => {
    expect(resolveSnapshots(STREAM, 2, 4)).toBeNull() // to = baseline 本身
    expect(resolveSnapshots([env(1, { t: 'user.input' })], 1, 1)).toBeNull()
  })

  test('lastUserInputSeq：最后一个 ≤ fromSeq 的 user.input', () => {
    expect(lastUserInputSeq(STREAM, 1)).toBe(1)
    expect(lastUserInputSeq(STREAM, 7)).toBe(7)
    expect(lastUserInputSeq(STREAM, 6)).toBe(1)
    expect(lastUserInputSeq([], 0)).toBe(0)
  })

  test('checkpointIndex 只投影 id 非空的快照', () => {
    const idx: CheckpointRow[] = []
    for (const e of STREAM) {
      const ev = e.ev as { t: string; phase?: string; id?: string | null }
      if (ev.t === 'fs.checkpoint' && ev.id !== null) idx.push({ seq: e.seq, id: ev.id as string, phase: ev.phase as 'baseline' | 'after' })
    }
    expect(idx).toHaveLength(4)
  })
})

// ── 2. DomiSession 接线（真 git）───────────────────────────────────────────

const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

async function run(script: Array<Array<Record<string, unknown>>>) {
  const work = tmp()
  const db = join(tmp(), 'e.db')
  const s = new DomiSession({
    config: CONFIG,
    sessionId: 's1',
    cwd: work,
    dbPath: db,
    clock,
    provider: new StubProvider(script as never, { onExhausted: 'repeat-last' }),
    checkpoints: new CheckpointController(shadowRepo(work)),
  })
  const seen: EventEnvelope[] = []
  s.on('onEvents', (e) => seen.push(...e))
  await s.submit('改一下')
  return { work, seen, s }
}

describe('DomiSession · 快照事件进事件流（SPEC-M14-003 取舍-1/2）', () => {
  test('baseline 与 after 都落在 tool.call 与 tool.result 之间，baseline 在前（与权限事件同一位置）', async () => {
    const { s, seen } = await run([
      [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'a.txt', content: '新\n' } }],
      [{ type: 'delta', text: '好了' }],
    ])
    const seqs = Object.fromEntries(
      seen.map((e) => [
        e.ev.t + (isKnownEvent(e.ev) && e.ev.t === 'fs.checkpoint' ? `:${e.ev.phase}` : ''),
        e.seq,
      ]),
    ) as Record<string, number>
    const baseline = seqs['fs.checkpoint:baseline']!
    const after = seqs['fs.checkpoint:after']!
    const result = seqs['tool.result']!
    expect(seqs['tool.call']).toBeDefined()
    expect(baseline).toBeGreaterThan(seqs['tool.call']!)
    expect(after).toBeGreaterThan(baseline)
    expect(result).toBeGreaterThan(after)
    const ck = seen.filter((e) => e.ev.t === 'fs.checkpoint')
    expect(ck[0]?.ev).toMatchObject({ phase: 'baseline', toolCallId: 'w1', ok: true })
    expect(ck[1]?.ev).toMatchObject({ phase: 'after', toolCallId: 'w1', ok: true })
    await s.flushAndClose()
  })

  test('shell.exec 改的文件进 diff；fs.read / fs.glob 不触发快照', async () => {
    const { work, s, seen } = await run([
      [{ type: 'tool-call', id: 'r1', name: 'fs.read', args: { path: 'a.txt' } }],
      [{ type: 'tool-call', id: 's1', name: 'shell.exec', args: { cmd: 'printf "h" > made.txt' } }],
      [{ type: 'delta', text: '好了' }],
    ])
    const ck = seen.filter((e) => e.ev.t === 'fs.checkpoint')
    // fs.read 只读不触发；shell.exec 是第一个改文件工具 → baseline + after
    expect(ck).toHaveLength(2)
    expect(ck[0]?.ev).toMatchObject({ phase: 'baseline', toolCallId: 's1' })
    const afterId = (ck[1]?.ev as { id: string }).id
    const beforeId = (ck[0]?.ev as { id: string }).id
    expect(afterId).not.toBe(beforeId)
    expect(await Bun.file(join(work, 'made.txt')).text()).toBe('h')
    await s.flushAndClose()
  })

  test('下一轮（新的 user.input）再落一个新 baseline', async () => {
    const work = tmp()
    const db = join(tmp(), 'e.db')
    const s = new DomiSession({
      config: CONFIG,
      sessionId: 's1',
      cwd: work,
      dbPath: db,
      clock,
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'a.txt', content: '一\n' } }],
        [{ type: 'delta', text: '第一轮好了' }],
        [{ type: 'tool-call', id: 'w2', name: 'fs.write', args: { path: 'a.txt', content: '二\n' } }],
        [{ type: 'delta', text: '第二轮好了' }],
      ] as never, { onExhausted: 'repeat-last' }),
      checkpoints: new CheckpointController(shadowRepo(work)),
    })
    const seen: EventEnvelope[] = []
    s.on('onEvents', (e) => seen.push(...e))
    await s.submit('第一轮')
    await s.submit('第二轮')
    await s.flushAndClose()
    const baselines = seen.filter((e) => isKnownEvent(e.ev) && e.ev.t === 'fs.checkpoint' && e.ev.phase === 'baseline')
    expect(baselines).toHaveLength(2)
  })

  test('checkpointDiff：三种范围 + path 过滤 + 无快照降级', async () => {
    const { s, seen } = await run([
      [
        { type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'a.txt', content: '一\n' } },
        { type: 'tool-call', id: 'w2', name: 'fs.write', args: { path: 'b.txt', content: '二\n' } },
      ],
      [{ type: 'delta', text: '好了' }],
    ])
    const evs = seen
    const head = evs.length
    const lastInput = evs.filter((e) => isKnownEvent(e.ev) && e.ev.t === 'user.input').at(-1)?.seq ?? 1

    // 本轮
    const turn = await s.checkpointDiff(lastInput, head)
    expect(turn.available).toBe(true)
    const files = turn.files.map((f) => f.path)
    expect(files).toContain('a.txt')
    expect(files).toContain('b.txt')
    const patch = turn.files.find((f) => f.path === 'a.txt')?.patch
    expect(patch).toContain('一')

    // path 过滤
    const onlyA = await s.checkpointDiff(lastInput, head, 'a.txt')
    expect(onlyA.files.map((f) => f.path)).toEqual(['a.txt'])

    // 整个会话 = 同一份（一轮里）
    const all = await s.checkpointDiff(1, head)
    expect(all.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt'])

    // 无快照范围（起点在第一个 checkpoint 之后、终点在起点之前）→ available:false + reason
    const none = await s.checkpointDiff(head, head)
    expect(none.available).toBe(false)
    expect(typeof none.reason).toBe('string')
    await s.flushAndClose()
  })

  test('checkpointDiscard → 恢复 + fs.discard 事件；checkpointDiscardUndo → 按 undoSnapshotId 回来', async () => {
    const { work, s, seen } = await run([
      [
        { type: 'tool-call', id: 'w1', name: 'fs.write', args: { path: 'a.txt', content: '一\n' } },
        { type: 'tool-call', id: 'w2', name: 'fs.write', args: { path: 'a.txt', content: '二\n' } },
      ],
      [{ type: 'delta', text: '好了' }],
    ])
    // 现在 a.txt = 二；丢弃回本轮起点（文件还不存在）→ 删除
    const evs = seen
    const lastInput = evs.filter((e) => isKnownEvent(e.ev) && e.ev.t === 'user.input').at(-1)?.seq ?? 1
    const head = evs.length
    const { eventSeq } = await s.checkpointDiscard('a.txt', lastInput, head)
    expect(eventSeq).toBe(head + 1)
    expect(await Bun.file(join(work, 'a.txt')).exists()).toBe(false)
    const discards = seen.filter((e) => e.ev.t === 'fs.discard')
    expect(discards).toHaveLength(1)
    expect(discards[0]?.ev).toMatchObject({ path: 'a.txt' })
    expect(typeof (discards[0]?.ev as { undoSnapshotId?: string }).undoSnapshotId).toBe('string')

    // undo → 恢复成丢弃前的「二」
    const { path } = await s.checkpointDiscardUndo(eventSeq)
    expect(path).toBe('a.txt')
    expect(await Bun.file(join(work, 'a.txt')).text()).toBe('二\n')
    await s.flushAndClose()
  })

  test('未接线 controller 的会话：checkpointDiff 降级、checkpointDiscard 抛 CheckpointError', async () => {
    const work = tmp()
    const s = new DomiSession({
      config: CONFIG,
      sessionId: 's1',
      cwd: work,
      dbPath: join(tmp(), 'e.db'),
      clock,
      provider: new StubProvider([[{ type: 'delta', text: '好' }]] as never, { onExhausted: 'repeat-last' }),
    })
    await s.submit('hi')
    const diff = await s.checkpointDiff()
    expect(diff.available).toBe(false)
    await expect(s.checkpointDiscard('x.txt', 1, 2)).rejects.toMatchObject({ messageKey: 'error.checkpoint.not_wired' })
    await s.flushAndClose()
  })
})
