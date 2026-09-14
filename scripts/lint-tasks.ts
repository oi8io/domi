/**
 * INV-10 守卫：每个交付任务必须反向引用一条 PRD 条目 ID。
 * 用法：bun run scripts/lint-tasks.ts   （CI 阻断）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TASK_DIR = 'docs/tasks'
const PRD_FILE = 'docs/PRD.md'

const prdIds = new Set(Array.from(readFileSync(PRD_FILE, 'utf8').matchAll(/^### (PRD-M\d+-\d+)/gm), (m) => m[1]!))

let failures = 0
const files = readdirSync(TASK_DIR).filter((f) => f.endsWith('.md'))
if (files.length === 0) console.warn(`[lint-tasks] ${TASK_DIR} 下没有任务文件`)

for (const file of files) {
  const text = readFileSync(join(TASK_DIR, file), 'utf8')
  const blocks = text.split(/^### (?=TASK-)/m).slice(1)
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf('\n')).trim()
    const prdLine = block.match(/^- prd:\s*(.+)$/m)
    if (!prdLine) {
      console.error(`[INV-10] ${file} · ${id}：缺少 prd: 字段`)
      failures++
      continue
    }
    const refs = Array.from(prdLine[1]!.matchAll(/PRD-M\d+-\d+/g), (m) => m[0])
    if (refs.length === 0) {
      console.error(`[INV-10] ${file} · ${id}：prd: 字段中没有合法的 PRD-ID`)
      failures++
      continue
    }
    for (const ref of refs) {
      if (!prdIds.has(ref)) {
        console.error(`[INV-10] ${file} · ${id}：引用了不存在的 ${ref}`)
        failures++
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n[lint-tasks] ${failures} 处违反 INV-10`)
  process.exit(1)
}
console.log(`[lint-tasks] OK —— ${files.length} 个任务文件，PRD 条目 ${prdIds.size} 条`)
