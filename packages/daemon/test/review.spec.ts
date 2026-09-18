/**
 * PRD-M7-010 · 审阅子 agent（AC-1 / AC-2）
 *
 * 经 Daemon 的 review.start 走：模型替身按「收到的是不是审阅题面」分两种剧本。
 * 审阅会话的剧本故意去碰写能力，证明它只读；父会话里放一句独有的暗号，证明审阅会话的上下文里没有它。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '@domi/client-core'
import { ConfigSchema } from '@domi/config'
import { type ModelRequest, StubProvider } from '@domi/model'
import { PROTOCOL_VERSION, type RpcNotification, type RpcRequest, type RpcResponse } from '@domi/protocol'
import { type ClientConn, createRuntimeHost, Daemon, type RuntimeHost } from '../src/index.ts'

const dirs: string[] = []
const hosts: RuntimeHost[] = []
afterEach(() => {
  for (const h of hosts.splice(0)) h.close()
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* 挂载里删不掉就算了 */
    }
  }
})
class Conn implements ClientConn {
  readonly got: Array<RpcNotification | RpcResponse> = []
  constructor(readonly id: string) {}
  send(m: RpcNotification | RpcResponse): void {
    this.got.push(m)
  }
  notifications(method: string): Array<Record<string, unknown>> {
    return this.got
      .filter((m) => 'method' in m && m.method === method)
      .map((m) => (m as RpcNotification).params as Record<string, unknown>)
  }
}
function tmp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}

const SECRET = 'PARENT_ONLY_暗号_7f3a'
const FINDINGS = [
  {
    file: 'src/pay.ts',
    line: 3,
    severity: 'high',
    problem: '金额没有校验负数',
    basis: 'docs/spec.md 第 2 条：金额必须为正',
  },
  { file: 'src/pay.ts', line: 1, severity: 'low', problem: '函数名拼错', basis: '代码事实' },
]

function isReview(req: ModelRequest): boolean {
  return JSON.stringify(req.messages).includes('docs/spec.md')
}

function setup() {
  const home = tmp('domi-rv-home-')
  const repo = tmp('domi-rv-repo-')
  execSync('git init -q', { cwd: repo })
  mkdirSync(join(repo, 'src'))
  mkdirSync(join(repo, 'docs'))
  writeFileSync(join(repo, 'src', 'pay.ts'), 'export function pay(n: number) {\n  return n\n}\n')
  writeFileSync(join(repo, 'docs', 'spec.md'), '# 需求\n\n1. 支付\n2. 金额必须为正\n')
  execSync('git add -A && git -c user.email=a@b -c user.name=a commit -q -m init', { cwd: repo })
  writeFileSync(join(repo, 'src', 'pay.ts'), 'export function payy(n: number) {\n  // 新逻辑\n  return charge(n)\n}\n')

  const reviewStep = new Map<number, number>()
  const provider = new StubProvider(
    [
      (req, i) => {
        if (!isReview(req)) return [{ type: 'delta', text: '好的，已实现' }]
        const step = reviewStep.size
        reviewStep.set(i, step)
        if (step === 0) {
          return [
            { type: 'tool-call', id: 'r1', name: 'fs.write', args: { path: 'src/pay.ts', content: 'hacked' } },
            { type: 'tool-call', id: 'r2', name: 'shell.exec', args: { cmd: 'touch REVIEW_RAN' } },
            { type: 'tool-call', id: 'r3', name: 'fs.read', args: { path: 'src/pay.ts' } },
          ]
        }
        if (step === 1) return [{ type: 'tool-call', id: 'r4', name: 'review.report', args: { findings: FINDINGS } }]
        return [{ type: 'delta', text: '审完了：两个问题' }]
      },
    ],
    { onExhausted: 'repeat-last' },
  )
  let k = 0
  const host = createRuntimeHost({
    config: ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      // 用户配置把写与命令都放行了：审阅会话仍然只能读，靠的是它自己的范围，不是配置
      permissions: {
        rules: ['fs.read', 'fs.write', 'shell.exec'].map((c) => ({
          name: `allow-${c}`,
          capability: c,
          decision: 'allow',
        })),
      },
      verify: { enabled: false },
    }),
    dbPath: join(home, 'events.db'),
    defaultCwd: repo,
    provider,
    newId: () => `s${++k}`,
  })
  hosts.push(host)
  const daemon = new Daemon(host)
  let n = 0
  const call = async (conn: Conn, method: string, params: unknown = {}): Promise<Record<string, unknown>> => {
    const req: RpcRequest = { jsonrpc: '2.0', id: ++n, method, params }
    const r = await daemon.handle(conn, req)
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
    return r.result as Record<string, unknown>
  }
  const snapshot = async (sessionId: string) => {
    const c = new Conn(`peek${++n}`)
    await call(c, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 'peek' })
    await call(c, 'session.subscribe', { sessionId, fromSeq: 0 })
    return {
      envs: c
        .notifications('session.events')
        .flatMap((x) => x.events as Array<{ seq: number; ev: Record<string, unknown> & { t: string } }>),
      busy: c.notifications('session.busy').some((x) => x.busy === true),
    }
  }
  const idle = async (sessionId: string, until: (t: string[]) => boolean) => {
    for (let i = 0; i < 250; i++) {
      const s = await snapshot(sessionId)
      if (!s.busy && until(s.envs.map((e) => e.ev.t))) return s.envs
      await Bun.sleep(20)
    }
    throw new Error('没跑完')
  }
  return { repo, provider, call, idle }
}

