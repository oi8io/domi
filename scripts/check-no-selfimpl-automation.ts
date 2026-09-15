/**
 * PRD-M2-009 AC-1 守卫：`packages/` 下不存在任何浏览器或 GUI 自动化的自研实现。
 *
 * browser use / computer use 是 PRD-VISION §6 的第一类——全部交给 MCP server，domi 零实现（ADR-016）。
 * 判据是依赖：不许在 package.json 里依赖、也不许在源码里 import / require 这些库。
 * `apps/` 不在范围内：Web 端的 e2e 会引 Playwright，那是测试工具，不是能力实现。
 *
 * 用法：bun run scripts/check-no-selfimpl-automation.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGES = 'packages'
const FORBIDDEN =
  /^(playwright|playwright-core|@playwright\/.*|puppeteer|puppeteer-core|@nut-tree\/.*|nut-js|robotjs|selenium-webdriver|webdriverio)$/
/** import x from '…' / export … from '…' / require('…') / import('…') */
const SPECIFIERS = /(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g

const violations: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx|js|mjs)$/.test(p) ? [p] : []
  })
}

for (const pkg of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, pkg, 'package.json')
  if (existsSync(manifest)) {
    const json = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, Record<string, string> | undefined>
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(json[field] ?? {})) {
        if (FORBIDDEN.test(dep)) violations.push(`${manifest}  ${field} 里依赖了 ${dep}`)
      }
    }
  }
  const src = join(PACKAGES, pkg, 'src')
  if (!existsSync(src)) continue
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(SPECIFIERS)) {
      const spec = m[1] ?? ''
      const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? '')
      if (FORBIDDEN.test(bare) || FORBIDDEN.test(spec)) {
        const line = text.slice(0, m.index).split('\n').length
        violations.push(`${file}:${line}  引用了 ${spec}`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    '[PRD-M2-009 AC-1] packages/ 下出现了浏览器 / GUI 自动化的自研实现（应交给 MCP server，见 docs/adr/016）：',
  )
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log('[check-no-selfimpl-automation] OK —— packages/ 下没有浏览器 / GUI 自动化依赖')
