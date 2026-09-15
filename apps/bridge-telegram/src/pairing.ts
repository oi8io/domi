/**
 * 绑定 —— PRD-M5-007 AC-4
 *
 * `domi bridge pair` 生成一次性配对码（5 分钟过期、用一次作废），在 Telegram 里发 `/pair <码>` 完成绑定。
 * 状态是一个很小的 JSON 文件：两个进程（生成码的 CLI、跑着的桥接）都读写它。
 */
import { randomInt } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const PAIRING_TTL_MS = 5 * 60 * 1000

export interface BridgeState {
  chats: number[]
  pairing?: { code: string; expiresAt: number }
}

export function readState(path: string): BridgeState {
  if (!existsSync(path)) return { chats: [] }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<BridgeState>
    return {
      chats: Array.isArray(raw.chats) ? raw.chats.filter((c): c is number => typeof c === 'number') : [],
      ...(raw.pairing && typeof raw.pairing.code === 'string' ? { pairing: raw.pairing } : {}),
    }
  } catch {
    return { chats: [] }
  }
}

export function writeState(path: string, st: BridgeState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

export function newPairingCode(path: string, now: number): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const st = readState(path)
  writeState(path, { ...st, pairing: { code, expiresAt: now + PAIRING_TTL_MS } })
  return code
}

export type PairResult = 'paired' | 'already' | 'expired' | 'wrong' | 'none'

/** 核对配对码。成功后码作废（不管对不对，过期的也清掉） */
export function tryPair(path: string, chatId: number, code: string, now: number): PairResult {
  const st = readState(path)
  if (st.chats.includes(chatId)) return 'already'
  const p = st.pairing
  if (!p) return 'none'
  if (now > p.expiresAt) {
    writeState(path, { chats: st.chats })
    return 'expired'
  }
  if (code.trim() !== p.code) return 'wrong'
  writeState(path, { chats: [...st.chats, chatId] })
  return 'paired'
}

export function isAllowed(path: string, chatId: number): boolean {
  return readState(path).chats.includes(chatId)
}