async function runReview() {
  const ctx = setup()
  const conn = new Conn('c')
  await ctx.call(conn, 'handshake', { protocolVersion: PROTOCOL_VERSION, client: 'test' })
  const { sessionId: parent } = (await ctx.call(conn, 'session.create', { cwd: ctx.repo, kind: 'task' })) as {
    sessionId: string
  }
  await ctx.call(conn, 'session.submit', { sessionId: parent, text: `${SECRET}：把支付改一下` })
  await ctx.idle(parent, (t) => t.includes('model.request'))
  const { sessionId: review } = (await ctx.call(conn, 'review.start', {
    fromSessionId: parent,
    specs: ['docs/spec.md'],
  })) as { sessionId: string }
  const envs = await ctx.idle(
    review,
    (t) => t.includes('review.findings') && t.filter((x) => x === 'model.request').length >= 3,
  )
  const parentEnvs = await ctx.idle(parent, () => true)
  return { ...ctx, parent, review, envs, parentEnvs }
}

describe('PRD-M7-010 AC-1 · 只读子 agent，输入只有 diff 与需求文档', () => {
  test('用户配置放行了写与命令，审阅会话照样只能读：写与命令被拒、没有副作用；读照常', async () => {
    const { repo, envs } = await runReview()
    const perms = envs.filter((e) => e.ev.t === 'permission').map((e) => e.ev)
    expect(perms.find((p) => p.capabilityId === 'fs.write')).toMatchObject({
      decision: 'deny',
      matchedRule: 'parent-scope',
    })
    expect(perms.find((p) => p.capabilityId === 'shell.exec')).toMatchObject({
      decision: 'deny',
      matchedRule: 'parent-scope',
    })
    expect(perms.find((p) => p.capabilityId === 'fs.read')).toMatchObject({ decision: 'allow' })
    expect(existsSync(join(repo, 'REVIEW_RAN'))).toBe(false)
    expect(await Bun.file(join(repo, 'src', 'pay.ts')).text()).toContain('payy')
  }, 30_000)

  test('审阅会话的上下文：有 diff、有需求文档，没有父会话的任何事件（断言父会话独有的暗号不在）', async () => {
    const { provider, envs, review } = await runReview()
    const reviewReqs = provider.calls.filter(isReview)
    expect(reviewReqs.length).toBeGreaterThanOrEqual(3)
    for (const req of reviewReqs) {
      const text = JSON.stringify(req.messages)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('好的，已实现')
    }
    const first = JSON.stringify(reviewReqs[0]?.messages)
    expect(first).toContain('charge(n)') // diff
    expect(first).toContain('金额必须为正') // 需求文档
    // 审阅会话自己的事件流从它的题面开始，第一条就是 user.input，前面没有接父会话的历史
    expect(envs[0]?.ev.t).toBe('user.input')
    expect(review.startsWith('review-')).toBe(true)
  }, 30_000)
})

describe('PRD-M7-010 AC-2 · 结构化发现：落事件，并挂在发起会话的轨迹下', () => {
  test('review.findings 带文件、行、问题、依据；父会话多一条 task.spawn 指向审阅会话', async () => {
    const { envs, parentEnvs, review } = await runReview()
    const found = envs.find((e) => e.ev.t === 'review.findings')?.ev as { findings: typeof FINDINGS } | undefined
    expect(found?.findings).toEqual(FINDINGS)
    expect(parentEnvs.find((e) => e.ev.t === 'task.spawn')?.ev).toMatchObject({ childSessionId: review })
  }, 30_000)

  test('client-core 从事件投影出发现（Web 的 ReviewFindings 按文件分组展示用的就是它）', async () => {
    const { envs } = await runReview()
    const store = createSessionStore()
    store.applyEvents(envs as never)
    expect(store.$review.get()?.map((f) => [f.file, f.line])).toEqual([
      ['src/pay.ts', 3],
      ['src/pay.ts', 1],
    ])
  }, 30_000)
})
