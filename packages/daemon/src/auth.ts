/**
 * 连接认证 —— PRD-M3-006 AC-2 / AC-3 · INV-11 · docs/adr/017
 *
 * 规则只有三条：
 *   1. 默认只监听回环地址，不要求认证（本机其他用户的问题交给 OS 的端口与文件权限）
 *   2. 监听非回环地址**必须**有 token。没配就生成一个，存进 ~/.domi/daemon.token（0600）——
 *      「忘了配 token」不该变成「裸奔」，也不该变成「起不来」
 *   3. 配了 token 就一律校验，回环地址也一样：显式配置的意思就是要它生效
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DomiConfig } from '@domi/config'
import { TOKEN_CHARS, TOKEN_SUBPROTOCOL_PREFIX } from '@domi/protocol'

/** 审计事件写进这个会话。以下划线开头的会话不出现在会话列表里 */
export const AUDIT_SESSION_ID = '_domid'
export const MIN_TOKEN_LENGTH = 24

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopback(hostname: string): boolean {
  return LOOPBACK.has(hostname)
}

export class InvalidTokenError extends Error {
  constructor(source: string) {
    super(
      `${source} 里的 token 不能用：至少 ${MIN_TOKEN_LENGTH} 个字符，只能有字母、数字和 . _ ~ -。` +
        '\n生成一个：openssl rand -base64 32 | tr "+/" "-_" | tr -d "="',
    )
    this.name = 'InvalidTokenError'
  }
}

/** 被拒的一次连接。transport 报出来，由宿主落成事件（AC-3） */
export interface RejectedConnection {
  remote: string
  reason: 'missing' | 'invalid'
  origin: string | null
}

export interface ServerSettings {
  hostname: string
  port: number
  /** null = 不校验（只可能出现在回环地址上） */
  token: string | null
  /** token 是自动生成、存在文件里的，这里是那个文件 */
  tokenFile?: string
  /** 额外允许的浏览器 Origin（本地开发域名经反代） */
  allowedOrigins: readonly string[]
}

interface Sources {
  config: DomiConfig
  env: Record<string, string | undefined>
  /** 用户主目录（不是 ~/.domi） */
  home: string
}

function tokenFilePath(home: string): string {
  return join(home, '.domi', 'daemon.token')
}

function checked(token: string, source: string): string {
  if (token.length < MIN_TOKEN_LENGTH || !TOKEN_CHARS.test(token)) throw new InvalidTokenError(source)
  return token
}

function readTokenFile(path: string): string | null {
  if (!existsSync(path)) return null
  const t = readFileSync(path, 'utf8').trim()
  return t === '' ? null : checked(t, path)
}

export function resolveServerSettings({ config, env, home }: Sources): ServerSettings {
  const hostname = env.DOMI_HOST || config.server.host
  const port = env.DOMI_PORT === undefined || env.DOMI_PORT === '' ? config.server.port : Number(env.DOMI_PORT)
  const allowedOrigins = config.server.allowedOrigins ?? []
  if (env.DOMI_TOKEN) return { hostname, port, token: checked(env.DOMI_TOKEN, 'DOMI_TOKEN'), allowedOrigins }
  if (config.server.token)
    return { hostname, port, token: checked(config.server.token, 'config.yaml 的 server.token'), allowedOrigins }
  if (isLoopback(hostname)) return { hostname, port, token: null, allowedOrigins }

  const tokenFile = tokenFilePath(home)
  const existing = readTokenFile(tokenFile)
  if (existing) return { hostname, port, token: existing, tokenFile, allowedOrigins }
  const token = randomBytes(32).toString('base64url')
  mkdirSync(join(home, '.domi'), { recursive: true })
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
  chmodSync(tokenFile, 0o600) // umask 可能吃掉 mode；再明确设一次
  return { hostname, port, token, tokenFile, allowedOrigins }
}

/** 本机客户端连 domid 时带的 token：环境变量 → 配置 → domid 生成的文件。都没有就不带 */
export function resolveClientToken({ config, env, home }: Sources): string | undefined {
  return env.DOMI_TOKEN || config.server.token || readTokenFile(tokenFilePath(home)) || undefined
}

/** 从升级请求里取 token：子协议或 Authorization: Bearer */
export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  const protos = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim())
  const hit = protos.find((p) => p.startsWith(TOKEN_SUBPROTOCOL_PREFIX))
  return hit ? hit.slice(TOKEN_SUBPROTOCOL_PREFIX.length) : null
}

/** 常数时间比较，长度不同也不提前返回 */
export function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}
