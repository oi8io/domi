/**
 * PRD-M2-008 AC-5 · 删掉 packages/eval，kernel 与 store 的测试仍全绿
 *
 * 评估是**旁观者**：它读事件流、驱动内核，但内核不许反过来认识评估。
 * 一旦核心里出现 `import { replay } from '@domi/eval'`，
 * 评估就从旁观者变成了依赖，AC-5 说的「删掉还能跑」立刻不成立，
 * 顺带把 INV-13（评估不新增埋点）也破了 —— 内核开始为评估让路了。
 *
 * 真删一遍目录再跑测试当然最硬，但那会把用户的工作区搞脏；
 * 这里查的是**让删除会失败的唯一原因**：有人从外面引用了它。
 *
 * 两条规则：
 *   1. 核心包（CORE）与三端一律不许提 @domi/eval —— 不管静态还是动态。
 *   2. `packages/cli` 是唯一的接线点（`domi eval` 要能敲出来），但只许**动态 import**：
 *      静态 import 会让「删掉 eval」把整个 `domi` 打死，退化不成一句提示。
 *
 * 用法：bun run scripts/check-eval-isolation.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SELF = join('packages', 'eval')
const PKG_NAME = '@domi/eval'
/** 唯一允许接线的地方，且只许动态 import */
const WIRING = join('packages', 'cli')
/** 被删掉 eval 之后必须还能独立跑测试的核心 —— AC-5 点名的两个在最前面 */
const CORE = [
  'packages/kernel',
  'packages/store',
  'packages/model',
  'packages/protocol',
  'packages/capability',
  'packages/prompt',
  'packages/checkpoint',
  'packages/runtime',
  'packages/client-core',
  'packages/config',
  'packages/observability',
]

function files(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === 'dist') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts') || name.endsWith('.tsx') || name === 'package.json') out.push(p)
    }
  }
  walk(root)
  return out
}

/** 注释里提名字是正常的（写文档要用），只看代码 */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const STATIC_IMPORT = new RegExp(`from\\s+['"\`]${PKG_NAME}['"\`]`)
const REQUIRE = new RegExp(`require\\(\\s*['"\`]${PKG_NAME}['"\`]`)
const DYNAMIC_IMPORT = new RegExp(`import\\(\\s*['"\`]${PKG_NAME}['"\`]`)
const RELATIVE_REACH = /from\s+['"`][./]+\/eval\/src\//
const DYNAMIC_RELATIVE_REACH = /import\(\s*['"`][./]+\/eval\/src\//

const violations: string[] = []

for (const root of ['packages', 'apps', 'scripts']) {
  for (const f of files(root)) {
    if (f.startsWith(SELF)) continue
    const isWiring = f.startsWith(WIRING)
    const text = readFileSync(f, 'utf8')

    if (f.endsWith('package.json')) {
      if (text.includes(`"${PKG_NAME}"`) && !isWiring) violations.push(`${f} 把 ${PKG_NAME} 列成了依赖`)
      continue
    }

    const code = codeOf(text)
    const viaRelative = RELATIVE_REACH.test(code) || DYNAMIC_RELATIVE_REACH.test(code)
    const viaName = STATIC_IMPORT.test(code) || REQUIRE.test(code) || DYNAMIC_IMPORT.test(code)

    if (isWiring) {
      // 接线点：静态 import / require / 相对路径绕行一律不行，只留动态 import
      if (STATIC_IMPORT.test(code)) violations.push(`${f} 静态 import 了 ${PKG_NAME}；接线点只许动态 import`)
      if (REQUIRE.test(code)) violations.push(`${f} require 了 ${PKG_NAME}；接线点只许动态 import`)
      if (viaRelative) violations.push(`${f} 用相对路径绕进了 ${SELF}`)
      continue
    }

    if (viaRelative) violations.push(`${f} 用相对路径绕进了 ${SELF}`)
    else if (viaName) violations.push(`${f} 引用了 ${PKG_NAME}`)
  }
}

// 反向确认：核心包的清单里确实没有 eval —— 有的话删掉它连装都装不上
for (const pkg of CORE) {
  const manifest = join(pkg, 'package.json')
  const text = readFileSync(manifest, 'utf8')
  if (text.includes(PKG_NAME)) violations.push(`${manifest} 依赖了 ${PKG_NAME}，删掉 eval 它就装不起来`)
}

if (violations.length > 0) {
  for (const v of violations) console.error(`[PRD-M2-008 AC-5] ${v}`)
  console.error(
    `\n评估层只能单向依赖内核：${CORE.slice(0, 2).join('、')} 必须在 ${SELF} 被整个删掉后仍然能跑测试。` +
      `\n接线只允许出现在 ${WIRING}，且必须是动态 import —— 否则删掉 eval 会把整个 domi 打死。` +
      '\n反过来依赖的那一刻，内核就开始为评估让路了（INV-13）。',
  )
  process.exit(1)
}
console.log(`[check-eval-isolation] OK —— 核心零引用，接线只在 ${WIRING} 且是动态 import`)
