/**
 * 路径收口 —— PRD-M0-003 AC-5 · SPEC-M0-005
 *
 * **全项目只有这一个地方做路径校验。**
 * 第二处实现出现的那天，就是两处不一致、攻击从缝里进来的那天。
 */
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export class PathEscapeError extends Error {
  constructor(
    readonly attempted: string,
    readonly why: string,
  ) {
    super(`路径越界：${attempted}（${why}）`)
    this.name = 'PathEscapeError'
  }
}

/**
 * 把 p 解析到 root 之内，越界抛错。
 *
 * 顺序有讲究：先挡掉那些"根本不该出现在路径里"的字符，再 resolve，最后 realpath。
 * realpath 放在最后是因为它才能识破符号链接——只做字符串 resolve 的实现，
 * 会被一个指向 /etc 的软链接直接绕过去。
 */
export function resolveWithinRoot(root: string, p: string): string {
  if (p.includes('\0')) throw new PathEscapeError(p, 'NUL 截断')
  if (p.startsWith('~')) throw new PathEscapeError(p, '不做 ~ 展开，请给相对或绝对路径')
  if (p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p)) throw new PathEscapeError(p, 'UNC / 盘符路径')
  if (/%2e%2e|%2f|%5c/i.test(p)) throw new PathEscapeError(p, 'URL 编码的路径分隔符')

  const rootReal = realpathSync(root)
  const target = isAbsolute(p) ? p : resolve(rootReal, p)

  // 目标可能还不存在（fs.write 新建文件），那就 realpath 它最近的存在的祖先
  let probe = target
  let real: string
  for (;;) {
    try {
      real = realpathSync(probe)
      break
    } catch {
      const parent = resolve(probe, '..')
      if (parent === probe) throw new PathEscapeError(p, '无法解析到任何存在的祖先目录')
      probe = parent
    }
  }
  const realTarget = probe === target ? real : resolve(real, relative(probe, target))

  const rel = relative(rootReal, realTarget)
  if (rel === '') return realTarget
  if (rel.startsWith('..') || isAbsolute(rel)) throw new PathEscapeError(p, '解析后落在工作目录之外')
  return realTarget
}
