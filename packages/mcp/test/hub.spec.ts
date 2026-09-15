/**
 * PRD-M2-001 · MCP client（ADR-015）
 *
 * 全部用真的 MCP server（@modelcontextprotocol/server），不联网：HTTP 起在 127.0.0.1，stdio 是本地子进程。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '@domi/config'
import { InMemoryResponseCacheStore } from '@modelcontextprotocol/client'
import { hostAllowed, McpHub, type McpHubOptions } from '../src/index.ts'
import { PIXEL_PNG_BASE64, startHttpServer } from './fixtures/servers.ts'

const STDIO_SERVER = join(import.meta.dir, 'fixtures', 'stdio-server.ts')
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-mcp-'))
  cleanups.push(() => {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  })
  return d
}

function server(partial: Partial<McpServerConfig> & { name: string }): McpServerConfig {
  return { args: [], env: {}, enabled: true, ...partial }
}

function hub(opts: Partial<McpHubOptions> & { servers: McpServerConfig[] }): McpHub {
  const h = new McpHub({ allowedHosts: ['127.0.0.1'], timeoutMs: 5_000, blobDir: join(tmp(), 'blobs'), ...opts })
  cleanups.push(() => h.close())
  return h
}

const ctx = () => ({ cwd: '/tmp', signal: new AbortController().signal, emit: () => undefined })

function tool(h: McpHub, name: string) {
  const t = h.tools().find((x) => x.name === name)
  if (!t)
    throw new Error(
      `没有工具 ${name}；现有：${h
        .tools()
        .map((x) => x.name)
        .join(', ')}`,
    )
  return t
}

describe('AC-1 · stdio 与 Streamable HTTP 两类 server', () => {
  test('HTTP：连上（2026-07-28 新握手）、列出工具、调用', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const h = hub({ servers: [server({ name: 'web', url: http.url })] })
    const [status] = await h.start()
    expect(status).toMatchObject({ name: 'web', state: 'connected', era: 'modern' })
    expect(h.tools().map((t) => t.name)).toEqual([
      'mcp.web.echo',
      'mcp.web.fail',
      'mcp.web.screenshot',
      'mcp.web.deploy',
    ])
    expect(await tool(h, 'mcp.web.echo').execute({ text: 'hi' }, ctx())).toMatchObject({
      content: [{ type: 'text', text: 'echo:hi' }],
    })
  })

  test('stdio：起子进程、列出工具、调用', async () => {
    const h = hub({ servers: [server({ name: 'local', command: 'bun', args: [STDIO_SERVER] })] })
    const [status] = await h.start()
    expect(status).toMatchObject({ name: 'local', state: 'connected' })
    expect(await tool(h, 'mcp.local.echo').execute({ text: '你好' }, ctx())).toMatchObject({
      content: [{ type: 'text', text: 'echo:你好' }],
    })
  }, 20_000)

  test('工具以 mcp.<server>.<tool> 注册，能力 id 同名，schema 原样交给模型', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const h = hub({ servers: [server({ name: 'web', url: http.url })] })
    await h.start()
    const echo = tool(h, 'mcp.web.echo')
    expect(echo.capability).toBe('mcp.web.echo')
    expect(echo.description).toContain('原样返回')
    expect(echo.inputJsonSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } })
    // 本地先校验一遍参数：明显不对的不用发出去
    expect(echo.schema.safeParse({ text: 1 }).success).toBe(false)
  })

  test('server 报 isError → 抛错，由 registry 变成 ok:false，带上 server 的原话', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const h = hub({ servers: [server({ name: 'web', url: http.url })] })
    await h.start()
    await expect(tool(h, 'mcp.web.fail').execute({}, ctx())).rejects.toThrow('磁盘满了')
  })
})

describe('AC-2 · MRTR（input_required → 带 inputResponses 重试）', () => {
  test('单轮追问：回答被带回去，工具完成', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const asked: string[] = []
    const h = hub({
      servers: [server({ name: 'web', url: http.url })],
      onElicit: async (_server, req) => {
        asked.push(req.message)
        return { action: 'accept', content: { confirm: true } }
      },
    })
    await h.start()
    expect(await tool(h, 'mcp.web.deploy').execute({ env: 'prod' }, ctx())).toMatchObject({
      content: [{ type: 'text', text: 'deployed prod' }],
    })
    expect(asked).toEqual(['部署到 prod？'])
    expect(http.counts.call).toBe(2)
  })

  test('两轮追问：第二轮一次要两个回答', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const asked: string[] = []
    const h = hub({
      servers: [server({ name: 'web', url: http.url })],
      onElicit: async (_server, req) => {
        asked.push(req.message)
        return req.message.includes('为什么')
          ? { action: 'accept', content: { reason: '修线上 bug' } }
          : { action: 'accept', content: { confirm: true } }
      },
    })
    await h.start()
    expect(await tool(h, 'mcp.web.deploy').execute({ env: 'prod', twoRounds: true }, ctx())).toMatchObject({
      content: [{ type: 'text', text: 'deployed prod：修线上 bug' }],
    })
    expect(http.counts.call).toBe(3)
    expect(asked).toContain('为什么现在部署？')
  })

  test('没有处理器时一律 decline —— server 知道被拒了，而不是卡住', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const h = hub({ servers: [server({ name: 'web', url: http.url })] })
    await h.start()
    expect(await tool(h, 'mcp.web.deploy').execute({ env: 'prod' }, ctx())).toMatchObject({
      content: [{ type: 'text', text: '已取消（decline）' }],
    })
  })
})

describe('AC-3 · 列表缓存提示', () => {
  test('TTL 内第二次连接不发 tools/list', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const cacheStore = new InMemoryResponseCacheStore()
    const a = hub({ servers: [server({ name: 'web', url: http.url })], cacheStore })
    await a.start()
    await a.close()
    const b = hub({ servers: [server({ name: 'web', url: http.url })], cacheStore })
    await b.start()
    expect(http.counts.list).toBe(1)
    expect(b.tools()).toHaveLength(4)
  })
})

describe('AC-5 · 一个 server 挂了不影响别的', () => {
  test('命令不存在、超时不响应、正常的三个 server 一起启动', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const started = Date.now()
    const h = hub({
      timeoutMs: 1_500,
      servers: [
        server({ name: 'missing', command: 'domi-no-such-mcp-server' }),
        server({ name: 'silent', command: 'bun', args: ['-e', 'setInterval(() => {}, 1000)'] }),
        server({ name: 'web', url: http.url }),
      ],
    })
    const statuses = await h.start()
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(statuses.map((s) => [s.name, s.state])).toEqual([
      ['missing', 'failed'],
      ['silent', 'failed'],
      ['web', 'connected'],
    ])
    expect(statuses.find((s) => s.name === 'silent')?.error).toContain('超时')
    // 活着的那个照常能用
    expect(await tool(h, 'mcp.web.echo').execute({ text: 'x' }, ctx())).toBeTruthy()
    expect(
      h
        .notices()
        .map((n) => n.server)
        .sort(),
    ).toEqual(['missing', 'silent'])
  }, 20_000)

  test('enabled: false 的不连', async () => {
    const h = hub({ servers: [server({ name: 'off', command: 'bun', args: [STDIO_SERVER], enabled: false })] })
    expect(await h.start()).toEqual([{ name: 'off', state: 'disabled', tools: [] }])
  })
})

describe('AC-6 · HTTP server 的出站受域名白名单约束（INV-11）', () => {
  test('主机不在白名单：不发任何请求，状态为 failed，留下通知', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const h = hub({ allowedHosts: [], servers: [server({ name: 'web', url: http.url })] })
    const [status] = await h.start()
    expect(status).toMatchObject({ state: 'failed' })
    expect(status?.error).toContain('127.0.0.1')
    expect(http.counts.list + http.counts.call).toBe(0)
    expect(h.notices()).toEqual([expect.objectContaining({ server: 'web', kind: 'host_not_allowed' })])
  })

  test('白名单匹配规则', () => {
    expect(hostAllowed('mcp.example.com', ['mcp.example.com'])).toBe(true)
    expect(hostAllowed('MCP.Example.com', ['mcp.example.com'])).toBe(true)
    expect(hostAllowed('a.internal.dev', ['*.internal.dev'])).toBe(true)
    expect(hostAllowed('internal.dev', ['*.internal.dev'])).toBe(false)
    expect(hostAllowed('evilinternal.dev', ['*.internal.dev'])).toBe(false)
    expect(hostAllowed('example.com', [])).toBe(false)
    expect(hostAllowed('anything', ['*'])).toBe(false) // 不支持「全部放行」
  })

  test('请求途中被重定向到白名单外的主机 → 拒绝，不跟过去', async () => {
    const target = startHttpServer()
    cleanups.push(target.stop)
    // localhost 与 127.0.0.1 是两个名字：只放行前者，重定向目标用后者
    const redirector = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => Response.redirect(target.url, 307),
    })
    cleanups.push(() => redirector.stop(true))
    const h = hub({
      allowedHosts: ['localhost'],
      servers: [server({ name: 'web', url: `http://localhost:${redirector.port}/mcp` })],
    })
    const [status] = await h.start()
    expect(status?.state).toBe('failed')
    expect(target.counts.list + target.counts.call).toBe(0)
    expect(h.notices()[0]?.kind).toBe('host_not_allowed')
  })
})

describe('PRD-M2-009 AC-2 · 二进制结果不进事件流正文', () => {
  test('图片落到 blob 目录，结果里只留引用', async () => {
    const http = startHttpServer()
    cleanups.push(http.stop)
    const blobDir = join(tmp(), 'blobs')
    const h = hub({ servers: [server({ name: 'web', url: http.url })], blobDir })
    await h.start()
    const out = (await tool(h, 'mcp.web.screenshot').execute({}, ctx())) as {
      content: Array<Record<string, unknown>>
    }
    expect(JSON.stringify(out)).not.toContain(PIXEL_PNG_BASE64)
    const image = out.content[1] as { type: string; mimeType: string; blob: string; bytes: number }
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(image.blob).toMatch(/^sha256:[0-9a-f]{64}$/)
    const file = join(blobDir, image.blob.slice('sha256:'.length))
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file).equals(Buffer.from(PIXEL_PNG_BASE64, 'base64'))).toBe(true)
    expect(image.bytes).toBe(Buffer.from(PIXEL_PNG_BASE64, 'base64').length)
  })
})
