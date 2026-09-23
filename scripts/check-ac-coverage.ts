/**
 * AC 覆盖率 —— 每一条 AC 至少被一个测试提到
 *
 * **这个守卫查不了什么，先说清楚**：它查不了「AC 有没有被读错」。
 * 一个测试可以正确引用 `PRD-M0-003 AC-4` 却测了完全不同的东西。
 * 那种偏差只有换一双眼睛才看得见（`docs/qa/PROMPT.md` 的第一步就是干这个）。
 *
 * 它能查的是另一半：**AC 根本没被任何测试提到**。
 * 这一半原来要靠人一条条对，现在归机器。
 *
 * 判据：某个测试文件里同时出现该需求的 ID 与该 AC 编号。
 * 松，但足够把「压根没写」和「写了」分开——这正是它的职责边界。
 *
 * 用法：bun run scripts/check-ac-coverage.ts [--report]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PRD = 'docs/PRD.md'
const TEST_ROOTS = ['packages', 'apps']

interface Requirement {
  id: string
  title: string
  acs: string[]
  /** 被划掉的 AC（回写降级过的）不计入 */
  retired: string[]
}

function parsePrd(): Requirement[] {
  const text = readFileSync(PRD, 'utf8')
  const out: Requirement[] = []
  const blocks = text.split(/^### (?=PRD-M\d+-\d+)/m).slice(1)
  for (const block of blocks) {
    const head = block.slice(0, block.indexOf('\n'))
    const id = (head.match(/^PRD-M\d+-\d+/) ?? [''])[0]
    if (!id) continue
    const body = block.slice(0, block.indexOf('\n**验收方式**') === -1 ? undefined : block.indexOf('\n**验收方式**'))
    const acs = new Set<string>()
    const retired = new Set<string>()
    for (const line of body.split('\n')) {
      // 被 ~~ 划掉的是回写降级过的，不该再要求覆盖
      const m = line.match(/^\s*-\s*(~~)?\*{0,2}(AC-\d+)/)
      if (!m) continue
      if (m[1]) retired.add(m[2] as string)
      else acs.add(m[2] as string)
    }
    out.push({
      id,
      title: head.replace(/^PRD-M\d+-\d+\s*·\s*/, '').trim(),
      acs: [...acs],
      retired: [...retired],
    })
  }
  return out
}

function testFiles(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.spec\.(ts|tsx)$/.test(name)) out.push(p)
    }
  }
  for (const r of TEST_ROOTS) walk(r)
  return out
}

const reqs = parsePrd()
const corpus = testFiles().map((f) => ({ file: f, text: readFileSync(f, 'utf8') }))

interface Gap {
  id: string
  title: string
  ac: string
}

const gaps: Gap[] = []
const covered: Array<{ id: string; ac: string; file: string }> = []

for (const r of reqs) {
  for (const ac of r.acs) {
    const hit = corpus.find((c) => c.text.includes(r.id) && new RegExp(`\\b${ac}\\b`).test(c.text))
    if (hit) covered.push({ id: r.id, ac, file: hit.file })
    else gaps.push({ id: r.id, title: r.title, ac })
  }
}

const total = covered.length + gaps.length

if (process.argv.includes('--report')) {
  console.log(`# AC 覆盖率\n`)
  console.log(`需求 ${reqs.length} 条 · AC ${total} 条 · 已提到 ${covered.length} · 缺口 ${gaps.length}\n`)
  const byMilestone = new Map<string, Gap[]>()
  for (const g of gaps) {
    const m = (g.id.match(/M\d+/) ?? ['?'])[0]
    byMilestone.set(m, [...(byMilestone.get(m) ?? []), g])
  }
  for (const [m, list] of [...byMilestone.entries()].sort()) {
    console.log(`## ${m} 的缺口（${list.length} 条）\n`)
    for (const g of list) console.log(`- ${g.id} ${g.ac} · ${g.title}`)
    console.log('')
  }
  process.exit(0)
}

/**
 * 只对**已经做完并补过验证的里程碑**强制：M0 / M1（一开始就在）、M7（TASK-M7-011 补齐）、M8（TASK-M8-014 补齐）、M9（TASK-M9-012 补齐）与 M10（2026-09-23 补上：M10-006 收口时只改了提示文案、正则没跟上，M10 实际一直没被强制）。
 * 中间几个里程碑的 AC 有测试但没在测试里写 AC 编号，一次性回填的收益不如它的噪音大，
 * 所以不硬拉进来——那会逼人写空壳测试来骗守卫，比没有守卫更糟。
 */
const ACTIVE = /^PRD-M(?:[01]|[789]|10)-/
const active = gaps.filter((g) => ACTIVE.test(g.id))

if (active.length > 0) {
  for (const g of active) console.error(`[AC 未覆盖] ${g.id} ${g.ac} · ${g.title}`)
  console.error(
    `\n${active.length} 条已进入里程碑的 AC 没有任何测试提到它。\n` +
      '要么补测试，要么在 PRD 里把它划掉（~~AC-n~~）并说明为什么——两条路都行，默默跳过不行。',
  )
  process.exit(1)
}
console.log(
  `[check-ac-coverage] OK —— M0 / M1 / M7 / M8 / M9 / M10 的 ${covered.filter((c) => ACTIVE.test(c.id)).length} 条 AC 全部有测试提到；` +
    `其余里程碑还有 ${gaps.length - active.length} 条没在测试里点名`,
)
