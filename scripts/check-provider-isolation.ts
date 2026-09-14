/**
 * PRD-M1-001 AC-4 · 新增 provider 只需实现接口 + 注册
 *
 * 判据是「kernel 与 model 的核心文件 diff 为 0」。
 * 换句话说：**有哪些 provider 这件知识，只许存在于 factory.ts 一个地方。**
 * 一旦 kernel 里出现 `if (provider === 'anthropic')`，加第五个 provider 就要改内核。
 *
 * 用法：bun run scripts/check-provider-isolation.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 只有这一个文件允许知道 provider 的名字 */
const ALLOWED = 'packages/model/src/factory.ts'
const PROVIDER_NAMES = ['anthropic', 'openai', 'google', 'openai-compatible'] as const

/** 能力矩阵表按定义就要列出 provider 名 —— 它和 factory 是同一份知识的两半 */
const ALSO_ALLOWED = ['packages/model/src/capability.ts']

const SCAN_ROOTS = ['packages/kernel/src', 'packages/model/src', 'packages/runtime/src', 'packages/capability/src']

function files(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts')) out.push(p)
    }
  }
  walk(root)
  return out
}

const violations: string[] = []
for (const root of SCAN_ROOTS) {
  for (const f of files(root)) {
    if (f === ALLOWED || ALSO_ALLOWED.includes(f)) continue
    const text = readFileSync(f, 'utf8')
    // 只看代码，注释里提 provider 名是正常的（写文档要用）
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const name of PROVIDER_NAMES) {
      const re = new RegExp(`['"\`]${name}['"\`]`)
      if (re.test(code)) violations.push(`${f} 出现了硬编码的 provider 名 "${name}"`)
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`[PRD-M1-001 AC-4] ${v}`)
  console.error(
    `\n「有哪些 provider」这件知识只许存在于 ${ALLOWED}（能力矩阵在 ${ALSO_ALLOWED[0]}）。` +
      '\n否则加第五个 provider 就要改内核，AC-4 说的「只需实现接口 + 注册」就不成立了。',
  )
  process.exit(1)
}
console.log(`[check-provider-isolation] OK —— provider 名只出现在 ${ALLOWED} 与能力矩阵里`)
