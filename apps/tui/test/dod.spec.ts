/**
 * M3 DoD：在 TUI 里发起一个长任务，关掉终端，在浏览器里看到它继续执行并完成。
 *
 * 这条测试按 DoD 的原话走一遍，只把两处换成可以自动化的东西：
 *   - 「TUI」= TUI 真正用的那段接线（connect.ts：自动拉起 domid → 建会话 → 订阅）
 *     Ink 的按键在无 TTY 环境里验不了（docs/adr/001），那一段仍靠真终端走查
 *   - 「浏览器」= Web 端用的同一个 DomiClient
 * domid 是真进程，由 TUI 的入口文件以 daemon 角色拉起；模型是本进程里的一个假
 * OpenAI 兼容端点，慢慢吐字——不联网、不花钱（INV-08），但对 domid 来说它就是一个真网关。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, DomiClient, type WireSocket } from '@domi/client-core'
import { daemonPaths, isAlive, readLock } from '@domi/daemon'
import { connectChat } from '../src/connect.ts'

const ENTRY = join(import.meta.dir, '../src/main.tsx')
const PIECES = ['从前', '有座山，', '山里', '有座庙，', '庙里有个', '老和尚。']

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

/** 假的 OpenAI 兼容端点：每 120ms 吐一段。记下它是否把整段吐完了 */
function slowLlm() {
  const state = { requests: 0, finished: 0 }
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: 'c1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fake',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (!new URL(req.url).pathname.endsWith('/chat/completions')) return new Response('nope', { status: 404 })
      state.requests++
      const enc = new TextEncoder()
      const body = new ReadableStream({
        async start(ctrl) {
          ctrl.enqueue(enc.encode(chunk({ role: 'assistant', content: '' }, null)))
          for (const p of PIECES) {
            await Bun.sleep(120)
            ctrl.enqueue(enc.encode(chunk({ content: p }, null)))
          }
          ctrl.enqueue(enc.encode(chunk({}, 'stop')))
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'))
          state.finished++
          ctrl.close()
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  cleanups.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}/v1`, state }
}

function home(): string {
  const h = mkdtempSync(join(tmpdir(), 'domi-dod-'))
  cleanups.push(async () => {
    const info = readLock(daemonPaths(h).lock)
    if (info && isAlive(info.pid)) {
      process.kill(info.pid, 'SIGTERM')
      for (let i = 0; i < 50 && isAlive(info.pid); i++) await Bun.sleep(20)
    }
    try {
      rmSync(h, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  })
  return h
}

describe('M3 DoD', () => {
  test('TUI 发起长任务后立刻退出，浏览器端连上来看到它继续执行并完成', async () => {
    const llm = slowLlm()
    const h = home()
    // openai-compatible 默认不声明工具调用（fail-closed）；这个假网关「支持」，显式打开
    mkdirSync(join(h, '.domi'), { recursive: true })
    writeFileSync(
      join(h, '.domi', 'config.yaml'),
      `model:
  capabilities:
    toolCall: true
providers:
  fake-llm:
    base_url: ${llm.url}
`,
      'utf8',
    )
    const env = {
      PATH: process.env.PATH ?? '',
      DOMI_PORT: '0',
      DOMI_MODEL_PROVIDER: 'fake-llm', // 未知 provider 走 openai-compatible
      DOMI_MODEL: 'fake',
      DOMI_FAKE_LLM_API_KEY: 'not-a-real-key',
    }

    // —— TUI：自动拉起 domid，建会话，提交，马上退出
    const tui = await connectChat({
      home: h,
      cwd: h,
      model: { provider: 'fake-llm', name: 'fake' },
      command: ['bun', ENTRY],
      env,
    })
    expect(tui.daemon.spawned).toBe(true)
    await tui.client.submit(tui.sessionId, '讲个故事')
    for (let i = 0; i < 100 && llm.state.requests === 0; i++) await Bun.sleep(20)
    expect(llm.state.requests).toBe(1)
    tui.client.close() // 关掉终端
    expect(llm.state.finished).toBe(0) // 这时模型还在吐字

    // —— 浏览器：之后才连上来，只知道会话 id
    const web = new DomiClient({
      clientName: 'domi-web',
      reconnectMs: 0,
      connect: () => new WebSocket(tui.daemon.url) as unknown as WireSocket,
    })
    cleanups.push(() => web.close())
    await web.start()
    const store = createSessionStore()
    await web.watch(tui.sessionId, store)

    const assistant = () => store.$items.get().find((i) => i.kind === 'assistant')?.text ?? ''
    for (let i = 0; i < 300 && (assistant() !== PIECES.join('') || store.$status.get().busy); i++) {
      await Bun.sleep(20)
    }
    expect(assistant()).toBe(PIECES.join(''))
    expect(store.$items.get()[0]).toMatchObject({ kind: 'user', text: '讲个故事' })
    expect(store.$status.get().busy).toBe(false)
    expect(store.$items.get().some((i) => i.kind === 'error')).toBe(false)
    expect(llm.state.finished).toBe(1)
  }, 30_000)
})
