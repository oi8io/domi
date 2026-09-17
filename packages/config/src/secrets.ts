/**
 * 凭据文件 —— PRD-M8-011 AC-4 · SPEC-M8-011
 *
 * ~/.domi/secrets.yaml，权限 0600。形状和 config.yaml 里对应的那一段一样：
 *   providers:
 *     anthropic: { api_key: sk-ant-… }
 * 设置页只往这里写 key，不往 config.yaml 写——config.yaml 常被人拷来拷去、贴进 issue。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ConfigParseError } from './errors.ts'

export const SECRETS_FILE = 'secrets.yaml'

export function secretsPath(domiHome: string): string {
  return join(domiHome, SECRETS_FILE)
}

export type Secrets = { providers?: Record<string, { api_key?: string }> }

export function readSecrets(path: string): Secrets {
  if (!existsSync(path)) return {}
  let raw: unknown
  try {
    raw = Bun.YAML.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new ConfigParseError(path, e instanceof Error ? e.message : String(e))
  }
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigParseError(path, '顶层必须是键值映射')
  return raw as Secrets
}

/** 权限比 0600 宽（组或其他人可读）。doctor 标红，读取照常 */
export function secretsTooOpen(path: string): boolean {
  if (!existsSync(path) || process.platform === 'win32') return false
  return (statSync(path).mode & 0o077) !== 0
}

/** 先写临时文件（0600）再改名：写一半断电也不会留下半个 key 文件 */
export function writeSecrets(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

/** 给人看的掩码：前缀 + … + 末 4 位；太短的只露末 2 位 */
export function maskSecret(v: string): string {
  if (v.length <= 8) return `…${v.slice(-2)}`
  const dash = v.indexOf('-', 2)
  const prefix = dash > 0 && dash <= 7 ? v.slice(0, dash + 1) : v.slice(0, 3)
  return `${prefix}…${v.slice(-4)}`
}
