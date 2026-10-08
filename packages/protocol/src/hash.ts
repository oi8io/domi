/**
 * 轻量字符串哈希 —— SPEC-M15-001（前缀指纹）。
 *
 * FNV-1a 32：确定性、无依赖、不碰 node:crypto（client-core 要投影它，浏览器里没有 node:crypto）。
 * 用途：前缀指纹（model.request.fingerprint）与项目 id 的 cwd stable hash。
 * **不是密码学哈希**——只用于「同与不同」的判断，不用于安全场景。
 */

/** FNV-1a 32 位，hex（8 位小写）。空串也有确定输出。 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
