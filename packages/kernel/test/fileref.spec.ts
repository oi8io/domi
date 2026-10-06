/**
 * SPEC-M14-008 · diff 行评论的文件行引用（PRD-M14-008 AC-3）
 * - runTurn 带 FileRef → 紧挨 user.input 落 ctx.fileref（事件只存引用、行号、片段与评论文字）
 * - buildContext 把 ctx.fileref 渲染成 `[引用文件] path:l1-l2（新侧/旧侧）` + 代码块 + 评论文字
 * - paginate 给 ctx.fileref 计行、不切轮
 * - 旧 RefLink 引用回归（ctx.ref 仍照旧）
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StubProvider } from '@domi/model'
import type { DomiEvent, EventEnvelope, FileRef, RefLink } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import { buildContext, type ContextPolicy, paginateByTurns, runTurn, weightLines } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function envs(sessionId: string, evs: DomiEvent[]): EventEnvelope[] {
  return evs.map((ev, i) => ({ seq: i + 1, sessionId, parentSeq: i === 0 ? null : i, ts: 0, schemaVersion: 16, ev }))
}

const POLICY: ContextPolicy = { maxTokens: 100_000, includeReasoning: false }

const fileRef: FileRef = {
  kind: 'file',
  path: 'src/a.ts',
  lineStart: 3,
  lineEnd: 4,
  side: 'new',
  snippet: '  const x = 1\n  const y = 2',
  text: '这里抽个函数',
}

test('AC-3 · buildContext：ctx.fileref 渲染成 [引用文件] path:l1-l2（新侧）+ 代码块 + 评论文字', () => {
  const b = envs('B', [
    {
      t: 'ctx.fileref',
      path: fileRef.path,
      lineStart: 3,
      lineEnd: 4,
      side: 'new',
      snippet: fileRef.snippet,
      text: fileRef.text,
    },
    { t: 'user.input', text: '照这个改' },
  ])
  const msgs = buildContext(b, POLICY)
  expect(msgs).toHaveLength(1)
  const content = (msgs[0] as { role: string; content: string }).content
  expect(content).toContain('[引用文件] src/a.ts:3-4（新侧）')
  expect(content).toContain('```')
  expect(content).toContain('const x = 1')
  expect(content).toContain('这里抽个函数')
})

test('AC-3 · 旧侧标注；无 snippet / 无文字时省略对应块', () => {
  const b = envs('B', [
    { t: 'ctx.fileref', path: 'old.ts', lineStart: 1, lineEnd: 2, side: 'old' },
    { t: 'user.input', text: 'x' },
  ])
  const content = (buildContext(b, POLICY)[0] as { content: string }).content
  expect(content).toContain('[引用文件] old.ts:1-2（旧侧）')
  expect(content).not.toContain('```')
})

test('AC-3 · runTurn 带 FileRef：紧挨 user.input 落 ctx.fileref（先 fileref 后 user.input）', async () => {
  const d = mkdtempSync(join(tmpdir(), 'domi-fileref-'))
  dirs.push(d)
  const sink = new SqliteEventLog({ path: join(d, 'e.db') })
  const provider = new StubProvider([]) // 空 turns：第一轮就直接结束
  await runTurn(
    {
      sink,
      provider: provider as never,
      tools: { schemas: () => [], run: async () => ({ ok: true, payload: {} }) },
      clock: { now: () => 1_000 },
      policy: POLICY,
      model: 'm',
    },
    's',
    { text: '改这里', refs: [fileRef] },
  )
  const evs = await sink.read('s')
  const ts = evs.map((e) => e.ev.t).slice(0, 2)
  expect(ts).toEqual(['ctx.fileref', 'user.input'])
  const fr = evs[0]!.ev as { path: string; lineStart: number; lineEnd: number; snippet?: string; text?: string }
  expect(fr.path).toBe('src/a.ts')
  expect(fr.lineStart).toBe(3)
  expect(fr.lineEnd).toBe(4)
  expect(fr.snippet).toBe(fileRef.snippet)
  expect(fr.text).toBe('这里抽个函数')
  sink.close()
})

test('AC-3 · 旧 RefLink 引用回归：ctx.ref 照旧落在 user.input 前', async () => {
  const d = mkdtempSync(join(tmpdir(), 'domi-ref-'))
  dirs.push(d)
  const sink = new SqliteEventLog({ path: join(d, 'e.db') })
  const provider = new StubProvider([])
  const link: RefLink = { sessionId: 'A', fromSeq: 1, toSeq: 2 }
  await runTurn(
    {
      sink,
      provider: provider as never,
      tools: { schemas: () => [], run: async () => ({ ok: true, payload: {} }) },
      clock: { now: () => 1_000 },
      policy: POLICY,
      model: 'm',
      refs: { resolve: async () => [] },
    },
    's',
    { text: '引用', refs: [link] },
  )
  const evs = await sink.read('s')
  const ts = evs.map((e) => e.ev.t).slice(0, 2)
  expect(ts).toEqual(['ctx.ref', 'user.input'])
  sink.close()
})

test('AC-3 · paginate：ctx.fileref 计行（权重 ≥2）、不切轮（整轮返回）', () => {
  const evs = envs('S', [
    { t: 'ctx.fileref', path: 'a.ts', lineStart: 1, lineEnd: 2, snippet: 'xxxx'.repeat(20), text: '评' },
    { t: 'user.input', text: '改' },
  ])
  expect(weightLines({ t: 'ctx.fileref', path: 'a', lineStart: 1, lineEnd: 1, snippet: 'abc' })).toBeGreaterThanOrEqual(
    2,
  )
  const page = paginateByTurns(evs, { budget: { maxLines: 100 } })
  // 预算足够：ctx.fileref 与 user.input 都在同一页（整轮返回，不切轮、不丢引用）
  expect(page.events.length).toBe(2)
  expect(page.events.map((e) => e.ev.t)).toEqual(['ctx.fileref', 'user.input'])
})
