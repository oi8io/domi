/**
 * PRD-M3-006 · 远程连接（TASK-M3-011）
 *
 *   AC-1 `domi --connect ws://host:port` 可用（TUI 那半在 apps/tui/test/connect-remote.spec.ts）
 *   AC-2 默认只监听 127.0.0.1；监听非本地地址必须显式配置，且强制 token 认证
 *   AC-3 无认证连接被拒绝，并产生事件
 *
 * token 走 WebSocket 子协议（`domi` + `domi-token.<token>`）：浏览器的 WebSocket 不能设请求头，
 * 这是它唯一能在握手阶段带凭据的地方；命令行客户端也可以用 Authorization: Bearer。
 * 校验发生在升级之前——没通过的连接连 handshake 都发不出来。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomiClient, type WireSocket } from '@domi/client-core'
import { loadConfig } from '@domi/config'
import { AUTH_SUBPROTOCOL, authProtocols, TOKEN_SUBPROTOCOL_PREFIX } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import {
  AUDIT_SESSION_ID,
  createRuntimeHost,
  Daemon,
  type DaemonHost,
  daemonPaths,
  InvalidTokenError,
  isAlive,
  type RejectedConnection,
  readLock,
  resolveClientToken,
  resolveServerSettings,
  serveWs,
  tokenFromRequest,
  type WsServer,
} from '../src/index.ts'

const MAIN = join(import.meta.dir, '../src/main.ts')
const TOKEN = 'k7Qp2mZx9VbN4cRt8LwY6sJd3HfG5aE1'
const servers: WsServer[] = []
const clients: DomiClient[] = []
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  for (const s of servers.splice(0)) await s.stop()
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-auth-'))
  cleanups.push(() => {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 没有删除权限的挂载
    }
  })
  return d
}

function host(): DaemonHost {
  return {
    async open() {
      throw new Error('不该走到这里')
    },
    async create() {
      return 's1'
    },
    async list() {
      return []
    },
    async remove() {},
    async restore() {},
    async branch() {
      return 's2'
    },
    onEvents() {},
  }
}

function serve(opts: { hostname?: string; token: string | null }) {
  const rejected: RejectedConnection[] = []
  const s = serveWs(new Daemon(host()), { ...opts, port: 0, onRejected: (r) => rejected.push(r) })
  servers.push(s)
  return { s, rejected, url: `ws://127.0.0.1:${s.port}` }
}

async function tryHandshake(connect: () => WebSocket): Promise<'ok' | 'failed'> {
  const c = new DomiClient({ clientName: 't', reconnectMs: 0, connect: () => connect() as unknown as WireSocket })
  clients.push(c)
  const r = await Promise.race([
    c.start().then(
      () => 'ok' as const,
      () => 'failed' as const,
    ),
    Bun.sleep(2000).then(() => 'failed' as const),
  ])
  return r
}

describe('token 的形状', () => {
  test('子协议：先 domi，再带 token 的那一项', () => {
    expect(authProtocols(TOKEN)).toEqual([AUTH_SUBPROTOCOL, `${TOKEN_SUBPROTOCOL_PREFIX}${TOKEN}`])
    expect(authProtocols(undefined)).toEqual([AUTH_SUBPROTOCOL])
    // 子协议只许 token 字符；带空格之类的 token 在客户端就该报错，不是发出去让服务端猜
    expect(() => authProtocols('有 空格')).toThrow()
  })

  test('从请求里取 token：子协议或 Authorization: Bearer', () => {
    const viaProto = new Request('http://x/', { headers: { 'sec-websocket-protocol': `domi, domi-token.${TOKEN}` } })
    expect(tokenFromRequest(viaProto)).toBe(TOKEN)
    const viaHeader = new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(tokenFromRequest(viaHeader)).toBe(TOKEN)
    expect(tokenFromRequest(new Request('http://x/'))).toBeNull()
  })
})

describe('AC-2 · 监听地址与 token 从哪来', () => {
  test('默认配置：127.0.0.1，没有 token', () => {
    const home = tmp()
    const config = loadConfig({ env: { ANTHROPIC_API_KEY: 'x' }, home })
    expect(config.server.host).toBe('127.0.0.1')
    const s = resolveServerSettings({ config, env: {}, home })
    expect(s).toMatchObject({ hostname: '127.0.0.1', port: 7437, token: null })
  })

  test('监听非本地地址又没配 token：生成一个存进 ~/.domi/daemon.token（0600），下次复用', () => {
    const home = tmp()
    const config = loadConfig({ env: { ANTHROPIC_API_KEY: 'x' }, home })
    const a = resolveServerSettings({ config, env: { DOMI_HOST: '0.0.0.0' }, home })
    expect(a.hostname).toBe('0.0.0.0')
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(a.tokenFile).toBe(join(home, '.domi', 'daemon.token'))
    expect(statSync(a.tokenFile as string).mode & 0o777).toBe(0o600)
    const b = resolveServerSettings({ config, env: { DOMI_HOST: '0.0.0.0' }, home })
    expect(b.token).toBe(a.token)
    // 本机客户端能从同一个文件拿到它
    expect(resolveClientToken({ config, env: {}, home })).toBe(a.token as string)
  })

  test('配置或环境变量里给了 token：用它；太短或带怪字符的直接报错', () => {
    const home = tmp()
    mkdirSync(join(home, '.domi'), { recursive: true })
    writeFileSync(join(home, '.domi', 'config.yaml'), `server:\n  host: 0.0.0.0\n  port: 9000\n  token: ${TOKEN}\n`)
    const config = loadConfig({ env: { ANTHROPIC_API_KEY: 'x' }, home })
    const s = resolveServerSettings({ config, env: {}, home })
    expect(s).toMatchObject({ hostname: '0.0.0.0', port: 9000, token: TOKEN })
    expect(existsSync(join(home, '.domi', 'daemon.token'))).toBe(false)
    expect(resolveServerSettings({ config, env: { DOMI_TOKEN: `${TOKEN}x` }, home }).token).toBe(`${TOKEN}x`)
    expect(() => resolveServerSettings({ config, env: { DOMI_TOKEN: 'short' }, home })).toThrow(InvalidTokenError)
    expect(() => resolveServerSettings({ config, env: { DOMI_TOKEN: `${TOKEN} x` }, home })).toThrow(InvalidTokenError)
  })
})

describe('AC-2 / AC-3 · 带 token 的服务端', () => {
  test('非本地地址 + token 可以监听；不带 token 的连接在升级前被 401 挡住，并报出来', async () => {
    const { rejected, url } = serve({ hostname: '0.0.0.0', token: TOKEN })
    expect(await tryHandshake(() => new WebSocket(url))).toBe('failed')
    expect(await tryHandshake(() => new WebSocket(url, authProtocols('wrong-token-wrong-token-wrong')))).toBe('failed')
    expect(rejected.map((r) => r.reason)).toEqual(['missing', 'invalid'])
    expect(rejected[0]?.remote).toMatch(/127\.0\.0\.1/)

    const res = await fetch(url.replace('ws:', 'http:'), {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    expect(res.status).toBe(401)
  })

  test('带对了 token 就能握手：子协议或 Authorization 头都行', async () => {
    const { rejected, url } = serve({ hostname: '0.0.0.0', token: TOKEN })
    expect(await tryHandshake(() => new WebSocket(url, authProtocols(TOKEN)))).toBe('ok')
    const bearer = () => new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } } as never)
    expect(await tryHandshake(bearer)).toBe('ok')
    expect(rejected).toEqual([])
  })

  test('有 token 时不再按 Origin 拦：远程页面要能连，挡人靠的是 token', async () => {
    const { url } = serve({ hostname: '127.0.0.1', token: TOKEN })
    const res = await fetch(url.replace('ws:', 'http:'), {
      headers: {
        Origin: 'http://192.168.1.20:5173',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Protocol': `domi, domi-token.${TOKEN}`,
      },
    })
    expect(res.status).toBe(101)
    expect(res.headers.get('sec-websocket-protocol')).toBe('domi')
  })

  test('本地、没有 token：和以前一样，不要求认证', async () => {
    const { url } = serve({ token: null })
    expect(await tryHandshake(() => new WebSocket(url))).toBe('ok')
    expect(await tryHandshake(() => new WebSocket(url, authProtocols(TOKEN)))).toBe('ok')
  })
})

describe('AC-3 · 被拒的连接落成事件', () => {
  test('RuntimeHost 把拒绝写进审计会话；会话列表里看不到它', async () => {
    const d = tmp()
    const h = createRuntimeHost({
      config: loadConfig({ env: { ANTHROPIC_API_KEY: 'x' }, home: d }),
      dbPath: join(d, 'events.db'),
      defaultCwd: d,
      newId: () => 'real',
    })
    cleanups.push(() => h.close())
    await h.create()
    await h.audit({
      t: 'permission',
      capabilityId: 'daemon.connect',
      decision: 'deny',
      source: 'config',
      matchedRule: 'server.token',
    })
    expect((await h.list({ includeDeleted: true })).map((s) => s.id)).toEqual(['real'])
    const log = new SqliteEventLog({ path: join(d, 'events.db') })
    expect((await log.read(AUDIT_SESSION_ID))[0]?.ev).toMatchObject({ t: 'permission', decision: 'deny' })
    log.close()
  })

  test('真 domid 监听 0.0.0.0：没 token 的连接被拒、落事件；带 token 的连得上', async () => {
    const home = tmp()
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      ANTHROPIC_API_KEY: 'test-not-a-real-key',
      DOMI_PORT: '0',
      DOMI_HOST: '0.0.0.0',
    }
    const p = Bun.spawn(['bun', MAIN], { env, cwd: home, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    cleanups.push(async () => {
      p.kill()
      await p.exited
    })
    const reader = p.stdout.getReader()
    let out = ''
    // 起来时要告诉人 token 在哪（不打印 token 本身：终端输出会进日志）
    while (!out.includes('daemon.token')) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    reader.releaseLock()
    const port = readLock(daemonPaths(home).lock)?.port
    expect(out).toContain(`domid listening ws://0.0.0.0:${port}`)
    expect(out).toContain(join(home, '.domi', 'daemon.token'))
    const token = readFileSync(join(home, '.domi', 'daemon.token'), 'utf8').trim()
    expect(out).not.toContain(token)

    const url = `ws://127.0.0.1:${port}`
    expect(await tryHandshake(() => new WebSocket(url))).toBe('failed')
    expect(await tryHandshake(() => new WebSocket(url, authProtocols(token)))).toBe('ok')

    const log = new SqliteEventLog({ path: join(home, '.domi', 'events.db') })
    let audit = await log.read(AUDIT_SESSION_ID)
    for (let i = 0; i < 50 && audit.length === 0; i++) {
      await Bun.sleep(20)
      audit = await log.read(AUDIT_SESSION_ID)
    }
    expect(audit[0]?.ev).toMatchObject({
      t: 'permission',
      capabilityId: 'daemon.connect',
      decision: 'deny',
      reason: 'missing',
    })
    log.close()
    expect(isAlive(p.pid)).toBe(true)
  }, 20_000)
})
