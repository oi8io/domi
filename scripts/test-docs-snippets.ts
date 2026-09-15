/**
 * PRD-M6-004 AC-3 · 文档里的代码示例真的能跑
 *
 * 规则：docs/site/*.md 里标成 ```ts run 的代码块会被抽出来、写进临时文件、用 bun 执行，退出码非 0 就红。
 * 每篇文档至少要有一个可执行的例子——没有的话这道守卫就是空转。
 *
 * 用法：bun run scripts/test-docs-snippets.ts [--inject]
 *   --inject：多塞一个会失败的片段，证明这道守卫会红
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join('docs', 'site')
const REQUIRED = ['quickstart.md', 'architecture.md', 'plugin-dev.md', 'skill-writing.md']

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'))
const missing = REQUIRED.filter((f) => !files.includes(f))
if (missing.length > 0) {
  console.error(`[test-docs-snippets] 文档站缺少：${missing.join('、')}`)
  process.exit(1)
}

const snippets: Array<{ file: string; index: number; code: string }> = []
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8')
  const blocks = [...text.matchAll(/```ts run\n([\s\S]*?)```/g)].map((m) => m[1] as string)
  if (REQUIRED.includes(f) && blocks.length === 0) {
    console.error(`[test-docs-snippets] ${f} 里没有可执行的例子（\`\`\`ts run）`)
    process.exit(1)
  }
  blocks.forEach((code, index) => {
    snippets.push({ file: f, index, code })
  })
}
if (process.argv.includes('--inject')) {
  snippets.push({
    file: 'injected.md',
    index: 0,
    code: "import assert from 'node:assert/strict'\nassert.equal(1 + 1, 3)\n",
  })
}

const work = join(tmpdir(), `domi-doc-snippets-${process.pid}`)
mkdirSync(work, { recursive: true })
let failed = 0
for (const s of snippets) {
  const path = join(work, `${s.file.replace(/\W/g, '_')}-${s.index}.ts`)
  writeFileSync(path, s.code, 'utf8')
  const r = Bun.spawnSync([process.execPath, path], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (r.exitCode !== 0) {
    failed++
    console.error(
      `[test-docs-snippets] ${s.file} 的第 ${s.index + 1} 个例子跑不通：\n${new TextDecoder().decode(r.stderr).trim().split('\n').slice(-6).join('\n')}`,
    )
  }
}
if (failed > 0) process.exit(1)
console.log(`[test-docs-snippets] OK —— ${snippets.length} 个例子全部跑通（${files.length} 篇文档）`)
