/**
 * 懒加载 TypeScript —— SPEC-M7-007 取舍-9
 *
 * 它有好几 MB，只在第一次调用 code.* 时才加载，冷启动不受影响（NFR-01）。
 * 优先用**项目自己的** typescript（版本与项目一致，lib 文件也在磁盘上）；项目里没有才用随包的。
 */
import type * as TS from 'typescript'

export type TsModule = typeof TS

const cache = new Map<string, Promise<TsModule>>()
let bundled: Promise<TsModule> | null = null

function loadBundled(): Promise<TsModule> {
  bundled ??= import('typescript').then((m) => ((m as { default?: TsModule }).default ?? m) as TsModule)
  return bundled
}

/** 项目目录下能解析到的 typescript；解析不到返回随包的 */
export function loadTypeScript(projectDir: string): Promise<TsModule> {
  let path: string | null = null
  try {
    path = Bun.resolveSync('typescript', projectDir)
  } catch {
    path = null
  }
  // 只认项目 node_modules 里装的；Bun 的自动安装会解析到缓存里的任意版本（比如没有 JS API 的 TypeScript 7）
  if (path !== null && !/[\\/]node_modules[\\/]typescript[\\/]/.test(path)) path = null
  if (path === null) return loadBundled()
  const hit = cache.get(path)
  if (hit) return hit
  const p = import(path)
    .then((m) => {
      const mod = ((m as { default?: TsModule }).default ?? m) as TsModule
      // 项目里的版本没有编译器 API（或太老）时用随包的
      return typeof mod.createLanguageService === 'function' && typeof mod.findConfigFile === 'function'
        ? mod
        : loadBundled()
    })
    .catch(() => loadBundled())
  cache.set(path, p)
  return p
}

export const SUPPORTED_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i

export function isSupported(path: string): boolean {
  return SUPPORTED_EXT.test(path)
}
