/**
 * 旁观者隔离 —— PRD-M2-008 AC-5 与 PRD-M2-005 AC-4
 *
 * 两条 AC 是同一句话的两次出现：
 *   - M2-008 AC-5：删掉 `packages/eval` 后 kernel 与 store 的测试仍全绿
 *   - M2-005 AC-4：删掉 `packages/trace` 后 kernel 与 store 的测试仍全绿
 * 所以它们由**同一份实现**来守（PRD 里 M2-005 写的是 `check-trace-decoupling.sh`，
 * 回写理由见 docs/spec/M2.md 取舍-8：同一条规则写两遍，迟早只有一遍是对的）。
 *
 * 评估与轨迹都是**旁观者**：它们读事件流，但主干不许反过来认识它们。
 * 一旦核心里出现 `import { replay } from '@domi/eval'`，
 * 旁观者就变成了依赖，「删掉还能跑」立刻不成立，
 * 顺带把 INV-13（不为观察新增埋点）也破了 —— 内核开始为观察者让路了。
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

/** 被守着的旁观者包：目录名 → 包名 */
const OBSERVERS = [
  { dir: 'eval', pkg: '@domi/eval', ac: 'PRD-M2-008 AC-5' },
  { dir: 'trace', pkg: '@domi/trace', ac: 'PRD-M2-005 AC-4' },
] as const
/** 唯一允许接线的地方，且只许动态 import */
const WIRING = join('packages', 'cli')
/** 旁观者被整个删掉之后，必须还能独立跑测试的核心 —— 两条 AC 点名的两个在最前面 */
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

/** 注释里提名字是正常的（写文档要用），只看代码 —— codeOf 已经把注释剥掉了 */
function patterns(pkg: string, dir: string) {
  return {
    staticImport: new RegExp(`from\\s+['"\`]${pkg}['"\`]`),
    require: new RegExp(`require\\(\\s*['"\`]${pkg}['"\`]`),
    dynamicImport: new RegExp(`import\\(\\s*['"\`]${pkg}['"\`]`),
    relative: new RegExp(`from\\s+['"\`][./]+/${dir}/src/`),
    dynamicRelative: new RegExp(`import\\(\\s*['"\`][./]+/${dir}/src/`),
  }
}

const violations: string[] = []

/**
 * 旁观者之间互相认识是允许的 —— 它们是平级的观察层，
 * 而两条 AC 管的都是「核心还能不能独立跑」。
 * 实际的用处：守卫自己的红 fixture 测试就住在旁观者包里，
 * 那些文件里必然出现违规写法，不豁免的话守卫会被自己的测试判定为红。
 */
const OBSERVER_DIRS = OBSERVERS.map((o) => join('packages', o.dir))

for (const ob of OBSERVERS) {
  const self = join('packages', ob.dir)
  const re = patterns(ob.pkg, ob.dir)

  for (const root of ['packages', 'apps', 'scripts']) {
    for (const f of files(root)) {
      if (OBSERVER_DIRS.some((d) => f.startsWith(d))) continue
      const isWiring = f.startsWith(WIRING)
      const text = readFileSync(f, 'utf8')

      if (f.endsWith('package.json')) {
        if (text.includes(`"${ob.pkg}"`) && !isWiring) violations.push(`[${ob.ac}] ${f} 把 ${ob.pkg} 列成了依赖`)
        continue
      }

      const code = codeOf(text)
      const viaRelative = re.relative.test(code) || re.dynamicRelative.test(code)
      const viaName = re.staticImport.test(code) || re.require.test(code) || re.dynamicImport.test(code)

      if (isWiring) {
        // 接线点：静态 import / require / 相对路径绕行一律不行，只留动态 import
        if (re.staticImport.test(code))
          violations.push(`[${ob.ac}] ${f} 静态 import 了 ${ob.pkg}；接线点只许动态 import`)
        if (re.require.test(code)) violations.push(`[${ob.ac}] ${f} require 了 ${ob.pkg}；接线点只许动态 import`)
        if (viaRelative) violations.push(`[${ob.ac}] ${f} 用相对路径绕进了 ${self}`)
        continue
      }

      if (viaRelative) violations.push(`[${ob.ac}] ${f} 用相对路径绕进了 ${self}`)
      else if (viaName) violations.push(`[${ob.ac}] ${f} 引用了 ${ob.pkg}`)
    }
  }

  // 反向确认：核心包的清单里确实没有它 —— 有的话删掉它连装都装不上
  for (const pkg of CORE) {
    const manifest = join(pkg, 'package.json')
    if (readFileSync(manifest, 'utf8').includes(ob.pkg))
      violations.push(`[${ob.ac}] ${manifest} 依赖了 ${ob.pkg}，删掉它就装不起来`)
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(v)
  console.error(
    `\n旁观者只能单向依赖内核：${CORE.slice(0, 2).join('、')} 必须在 ${OBSERVERS.map((o) => `packages/${o.dir}`).join(' / ')} ` +
      '被整个删掉后仍然能跑测试。' +
      `\n接线只允许出现在 ${WIRING}，且必须是动态 import —— 否则删掉它会把整个 domi 打死。` +
      '\n反过来依赖的那一刻，内核就开始为观察者让路了（INV-13）。',
  )
  process.exit(1)
}
console.log(
  `[check-observer-isolation] OK —— ${OBSERVERS.map((o) => o.pkg).join(' / ')} 核心零引用，接线只在 ${WIRING} 且是动态 import`,
)
