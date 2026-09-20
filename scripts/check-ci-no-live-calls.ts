/**
 * INV-08 守卫 · 真实 LLM 调用不进 CI 门禁
 *
 * INV-08 到今天为止只靠「大家记得」——这是一条不变量里最不该有的状态。
 * 这个守卫把它变成机器判定：
 *
 *   1. 会发真实模型请求的脚本，**自己在注释里声明** `INV-08-LIVE`
 *   2. `.github/workflows/` 里任何一步都不许跑这些脚本
 *   3. CI 里也不许出现模型凭据的环境变量名（注入了 key 就等于给了开火权限）
 *
 * 声明式的好处是：新写一个会花钱的脚本时，作者只需要加一个标记，
 * 而不需要知道这条守卫存在。忘了加标记的情况由第 3 条兜底——
 * 没有 key 的话，脚本在 CI 里本来也打不出去。
 *
 * 用法：bun run scripts/check-ci-no-live-calls.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPTS = 'scripts'
const WORKFLOWS = join('.github', 'workflows')
const MARKER = 'INV-08-LIVE'

/** 注入其中任何一个，CI 就具备了真实调用的能力 */
const CREDENTIAL_ENVS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']

const live = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.sh'))
  .filter((f) => readFileSync(join(SCRIPTS, f), 'utf8').includes(MARKER))
  // 守卫自己提到这个标记是必须的，不算
  .filter((f) => f !== 'check-ci-no-live-calls.ts')

const violations: string[] = []

if (existsSync(WORKFLOWS)) {
  for (const wf of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    const path = join(WORKFLOWS, wf)
    const text = readFileSync(path, 'utf8')
    // 注释里说明「这里不跑它」是正常的，只看没被注释掉的行
    const code = text
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')

    for (const f of live) {
      if (code.includes(f)) violations.push(`${path} 跑了会发真实请求的 ${SCRIPTS}/${f}`)
    }
    for (const env of CREDENTIAL_ENVS) {
      if (code.includes(env)) violations.push(`${path} 里出现了模型凭据环境变量 ${env}`)
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`[INV-08] ${v}`)
  console.error(
    '\nINV-08：真实 LLM 调用不进 CI 门禁。' +
      '\n门禁一旦依赖真实模型，它就会因为别人的服务抖动而红——' +
      '\n红了几次之后大家学会的是忽略红灯，那比没有门禁更糟。' +
      `\n要跑真实调用，放 nightly 或让人手动跑（${live.map((f) => `${SCRIPTS}/${f}`).join('、') || '例如 measure-cache'}）。`,
  )
  process.exit(1)
}
console.log(
  `[check-ci-no-live-calls] OK —— ${live.length} 个会发真实请求的脚本（${live.join('、') || '无'}）都没有进 CI，且 CI 里没有模型凭据`,
)
