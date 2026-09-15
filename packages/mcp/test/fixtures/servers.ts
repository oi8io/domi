/**
 * 测试用的 MCP server。都是真 server（@modelcontextprotocol/server），不是手写的假响应——
 * 协议细节由 SDK 双方各自负责，测试只验 domi 这一层的行为。
 */
import { acceptedContent, createMcpHandler, inputRequired, inputResponse, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

/** 1×1 的 PNG，拿来测「二进制不进事件流」 */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export function buildServer(opts: { name?: string } = {}): McpServer {
  const s = new McpServer(
    { name: opts.name ?? 'fixture', version: '1.0.0' },
    { cacheHints: { 'tools/list': { ttlMs: 60_000, cacheScope: 'public' } } },
  )
  s.registerTool(
    'echo',
    { description: '原样返回', inputSchema: z.object({ text: z.string() }) },
    async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }),
  )
  s.registerTool('fail', { description: '总是失败', inputSchema: z.object({}) }, async () => ({
    isError: true,
    content: [{ type: 'text', text: '磁盘满了' }],
  }))
  s.registerTool('screenshot', { description: '返回一张图', inputSchema: z.object({}) }, async () => ({
    content: [
      { type: 'text', text: '截好了' },
      { type: 'image', data: PIXEL_PNG_BASE64, mimeType: 'image/png' },
    ],
  }))
  // MRTR：先要一次确认；二轮再要一个理由（两轮追问）
  s.registerTool(
    'deploy',
    { description: '部署，要确认', inputSchema: z.object({ env: z.string(), twoRounds: z.boolean().optional() }) },
    async ({ env, twoRounds }, ctx) => {
      const responses = ctx.mcpReq.inputResponses
      const confirm = inputResponse(responses, 'confirm')
      if (confirm.kind === 'elicit' && confirm.action !== 'accept') {
        return { content: [{ type: 'text', text: `已取消（${confirm.action}）` }] }
      }
      const ok = acceptedContent<{ confirm: boolean }>(responses, 'confirm')
      const confirmSchema = {
        type: 'object' as const,
        properties: { confirm: { type: 'boolean' as const } },
        required: ['confirm'],
      }
      const reasonSchema = {
        type: 'object' as const,
        properties: { reason: { type: 'string' as const } },
        required: ['reason'],
      }
      if (!ok) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({ message: `部署到 ${env}？`, requestedSchema: confirmSchema }),
          },
        })
      }
      const reason = acceptedContent<{ reason: string }>(responses, 'reason')
      if (twoRounds && !reason) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({ message: `部署到 ${env}？`, requestedSchema: confirmSchema }),
            reason: inputRequired.elicit({ message: '为什么现在部署？', requestedSchema: reasonSchema }),
          },
        })
      }
      return { content: [{ type: 'text', text: `deployed ${env}${reason ? `：${reason.reason}` : ''}` }] }
    },
  )
  return s
}

/** 2026-07-28 的 Streamable HTTP server，统计收到的 tools/list 次数 */
export function startHttpServer(name = 'fixture') {
  const handler = createMcpHandler(() => buildServer({ name }))
  const counts = { list: 0, call: 0 }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (req.method === 'POST') {
        const body = (await req.clone().json()) as { method?: string }
        if (body.method === 'tools/list') counts.list++
        if (body.method === 'tools/call') counts.call++
      }
      return handler.fetch(req)
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    counts,
    stop: () => server.stop(true),
  }
}
