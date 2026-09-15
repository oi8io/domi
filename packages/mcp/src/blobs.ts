/**
 * 二进制结果落盘 —— PRD-M2-009 AC-2：截图、音频这类数据不进事件流正文，只存引用。
 * 内容寻址（sha256），同一张图只存一份；目录在 ~/.domi 下（PRD-M1-010 AC-4 的写入边界）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BlobRef {
  blob: string
  bytes: number
}

export function storeBlob(dir: string, base64: string): BlobRef {
  const data = Buffer.from(base64, 'base64')
  const hash = createHash('sha256').update(data).digest('hex')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, hash)
  if (!existsSync(file)) writeFileSync(file, data)
  return { blob: `sha256:${hash}`, bytes: data.length }
}

/** 把 MCP 的内容块里的二进制换成引用；文本原样保留 */
export function externalizeContent(dir: string, content: readonly unknown[]): unknown[] {
  return content.map((block) => {
    const b = block as Record<string, unknown>
    if ((b.type === 'image' || b.type === 'audio') && typeof b.data === 'string') {
      const { data, ...rest } = b
      return { ...rest, ...storeBlob(dir, data) }
    }
    if (b.type === 'resource' && b.resource && typeof (b.resource as Record<string, unknown>).blob === 'string') {
      const { blob, ...res } = b.resource as Record<string, unknown>
      return { ...b, resource: { ...res, ...storeBlob(dir, blob as string) } }
    }
    return b
  })
}
