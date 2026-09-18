/**
 * 自由会话与任务 —— PRD-M8-004 AC-1 / AC-7 / AC-3
 *
 * AC-7 是 Invariant（INV-03）：自由会话的文件工具只能碰沙盒里的路径，
 * `shell.exec` 即使规则放行也每次问人。这里用 StubProvider 让模型去调这些工具，断言真实行为。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import type { EventEnvelope } from '@domi/protocol'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-kind-'))
  dirs.push(d)
  return d
}

const config = ConfigSchema.parse({
  model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
  // 规则明确放行：AC-7 要的就是「放行了也照样问」
  permissions: { rules: [{ name: 'allow-shell', capability: 'shell.exec', decision: 'allow' }] },
})

interface Ran {
  session: DomiSession
  asks: PendingAsk[]
  events: () => Promise<EventEnvelope[]>
}

function open(opts: { cwd: string; dbDir: string; chat: boolean; provider: StubProvider }): Ran {
  const asks: PendingAsk[] = []
  const s = new DomiSession({
    config,
    sessionId: 's-1',
    cwd: opts.cwd,
    dbPath: join(opts.dbDir, 'events.db'),
    provider: opts.provider,
    ...(opts.chat ? { projectContext: false, askAlways: ['shell.exec'] } : {}),
  })
  s.on('onAsk', (ask) => {
    if (ask) asks.push(ask)
  })
  return { session: s, asks, events: () => s.pumpAll() }
}

describe('PRD-M8-004 AC-7 · 自由会话：沙盒外的文件访问被拒，shell.exec 每次问', () => {
  test('沙盒外的写被拒绝（和任务越出项目目录是同一套路径收口）', async () => {
    const home = tmp()
    const sandbox = tmp()
    const outside = join(tmp(), 'secret.txt')
    writeFileSync(outside, '别人的文件')
    const provider = new StubProvider(
      [
        [{ type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: outside, content: 'x' } }],
        [{ type: 'delta', text: '写不了' }],
      ],
      { onExhausted: 'repeat-last' },
    )
    const r = open({ cwd: sandbox, dbDir: home, chat: true, provider })
    await r.session.submit('把那个文件改了')
    const events = await r.events()
    const result = events.find((e) => e.ev.t === 'tool.result')?.ev as { ok?: boolean } | undefined
    expect(result?.ok).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('别人的文件')
    await r.session.flushAndClose()
  })

  test('规则 allow 的 shell.exec 在自由会话里仍然弹询问；答应之后在沙盒里执行', async () => {
    const home = tmp()
    const sandbox = tmp()
    const provider = new StubProvider(
      [
        [{ type: 'tool-call', id: 'c1', name: 'shell.exec', args: { cmd: 'echo hi > out.txt' } }],
        [{ type: 'delta', text: '跑完了' }],
      ],
      { onExhausted: 'repeat-last' },
    )
    const r = open({ cwd: sandbox, dbDir: home, chat: true, provider })
    const done = r.session.submit('跑一下')
    for (let i = 0; i < 200 && r.asks.length === 0; i++) await Bun.sleep(5)
    expect(r.asks[0]?.capabilityId).toBe('shell.exec')
    r.asks[0]?.answer(true)
    await done
    expect(existsSync(join(sandbox, 'out.txt'))).toBe(true)
    const events = await r.events()
    const perm = events.filter((e) => e.ev.t === 'permission').map((e) => e.ev as { decision: string; source: string })
    expect(perm.some((p) => p.decision === 'allow' && p.source === 'user')).toBe(true)
    await r.session.flushAndClose()
  })

  test('任务里同一条规则不问（AC-3：任务的行为与 M7 一致）', async () => {
    const home = tmp()
    const repo = tmp()
    const provider = new StubProvider(
      [
        [{ type: 'tool-call', id: 'c1', name: 'shell.exec', args: { cmd: 'echo hi > out.txt' } }],
        [{ type: 'delta', text: '跑完了' }],
      ],
      { onExhausted: 'repeat-last' },
    )
    const r = open({ cwd: repo, dbDir: home, chat: false, provider })
    await r.session.submit('跑一下')
    expect(r.asks).toHaveLength(0)
    expect(existsSync(join(repo, 'out.txt'))).toBe(true)
    await r.session.flushAndClose()
  })
})

describe('PRD-M8-004 AC-1 · 会话有 kind，任务必属于一个项目', () => {
  test('kind 是 session.kind 事件，不是另一张表（宿主写，runtime 只管行为）', async () => {
    const { SCHEMA_VERSION, parseEvent } = await import('@domi/protocol')
    const ev = parseEvent(
      { t: 'session.kind', kind: 'task', cwd: '/repo', isolation: { isolate: false, reason: 'clean' } },
      SCHEMA_VERSION,
    )
    expect(ev).toMatchObject({ t: 'session.kind', kind: 'task' })
    const chat = parseEvent({ t: 'session.kind', kind: 'chat', cwd: '/scratch/s-1' }, SCHEMA_VERSION)
    expect(chat).toMatchObject({ t: 'session.kind', kind: 'chat' })
  })
})
