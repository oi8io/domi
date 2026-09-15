/**
 * PRD-M6-004 AC-4 · 贡献入口齐全
 *
 * 本地能查的两件：CONTRIBUTING.md 存在且写了规矩；good first issue 草稿不少于 5 个。
 * 「仓库里开着 ≥5 个 issue」要查 GitHub——装了 gh 且设了 DOMI_CHECK_GITHUB=1 时才查（CI 里不联网，INV-08 同一个立场）。
 *
 * 用法：bun run scripts/check-repo-meta.ts [--inject]
 */
import { existsSync, readFileSync } from 'node:fs'

const inject = process.argv.includes('--inject')
const problems: string[] = []

const contributing = inject ? '' : existsSync('CONTRIBUTING.md') ? readFileSync('CONTRIBUTING.md', 'utf8') : ''
if (contributing === '') problems.push('缺少 CONTRIBUTING.md')
else
  for (const must of ['pnpm check', 'PRD', '测试先行', 'plugin scaffold']) {
    if (!contributing.includes(must)) problems.push(`CONTRIBUTING.md 没提到「${must}」`)
  }

const drafts = existsSync('docs/good-first-issues.md') ? readFileSync('docs/good-first-issues.md', 'utf8') : ''
const count = (drafts.match(/^## \d+\. /gm) ?? []).length
if (count < 5) problems.push(`docs/good-first-issues.md 里只有 ${count} 个草稿（至少 5 个）`)

if (process.env.DOMI_CHECK_GITHUB === '1') {
  const r = Bun.spawnSync(['gh', 'issue', 'list', '--label', 'good first issue', '--state', 'open', '--json', 'number'])
  const open = r.exitCode === 0 ? (JSON.parse(new TextDecoder().decode(r.stdout)) as unknown[]).length : -1
  if (open < 5) problems.push(`GitHub 上开着的 good first issue 只有 ${open < 0 ? '（查不到）' : open} 个`)
}

if (problems.length > 0) {
  for (const p of problems) console.error(`[check-repo-meta] ${p}`)
  process.exit(1)
}
console.log(`[check-repo-meta] OK —— CONTRIBUTING.md 齐全，${count} 个 good first issue 草稿`)
