/**
 * 附件 —— PRD-M8-010 AC-3 · SPEC-M8-010
 *
 * 存到 `~/.domi/attachments/<会话>/<id>`，旁边一个 `<id>.json` 记名字、类型、大小、摘要。
 * 事件里只存引用（user.input.uploads），内容按需读：图片给 base64，文本给正文，其余照实说读不了。
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import type { LoadedUpload } from '@domi/kernel'
import type { UploadRef } from '@domi/protocol'

/** 单个附件默认上限 */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
/** 文本附件最多读多少进上下文 */
const TEXT_LIMIT = 200_000

export class AttachmentError extends KeyedError {
  constructor(
    key: MessageKey,
    params: Params,
    readonly reason: 'TOO_LARGE' | 'NOT_FOUND' | 'UNSUPPORTED_ATTACHMENT' | 'INVALID',
  ) {
    super(key, params)
    this.name = 'AttachmentError'
  }
}

export const isImage = (mime: string): boolean => /^image\/(png|jpe?g|gif|webp)$/i.test(mime)

const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonl|ya?ml|toml|csv|tsv|log|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sh|sql|ini|env|diff|patch)$/i
export const isText = (name: string, mime: string): boolean =>
  mime.startsWith('text/') || /json|xml|yaml|javascript|typescript/.test(mime) || TEXT_EXT.test(name)

export function attachmentsDir(domiHome: string, sessionId: string): string {
  return join(domiHome, 'attachments', sessionId)
}

export class AttachmentStore {
  constructor(
    private readonly domiHome: string,
    private readonly maxBytes = DEFAULT_ATTACHMENT_MAX_BYTES,
  ) {}

  put(sessionId: string, file: { name: string; mime: string; data: Uint8Array }): UploadRef & { sha256: string } {
    if (file.data.byteLength > this.maxBytes) {
      throw new AttachmentError(
        'error.attachment.tooLarge',
        {
          name: file.name,
          sizeMB: (file.data.byteLength / 1024 / 1024).toFixed(1),
          maxMB: Math.round(this.maxBytes / 1024 / 1024),
        },
        'TOO_LARGE',
      )
    }
    const name = file.name.replace(/[/\\]/g, '_').slice(0, 200) || 'file'
    const dir = attachmentsDir(this.domiHome, sessionId)
    mkdirSync(dir, { recursive: true })
    const id = `up-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
    const sha256 = createHash('sha256').update(file.data).digest('hex')
    writeFileSync(join(dir, id), file.data, { mode: 0o600 })
    const ref = { id, name, mime: file.mime || 'application/octet-stream', size: file.data.byteLength }
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...ref, sha256 }), { mode: 0o600 })
    return { ...ref, sha256 }
  }

  /** 这个会话里有没有这个附件（提交前校验）。id 只许自己发的格式，防路径穿越 */
  get(sessionId: string, id: string): UploadRef {
    if (!/^up-[a-z0-9]+$/.test(id)) throw new AttachmentError('error.attachment.badId', { id }, 'INVALID')
    const meta = join(attachmentsDir(this.domiHome, sessionId), `${id}.json`)
    if (!existsSync(meta)) throw new AttachmentError('error.attachment.notFound', { id }, 'NOT_FOUND')
    const m = JSON.parse(readFileSync(meta, 'utf8')) as UploadRef
    return { id: m.id, name: m.name, mime: m.mime, size: m.size }
  }

  /** 拼上下文时读内容 */
  load(sessionId: string, ref: UploadRef, opts: { vision: boolean }): LoadedUpload | undefined {
    if (!/^up-[a-z0-9]+$/.test(ref.id)) return undefined
    const file = this.locate(sessionId, ref.id)
    if (file === null) return undefined
    if (isImage(ref.mime)) return opts.vision ? { base64: readFileSync(file).toString('base64') } : {}
    if (isText(ref.name, ref.mime)) {
      const size = statSync(file).size
      const text = readFileSync(file, 'utf8')
      return {
        text: size > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…（太长，只放了前 ${TEXT_LIMIT} 个字符）` : text,
      }
    }
    return {}
  }

  /** 先找本会话；分支会话的历史里是父会话传的，按 id 在别的会话目录里找（id 全局唯一） */
  private locate(sessionId: string, id: string): string | null {
    const own = join(attachmentsDir(this.domiHome, sessionId), id)
    if (existsSync(own)) return own
    const root = join(this.domiHome, 'attachments')
    if (!existsSync(root)) return null
    for (const d of readdirSync(root)) {
      const f = join(root, d, id)
      if (existsSync(f)) return f
    }
    return null
  }
}
