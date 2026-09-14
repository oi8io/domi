/**
 * PRD-M0-007 · 关键风险的 spike 结论落盘
 *
 * 为什么要机器校验一份 markdown：spike 最容易的失败方式不是"没做"，
 * 是"做了但结论只留在脑子里"，或者留下一句"性能还行"。
 * 强制固定字段 + 数值格式，就是不让"还行"这种词通过。
 *
 * 用法：bun run scripts/check-adr-fields.ts
 */
import { existsSync, readFileSync } from 'node:fs'

interface FieldRule {
  heading: string
  /** 该段正文中必须出现的模式；用来挡"性能还行"这类没有数字的结论 */
  mustMatch?: { re: RegExp; hint: string }
}

interface AdrRule {
  file: string
  prd: string
  fields: FieldRule[]
}

const RULES: AdrRule[] = [
  {
    file: 'docs/adr/001-runtime-choice.md',
    prd: 'PRD-M0-007 AC-1',
    fields: [
      { heading: '实测-渲染帧耗时P95', mustMatch: { re: /\d+(\.\d+)?\s*ms/i, hint: '必须出现具体毫秒数，不接受"还行""够快"' } },
      { heading: '实测-native模块兼容清单' },
      { heading: '结论' },
      { heading: '若不通的退路' },
    ],
  },
  {
    // AC-2 已由 ADR-005 回写：不再要求压测数字，改为要求写明何时重新激活
    file: 'docs/adr/005-context-strategy-as-option.md',
    prd: 'PRD-M0-007 AC-2（回写后）',
    fields: [{ heading: '触发重新激活压测的条件' }],
  },
]

/** 取某个标题下、到下一个同级或更高级标题为止的正文 */
function sectionBody(text: string, heading: string): string | null {
  const lines = text.split('\n')
  const norm = (s: string): string => s.replace(/\s+/g, '')
  const start = lines.findIndex((l) => /^#{2,6}\s/.test(l) && norm(l.replace(/^#{2,6}\s*/, '')) === norm(heading))
  if (start === -1) return null
  const level = (lines[start]!.match(/^#+/) ?? ['##'])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{2,6})\s/)
    if (m && m[1]!.length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

let failures = 0
for (const rule of RULES) {
  if (!existsSync(rule.file)) {
    console.error(`[${rule.prd}] 缺少 ${rule.file}`)
    failures++
    continue
  }
  const text = readFileSync(rule.file, 'utf8')
  for (const f of rule.fields) {
    const body = sectionBody(text, f.heading)
    if (body === null) {
      console.error(`[${rule.prd}] ${rule.file} 缺少字段 "## ${f.heading}"`)
      failures++
      continue
    }
    if (body.trim() === '') {
      console.error(`[${rule.prd}] ${rule.file} 的 "## ${f.heading}" 是空的`)
      failures++
      continue
    }
    if (f.mustMatch && !f.mustMatch.re.test(body)) {
      console.error(`[${rule.prd}] ${rule.file} 的 "## ${f.heading}" 不合格：${f.mustMatch.hint}`)
      failures++
    }
  }
}

if (failures > 0) {
  console.error(`\n[check-adr-fields] ${failures} 处不合格`)
  process.exit(1)
}
console.log(`[check-adr-fields] OK —— ${RULES.length} 份 ADR，字段与数值格式齐备`)
