/**
 * PRD-M6-005 AC-4 · L2 不进 CI 门禁（INV-08）
 *
 * L2 要真实模型、要花钱、结果不确定。它一旦进了门禁，红灯就会被当成噪音。
 * 查三处：CI workflow、根 package.json 里被 `check` 串起来的脚本、`pnpm eval`（只许是 L1）。
 *
 * 用法：bun run scripts/check-ci-no-l2.ts [--inject]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const L2 = /\beval\s+l2\b|eval\/l2|runL2\b/
const problems: string[] = []

const WORKFLOWS = join('.github', 'workflows')
const workflows: Array<{ file: string; text: string }> = existsSync(WORKFLOWS)
  ? readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ file: join(WORKFLOWS, f), text: readFileSync(join(WORKFLOWS, f), 'utf8') }))
  : []
if (process.argv.includes('--inject')) {
  workflows.push({
    file: '.github/workflows/injected.yml',
    text: 'steps:\n  - run: bun apps/tui/src/main.tsx eval l2 --rounds 3\n',
  })
}
for (const w of workflows) {
  const code = w.text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
  if (L2.test(code)) problems.push(`${w.file} 里跑了 L2`)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
// 从 check 出发，把它串起来的脚本都展开
const seen = new Set<string>()
const queue = ['check']
while (queue.length > 0) {
  const name = queue.shift() as string
  if (seen.has(name)) continue
  seen.add(name)
  // 排除 L2 的参数（例如 bun test 的 --path-ignore-patterns）不算"跑 L2"
  const body = (pkg.scripts[name] ?? '').replace(/--path-ignore-patterns=\S+/g, '')
  if (L2.test(body)) problems.push(`package.json 的 ${name} 脚本会跑 L2（它被 check 串进了门禁）`)
  for (const m of body.matchAll(/pnpm (?:run )?([\w:-]+)/g)) queue.push(m[1] as string)
}

if (problems.length > 0) {
  for (const p of problems) console.error(`[check-ci-no-l2] ${p}`)
  console.error('\nL2 只进 nightly 或手动运行（PRD-M6-005 AC-4 · INV-08）')
  process.exit(1)
}
console.log(`[check-ci-no-l2] OK —— ${workflows.length} 个 workflow、${seen.size} 个门禁脚本里都没有 L2`)
