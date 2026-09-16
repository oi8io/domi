/**
 * 过期写保护 —— PRD-M7-001 AC-2 · SPEC-M7-001 · ADR-024
 *
 * 记「本会话最近一次读到 / 写出的内容」的哈希。覆盖已有文件前比一下磁盘：
 * 读过之后被别人（用户、编辑器、另一个进程）改了，就拒绝，让模型先重读。
 * 不然模型拿着旧内容写回去，用户刚改的东西就没了。
 */
import { createHash } from 'node:crypto'
import type { StampBook } from '../types.ts'

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export class StaleFileError extends Error {
  constructor(readonly path: string) {
    super(`${path} 在你上次读取之后被改过了。先用 fs.read 重新读一遍再改，免得覆盖掉别人的改动。`)
    this.name = 'stale'
  }
}

export class NotReadError extends Error {
  constructor(readonly path: string) {
    super(`${path} 在本会话里还没读过。先用 fs.read 读一遍，再用 fs.edit 改。`)
    this.name = 'not_read'
  }
}

export class FileStamps implements StampBook {
  private readonly seen = new Map<string, string>()

  /** 读到或写出了这份内容 */
  record(absPath: string, content: string): void {
    this.seen.set(absPath, sha256(content))
  }

  has(absPath: string): boolean {
    return this.seen.has(absPath)
  }

  /**
   * 覆盖前检查。current = 磁盘上现在的内容（文件不存在时为 null）。
   * 没读过的文件放行（SPEC 取舍-2）；读过且内容变了 → StaleFileError
   */
  check(absPath: string, current: string | null, displayPath: string): void {
    const known = this.seen.get(absPath)
    if (known === undefined || current === null) return
    if (sha256(current) !== known) throw new StaleFileError(displayPath)
  }
}
