/**
 * PRD-M5-005 AC-3 · 桌面端除打包与更新外没有业务代码（INV-02）
 *
 * 两个判据：
 *   1. apps/desktop 下 TS / TSX / Rust 源码总行数 < 500
 *   2. 不依赖 packages/kernel、packages/store（package.json 与 import 都查）
 *
 * 用法：bun run scripts/check-desktop-size.ts [--inject]
 *   --inject：在内存里多算一个 600 行的文件、一条 @domi/store 依赖，证明这道守卫会红
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join('apps', 'desktop')
const LIMIT = 500
const FORBIDDEN = /@domi\/(kernel|store)\b|packages\/(kernel|store)\//
const SKIP = new Set(['node_modules', 'target', 'gen', 'dist'])

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|rs)$/.test(e)) out.push(p)
  }
}

if (!existsSync(ROOT)) {
  console.error(`[check-desktop-size] 找不到 ${ROOT}`)
  process.exit(1)
}

const files: string[] = []
walk(ROOT, files)
const sources = files.map((f) => ({ file: relative('.', f), text: readFileSync(f, 'utf8') }))
const manifests = [join(ROOT, 'package.json')]
  .filter(existsSync)
  .map((f) => ({ file: f, text: readFileSync(f, 'utf8') }))

if (process.argv.includes('--inject')) {
  sources.push({ file: 'apps/desktop/src/injected.ts', text: 'x\n'.repeat(600) })
  manifests.push({ file: 'apps/desktop/package.json（注入）', text: '{"dependencies":{"@domi/store":"workspace:*"}}' })
}

const lines = sources.reduce((n, s) => n + s.text.split('\n').filter((l) => l.trim() !== '').length, 0)
const bad = [...sources, ...manifests].filter((s) => FORBIDDEN.test(s.text)).map((s) => s.file)

let failed = false
if (lines >= LIMIT) {
  console.error(
    `[check-desktop-size] apps/desktop 有 ${lines} 行源码（上限 ${LIMIT}）。桌面端只该是一层壳，业务放进 daemon`,
  )
  failed = true
}
if (bad.length > 0) {
  console.error(`[check-desktop-size] 桌面端依赖了 kernel / store：${bad.join('、')}`)
  failed = true
}
if (failed) process.exit(1)
console.log(`[check-desktop-size] OK —— ${sources.length} 个源文件共 ${lines} 行，不依赖 kernel / store`)
