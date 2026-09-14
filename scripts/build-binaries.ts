/**
 * 单二进制产物 —— PRD-M1-008 AC-1 / AC-2
 *
 * AC-2 要的是「在**没有 Node** 的干净容器里能跑起来」，所以用 `bun build --compile`：
 * 产物自带运行时，不依赖机器上有 node / bun。
 *
 * 四个平台在 CI 上一次性出全（AC-2 点名 macOS arm64/x64、Linux x64/arm64）；
 * 本地默认只出当前平台，因为交叉编译要下载对应平台的 bun 运行时，动辄几百 MB。
 *
 * 用法：
 *   bun run scripts/build-binaries.ts            只出当前平台（快）
 *   bun run scripts/build-binaries.ts --all      出全四个平台（CI 用）
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ENTRY = 'apps/tui/src/main.tsx'
const OUT_DIR = 'dist'

/** AC-2 点名的四个平台 */
export const TARGETS: ReadonlyArray<{ target: Bun.Build.CompileTarget; name: string }> = [
  { target: 'bun-darwin-arm64', name: 'domi-darwin-arm64' },
  { target: 'bun-darwin-x64', name: 'domi-darwin-x64' },
  { target: 'bun-linux-x64', name: 'domi-linux-x64' },
  { target: 'bun-linux-arm64', name: 'domi-linux-arm64' },
]

/**
 * ink 静态 import 了 react-devtools-core（只在 DEV=true 时才真用）。
 * 不打桩的话打包直接失败；打进去的话为一个开发期通道多背一个依赖。
 */
const stubDevtools: import('bun').BunPlugin = {
  name: 'stub-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: join(process.cwd(), 'scripts', 'stubs', 'react-devtools-core.ts'),
    }))
  },
}

async function buildOne(target: Bun.Build.CompileTarget | undefined, outfile: string): Promise<void> {
  const started = Date.now()
  const result = await Bun.build({
    entrypoints: [ENTRY],
    plugins: [stubDevtools],
    compile: target === undefined ? { outfile } : { target, outfile },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`构建失败：${outfile}`)
  }
  const size = Bun.file(outfile).size
  console.log(`[build] ${outfile}  ${(size / 1024 / 1024).toFixed(1)}MB  ${Date.now() - started}ms`)
}

if (import.meta.main) {
  mkdirSync(OUT_DIR, { recursive: true })
  const all = process.argv.includes('--all')
  if (all) {
    for (const t of TARGETS) await buildOne(t.target, join(OUT_DIR, t.name))
  } else {
    await buildOne(undefined, join(OUT_DIR, 'domi'))
  }
}
