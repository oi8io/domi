/**
 * PRD-M2-001 · MCP 从配置到一次真实工具调用，全链路
 *
 * config.yaml 里配一个 stdio MCP server → domid（真进程）连上它 → 假模型发起调用 →
 * 权限通配规则放行 → 结果进事件流 → 客户端看得到。不联网（INV-08）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, DomiClient, type WireSocket } from '@domi/client-core'
import { daemonPaths, ensureDaemon, isAlive, readLock } from '../src/index.ts'

const MAIN = join(import.meta.dir, '../src/main.ts')
const STDIO_SERVER = join(import.meta.dir, '../../mcp/test/fixtures/stdio-server.ts')
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

/** 假 OpenAI 兼容模型：第一轮调 mcp.local.echo，第二轮总结 */
function scriptedLlm() {
  let turn = 0
  const bodies: Array<{ tools?: Array<{ function: { name: string } }> }> = []
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
      bodies.push((await req.json()) as (typeof bodies)[number])
      turn++
      if (turn === 1) {
        return sse([
          chunk(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'mcp_local_echo', arguments: '{"text":"来自 MCP"}' },
                },
              ],
            },
            null,
          ),
          chunk({}, 'tool_calls'),
        ])
      }
      return sse([chunk({ role: 'assistant', content: '调用完成' }, null), chunk({}, 'stop')])
    },
  })
  cleanups.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}/v1`, bodies }
}

describe('MCP 全链路', () => {
  test('配置里的 stdio server → domid 连上 → 模型调用 → 通配规则放行 → 结果进事件流', async () => {
    const llm = scriptedLlm()
    const home = mkdtempSync(join(tmpdir(), 'domi-mcp-e2e-'))
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
providers:
  fake-llm:
    base_url: ${llm.url}
permissions:
  rules:
    - name: local-mcp
      capability: mcp.local.*
      decision: allow
mcp:
  servers:
    - name: local
      command: bun
      args: [${JSON.stringify(STDIO_SERVER)}]
`,
      'utf8',
    )

    const daemon = await ensureDaemon({
      home,
      command: ['bun', MAIN],
      env: {
        PATH: process.env.PATH ?? '',
        DOMI_PORT: '0',
        DOMI_MODEL_PROVIDER: 'fake-llm',
        DOMI_MODEL: 'fake',
        DOMI_FAKE_LLM_API_KEY: 'not-a-real-key',
      },
    })
    const client = new DomiClient({
      clientName: 'test',
      reconnectMs: 0,
      connect: () => new WebSocket(daemon.url) as unknown as WireSocket,
    })
    cleanups.push(() => client.close())
    await client.start()
    const sessionId = await client.createSession(home)
    const store = createSessionStore()
    await client.watch(sessionId, store)

    // domid 是先开门、后连 MCP 的：等它连上再提交（轮询日志里的状态行）
    const log = daemonPaths(home).log
    for (let i = 0; i < 200; i++) {
      if ((await Bun.file(log).text()).includes('mcp local: connected')) break
      await Bun.sleep(25)
    }
    expect(await Bun.file(log).text()).toContain('mcp local: connected 4 个工具')

    await client.submit(sessionId, '用 MCP 回个声')
    const done = () => store.$items.get().some((i) => i.kind === 'assistant' && i.text === '调用完成')
    for (let i = 0; i < 300 && !done(); i++) await Bun.sleep(20)

    const items = store.$items.get()
    expect(items.find((i) => i.kind === 'tool-call')).toMatchObject({ text: 'mcp.local.echo' })
    expect(items.find((i) => i.kind === 'permission')?.text).toBe('mcp.local.echo → allow')
    const result = items.find((i) => i.kind === 'tool-result')
    expect(result?.ok).toBe(true)
    expect(result?.summary).toContain('echo:来自 MCP')
    expect(done()).toBe(true)
    // 发给模型的工具清单里有 MCP 工具（编码后的名字）
    expect(llm.bodies[0]?.tools?.map((t) => t.function.name)).toContain('mcp_local_echo')
  }, 30_000)
})
