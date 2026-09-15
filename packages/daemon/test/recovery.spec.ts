/**
 * PRD-M3-002 AC-3 · TASK-M3-010：domid 被 kill -9 后重启，未完成的任务恢复到最后一个一致点
 *
 * 真进程、真 SIGKILL：模型让 domid 跑一个慢命令，命令还在跑时把 domid 杀掉。
 * 重启后（留下的陈锁要能被接管）会话里应当是：
 *   - 那个工具调用配上了「中断」结果（否则下一轮请求会被 provider 拒）
 *   - 一条 recovery 标记，这一轮到此为止，界面不再显示「处理中」
 *   - 用户再说一句就能接着做，发给模型的上下文是一致的
 * 不联网（INV-08）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, DomiClient, type WireSocket } from '@domi/client-core'
import { daemonPaths, ensureDaemon, isAlive, readLock } from '../src/index.ts'

const MAIN = join(import.meta.dir, '../src/main.ts')
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

type Body = { messages: Array<{ role: string; tool_call_id?: string; content?: unknown }> }

/** 第一轮：调 shell.exec 跑个慢命令；之后：正常回话 */
function scriptedLlm() {
  const bodies: Body[] = []
  const sse = (chunks: unknown[]) =>
    new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  const chunk = (delta: unknown, finish: string | null) => ({
    id: 'c',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      bodies.push((await req.json()) as Body)
      if (bodies.length === 1) {
        return sse([
          chunk(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'shell_exec', arguments: '{"cmd":"sleep 8"}' },
                },
              ],
            },
            null,
          ),
          chunk({}, 'tool_calls'),
        ])
      }
      return sse([chunk({ role: 'assistant', content: '好，接着来' }, null), chunk({}, 'stop')])
    },
  })
  cleanups.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}/v1`, bodies }
}

async function waitFor(cond: () => boolean, ms = 6000): Promise<void> {
  for (let t = 0; t < ms && !cond(); t += 20) await Bun.sleep(20)
}

describe('kill -9 后恢复', () => {
  test('工具跑到一半 domid 被杀：重启后调用配上中断结果、这一轮收尾，再说一句能接着做', async () => {
    const llm = scriptedLlm()
    const home = mkdtempSync(join(tmpdir(), 'domi-recovery-'))
    cleanups.push(async () => {
      const info = readLock(daemonPaths(home).lock)
      if (info && isAlive(info.pid)) {
        process.kill(info.pid, 'SIGTERM')
        for (let i = 0; i < 50 && isAlive(info.pid); i++) await Bun.sleep(20)
      }
      try {
        rmSync(home, { recursive: true, force: true })
      } catch {
        // 没有删除权限的挂载
      }
    })
    mkdirSync(join(home, '.domi'), { recursive: true })
    writeFileSync(
      join(home, '.domi', 'config.yaml'),
      `model:
  capabilities:
    toolCall: true
permissions:
  rules:
    - name: allow-shell
      capability: shell.exec
      decision: allow
`,
      'utf8',
    )
    const start = () =>
      ensureDaemon({
        home,
        command: ['bun', MAIN],
        env: {
          PATH: process.env.PATH ?? '',
          DOMI_PORT: '0',
          DOMI_MODEL_PROVIDER: 'fake-llm',
          DOMI_MODEL: 'fake',
          DOMI_BASE_URL: llm.url,
          DOMI_API_KEY: 'not-a-real-key',
        },
      })
    const connect = async (url: string) => {
      const c = new DomiClient({
        clientName: 'test',
        reconnectMs: 0,
        connect: () => new WebSocket(url) as unknown as WireSocket,
      })
      cleanups.push(() => c.close())
      await c.start()
      return c
    }

    // —— 第一个 domid：跑到工具执行中
    const first = await start()
    const a = await connect(first.url)
    const sessionId = await a.createSession(home)
    const before = createSessionStore()
    await a.watch(sessionId, before)
    await a.submit(sessionId, '跑个慢命令')
    await waitFor(() => before.$items.get().some((i) => i.kind === 'tool-call'))
    expect(before.$items.get().some((i) => i.kind === 'tool-call')).toBe(true)
    await Bun.sleep(100) // 让命令真的开始跑

    const pid = readLock(daemonPaths(home).lock)?.pid
    expect(pid).toBeNumber()
    process.kill(pid as number, 'SIGKILL')
    for (let i = 0; i < 100 && isAlive(pid as number); i++) await Bun.sleep(20)
    expect(isAlive(pid as number)).toBe(false)
    a.close()

    // —— 重启：陈锁要能接管
    const second = await start()
    expect(second.spawned).toBe(true)
    expect(readLock(daemonPaths(home).lock)?.pid).not.toBe(pid)
    const b = await connect(second.url)
    const after = createSessionStore()
    await b.watch(sessionId, after)
    await waitFor(() => after.$items.get().some((i) => i.kind === 'error'))

    const items = after.$items.get()
    expect(items.find((i) => i.kind === 'tool-result')).toMatchObject({ ok: false, text: 'interrupted' })
    expect(items.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('没有正常结束') })
    expect(after.$status.get().busy).toBe(false)

    // —— 接着做：发给模型的上下文里，那个调用配上了结果
    await b.submit(sessionId, '继续')
    await waitFor(() => after.$items.get().some((i) => i.kind === 'assistant' && i.text === '好，接着来'))
    expect(after.$items.get().at(-1)).toMatchObject({ kind: 'assistant', text: '好，接着来' })
    const sent = llm.bodies[1]?.messages ?? []
    const toolMsg = sent.find((m) => m.role === 'tool')
    expect(toolMsg?.tool_call_id).toBe('call_1')
    expect(JSON.stringify(toolMsg?.content)).toContain('进程退出')
    expect(sent.at(-1)).toMatchObject({ role: 'user' })
  }, 40_000)
})
