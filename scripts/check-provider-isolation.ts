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

/**
 * 「有哪些厂商」只许写在厂商模板里（PRD-M9-002 AC-2 · SPEC-M9-002 取舍-1）。
 * factory 按适配器选 SDK、probe 按协议拼请求——适配器 / 协议的名字恰好与两个厂商同名，这两处也放行
 */
const ALLOWED = 'packages/config/src/vendors.ts'
const ALSO_ALLOWED = ['packages/model/src/factory.ts', 'packages/model/src/probe.ts']
const PROVIDER_NAMES = ['anthropic', 'openai', 'google', 'gemini', 'deepseek', 'openai-compatible'] as const

/**
 * 扫描范围（v1.12 扩大）：原来只扫 kernel / model / runtime / capability，
 * 结果厂商名单在 config（环境变量表、设置页白名单）与 Web 设置页各长出一份——守卫看不见的地方就会腐蚀
 */
const SCAN_ROOTS = [
  'packages/kernel/src',
  'packages/model/src',
  'packages/runtime/src',
  'packages/capability/src',
  'packages/config/src',
  'packages/daemon/src',
  'packages/cli/src',
  'packages/client-core/src',
  'apps/web/src',
  'apps/tui/src',
]

function files(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p)
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
    `\n「有哪些厂商」这件知识只许存在于 ${ALLOWED}（适配器选择在 ${ALSO_ALLOWED.join('、')}）。` +
      '\n否则加一家厂商就要改一串文件，PRD-M1-001 AC-4 说的「只需实现接口 + 注册」就不成立了。',
  )
  process.exit(1)
}
console.log(`[check-provider-isolation] OK —— 厂商名只出现在 ${ALLOWED} 与适配器选择里`)
