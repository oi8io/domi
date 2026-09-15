/**
 * MCP hub —— PRD-M2-001 · PRD-M2-009 · docs/adr/015
 *
 * 协议本身交给 @modelcontextprotocol/client（版本协商、MRTR、列表缓存都在 SDK 里）。
 * 这个文件只做 SDK 不管的事：
 *   1. 每个 server 各自连、各自超时，一个挂了不拖别的（AC-5）
 *   2. 工具以 `mcp.<server>.<tool>` 变成普通 Tool，走 domi 的权限路径（INV-03）
 *   3. HTTP 出站过白名单（AC-6 · INV-11）
 *   4. 二进制结果落 blob，事件里只留引用（M2-009 AC-2）
 * 不调用已弃用的 sampling / roots / logging（AC-4，scripts/check-deprecated-mcp.ts 守）。
 */
import type { Tool } from '@domi/capability'
import type { McpServerConfig } from '@domi/config'
import {
  Client,
  type ElicitResult,
  InMemoryResponseCacheStore,
  type Tool as McpTool,
  type ResponseCacheStore,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'
import { externalizeContent } from './blobs.ts'
import { guardedFetch, HostNotAllowedError, hostAllowed } from './hosts.ts'

export interface ElicitRequestView {
  message: string
  requestedSchema?: unknown
}

export interface McpHubOptions {
  servers: readonly McpServerConfig[]
  allowedHosts: readonly string[]
  timeoutMs: number
  /** 二进制结果的落盘目录，通常是 ~/.domi/blobs */
  blobDir: string
  /** server 向用户要输入时怎么答。不给就一律 decline */
  onElicit?: (server: string, req: ElicitRequestView) => Promise<ElicitResult>
  /** 多次连接共用，才能让 TTL 内的重连不再发 list（AC-3） */
  cacheStore?: ResponseCacheStore
  clientInfo?: { name: string; version: string }
}

export interface McpServerStatus {
  name: string
  state: 'connected' | 'failed' | 'disabled'
  era?: 'legacy' | 'modern'
  tools: string[]
  error?: string
}

export interface McpNotice {
  server: string
  kind: 'connect_failed' | 'host_not_allowed' | 'tool_skipped'
  message: string
}

/** Anthropic 的工具名上限 64，且点会被编码成下划线（packages/model） */
const TOOL_NAME_LIMIT = 64

export class McpToolError extends Error {
  constructor(server: string, tool: string, text: string) {
    super(`MCP 工具 ${server}/${tool} 报错：${text}`)
    this.name = 'McpToolError'
  }
}

interface Connection {
  config: McpServerConfig
  client: Client
  tools: Tool[]
}

export class McpHub {
  private readonly connections = new Map<string, Connection>()
  private statuses: McpServerStatus[] = []
  private readonly noticeList: McpNotice[] = []
  private readonly cacheStore: ResponseCacheStore

  constructor(private readonly opts: McpHubOptions) {
    this.cacheStore = opts.cacheStore ?? new InMemoryResponseCacheStore()
  }

  async start(): Promise<McpServerStatus[]> {
    this.statuses = await Promise.all(this.opts.servers.map((s) => this.startOne(s)))
    return this.statuses
  }

  status(): McpServerStatus[] {
    return this.statuses
  }

  notices(): McpNotice[] {
    return [...this.noticeList]
  }

  tools(): Tool[] {
    return [...this.connections.values()].flatMap((c) => c.tools)
  }

  async close(): Promise<void> {
    const all = [...this.connections.values()]
    this.connections.clear()
    await Promise.all(all.map((c) => c.client.close().catch(() => undefined)))
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private async startOne(config: McpServerConfig): Promise<McpServerStatus> {
    if (!config.enabled) return { name: config.name, state: 'disabled', tools: [] }

    if (config.url !== undefined) {
      const host = new URL(config.url).hostname
      if (!hostAllowed(host, this.opts.allowedHosts)) {
        return this.fail(config.name, 'host_not_allowed', new HostNotAllowedError(host).message)
      }
    }

    const client = this.newClient(config.name)
    // SDK 会把传输层的错误包一层再抛（不带 cause），所以拒绝时由 fetch 这边直接记下来
    let denied: HostNotAllowedError | null = null
    const timeoutMs = config.timeoutMs ?? this.opts.timeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const connecting = (async () => {
        await client.connect(
          this.transport(config, (err) => {
            denied = err
          }),
        )
        return client.listTools()
      })()
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`连接超时（${timeoutMs}ms）`)), timeoutMs)
      })
      const listed = await Promise.race([connecting, timeout])
      const tools = this.adaptTools(config.name, client, listed.tools)
      this.connections.set(config.name, { config, client, tools })
      return {
        name: config.name,
        state: 'connected',
        era: client.getProtocolEra() ?? 'legacy',
        tools: tools.map((t) => t.name),
      }
    } catch (e) {
      await client.close().catch(() => undefined)
      const hostError: HostNotAllowedError | null = denied ?? findCause(e, HostNotAllowedError)
      if (hostError) return this.fail(config.name, 'host_not_allowed', hostError.message)
      return this.fail(config.name, 'connect_failed', e instanceof Error ? e.message : String(e))
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private fail(server: string, kind: McpNotice['kind'], message: string): McpServerStatus {
    this.noticeList.push({ server, kind, message: `MCP server ${server} 不可用：${message}` })
    return { name: server, state: 'failed', tools: [], error: message }
  }

  private newClient(server: string): Client {
    const client = new Client(this.opts.clientInfo ?? { name: 'domi', version: '0.1.0' }, {
      // 只声明 elicitation。sampling / roots 已弃用（AC-4），不声明
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: 'auto' },
      responseCacheStore: this.cacheStore,
      cachePartition: server,
    })
    client.setRequestHandler('elicitation/create', async (req) => {
      const params = req.params as { message?: string; requestedSchema?: unknown }
      if (!this.opts.onElicit) return { action: 'decline' }
      return this.opts.onElicit(server, {
        message: params.message ?? '',
        ...(params.requestedSchema === undefined ? {} : { requestedSchema: params.requestedSchema }),
      })
    })
    return client
  }

  private transport(config: McpServerConfig, onDenied: (err: HostNotAllowedError) => void) {
    if (config.command !== undefined) {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...getDefaultEnvironment(), ...config.env },
        // server 的 stderr 不往 domid 的终端里灌；出错时看连接错误就够
        stderr: 'ignore',
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      })
    }
    const url = new URL(config.url as string)
    return new StreamableHTTPClientTransport(url, {
      fetch: guardedFetch((input, init) => fetch(input, init), this.opts.allowedHosts, onDenied),
      ...(config.headers === undefined ? {} : { requestInit: { headers: config.headers } }),
    })
  }

  private adaptTools(server: string, client: Client, tools: readonly McpTool[]): Tool[] {
    const out: Tool[] = []
    const used = new Set<string>()
    for (const t of tools) {
      const name = `mcp.${server}.${t.name.replace(/[^A-Za-z0-9_-]/g, '_')}`
      if (name.length > TOOL_NAME_LIMIT || used.has(name)) {
        this.noticeList.push({
          server,
          kind: 'tool_skipped',
          message: `MCP 工具 ${server}/${t.name} 没有注册：${used.has(name) ? '与另一个工具重名' : `名字超过 ${TOOL_NAME_LIMIT} 个字符`}`,
        })
        continue
      }
      used.add(name)
      out.push(this.adaptTool(server, client, t, name))
    }
    return out
  }

  private adaptTool(server: string, client: Client, t: McpTool, name: string): Tool {
    const inputJsonSchema = t.inputSchema as Record<string, unknown>
    const blobDir = this.opts.blobDir
    return {
      name,
      capability: name,
      description: `[MCP ${server}] ${t.description ?? t.title ?? t.name}`,
      schema: schemaFrom(inputJsonSchema),
      inputJsonSchema,
      async execute(args, ctx) {
        const result = await client.callTool(
          { name: t.name, arguments: (args ?? {}) as Record<string, unknown> },
          { signal: ctx.signal },
        )
        const content = externalizeContent(blobDir, (result.content ?? []) as unknown[])
        if (result.isError) {
          const text = content
            .map((c) => (c as { text?: string }).text)
            .filter(Boolean)
            .join('\n')
          throw new McpToolError(server, t.name, text || '（server 没有给出原因）')
        }
        return {
          content,
          ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
        }
      },
    }
  }
}

/** JSON Schema → zod，只用来在本地先挡一道明显的错参。转不了就放行，交给 server 自己校验 */
function schemaFrom(json: Record<string, unknown>): z.ZodType {
  try {
    return z.fromJSONSchema(json as never)
  } catch {
    return z.record(z.string(), z.unknown())
  }
}

function findCause<T extends Error>(e: unknown, type: new (...args: never[]) => T): T | null {
  let cur: unknown = e
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof type) return cur
    cur = (cur as { cause?: unknown }).cause
  }
  return null
}
