/**
 * ask.user 问题框 —— PRD-M12-004 AC-7 · SPEC-M12-004 第二轮 取舍-1
 *
 * 模型提问 → 走询问通道（form 带扩展键）→ 用户答 → 答案读成一句话进工具结果。
 * 没人能回答 / 用户拒答：如实告诉模型，不替人选。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { StubProvider } from '@domi/model'
import { type Question, questionsOf } from '@domi/protocol'
import { DomiSession, type PendingAsk } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-ask-'))
  dirs.push(d)
  return d
}

const QUESTIONS: Question[] = [
  {
    header: '存储',
    question: '会话数据存哪？',
    options: [
      { label: 'SQLite', description: '单文件，零运维' },
      { label: 'Postgres', description: '要起服务' },
    ],
  },
  {
    header: '端',
    question: '先做哪几端？',
    options: [{ label: 'Web' }, { label: 'TUI' }, { label: 'Desktop' }],
    multiSelect: true,
  },
]

function session(answer?: (a: PendingAsk) => void) {
  const s = new DomiSession({
    // 没有任何规则：ask.user 是内置放行的，不靠用户配置（按需档下没规则的能力会被拒）
    config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
    sessionId: 's1',
    cwd: tmp(),
    dbPath: join(tmp(), 'e.db'),
    provider: new StubProvider([
      [{ type: 'tool-call', id: 'q1', name: 'ask.user', args: { questions: QUESTIONS } }],
      [{ type: 'delta', text: '好的' }],
    ]),
  })
  if (answer) s.on('onAsk', (a) => a && answer(a))
  return s
}

async function resultOf(s: DomiSession): Promise<Record<string, unknown>> {
  const ev = (await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev as { ok: boolean; payload: unknown }
  expect(ev.ok).toBe(true)
  return ev.payload as Record<string, unknown>
}

describe('PRD-M12-004 AC-7 · ask.user', () => {
  test('问题带着扩展键推给端；答案按题读成一句话交给模型', async () => {
    const asks: PendingAsk[] = []
    const s = session((a) => {
      asks.push(a)
      a.answer(true, { answers: [{ selected: ['SQLite'] }, { selected: ['Web', 'TUI'], other: '桌面以后' }] })
    })
    await s.submit('开始吧')
    expect(asks).toHaveLength(1)
    expect(asks[0]?.capabilityId).toBe('ask.user')
    expect(questionsOf(asks[0]?.form?.schema)).toEqual(QUESTIONS)
    const r = await resultOf(s)
    expect(r.answered).toBe(true)
    expect(r.answers).toEqual([
      { header: '存储', question: '会话数据存哪？', answer: 'SQLite' },
      { header: '端', question: '先做哪几端？', answer: 'Web、TUI；桌面以后' },
    ])
    await s.flushAndClose()
  })

  test('降级表单（Telegram、旧客户端）的回答同样认', async () => {
    const s = session((a) => a.answer(true, { q1: 'Postgres', q2_other: '只做 CLI' }))
    await s.submit('开始吧')
    expect((await resultOf(s)).answers).toEqual([
      { header: '存储', question: '会话数据存哪？', answer: 'Postgres' },
      { header: '端', question: '先做哪几端？', answer: '只做 CLI' },
    ])
    await s.flushAndClose()
  })

  test('用户拒答：answered:false，结果里明说不要替用户选', async () => {
    const s = session((a) => a.answer(false))
    await s.submit('开始吧')
    const r = await resultOf(s)
    expect(r.answered).toBe(false)
    expect(String(r.message)).toContain('不要替用户')
    await s.flushAndClose()
  })

  test('没人能回答（非交互）：同样 answered:false，不替人选', async () => {
    const s = session()
    await s.submit('开始吧')
    expect((await resultOf(s)).answered).toBe(false)
    await s.flushAndClose()
  })

  test('参数不合法（5 题）→ 工具报参数错，不弹框', async () => {
    const asks: PendingAsk[] = []
    const s = new DomiSession({
      config: ConfigSchema.parse({ model: { provider: 'stub', name: 'stub-1', apiKey: 'k' } }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([
        [
          {
            type: 'tool-call',
            id: 'q1',
            name: 'ask.user',
            args: { questions: [...QUESTIONS, ...QUESTIONS, QUESTIONS[0]] },
          },
        ],
        [{ type: 'delta', text: '好的' }],
      ]),
    })
    s.on('onAsk', (a) => a && asks.push(a))
    await s.submit('开始吧')
    const ev = (await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev as { ok: boolean; reason?: string }
    expect(ev.ok).toBe(false)
    expect(ev.reason).toBe('invalid_args')
    expect(asks).toHaveLength(0)
    await s.flushAndClose()
  })
})

describe('PRD-M12-004 AC-7 · 内置放行不盖过用户自己的规则', () => {
  test('用户写了 ask.user deny：照样拒，不弹框', async () => {
    const asks: PendingAsk[] = []
    const s = new DomiSession({
      config: ConfigSchema.parse({
        model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
        permissions: { rules: [{ name: 'no-questions', capability: 'ask.user', decision: 'deny' }] },
      }),
      sessionId: 's1',
      cwd: tmp(),
      dbPath: join(tmp(), 'e.db'),
      provider: new StubProvider([
        [{ type: 'tool-call', id: 'q1', name: 'ask.user', args: { questions: QUESTIONS } }],
        [{ type: 'delta', text: '好的' }],
      ]),
    })
    s.on('onAsk', (a) => a && asks.push(a))
    await s.submit('开始吧')
    const ev = (await s.pumpAll()).find((e) => e.ev.t === 'tool.result')?.ev as { ok: boolean }
    expect(ev.ok).toBe(false)
    expect(asks).toHaveLength(0)
    await s.flushAndClose()
  })
})
