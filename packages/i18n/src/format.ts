/**
 * 文案模板 —— PRD-M9-004 AC-2
 *
 * 两种占位，够用就行（不引 ICU 库，PRD-M9-004「零第三方依赖」）：
 *   - `{name}`：原样替换
 *   - `{n, plural, one {# file} other {# files}}`：按 n 选分支，`#` 换成 n。中文只写 other
 * 参数缺了就把占位原样留着——看得见的错比悄悄变成空串好查
 */
export type Params = Readonly<Record<string, string | number>>

export function format(template: string, params: Params = {}): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open < 0) {
      out += template.slice(i)
      break
    }
    out += template.slice(i, open)
    const close = matching(template, open)
    if (close < 0) {
      out += template.slice(open)
      break
    }
    out += render(template.slice(open + 1, close), params, template.slice(open, close + 1))
    i = close + 1
  }
  return out
}

/** 与 open 位置的 `{` 配对的 `}`（plural 里还有一层） */
function matching(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

function render(body: string, params: Params, raw: string): string {
  const m = body.match(/^\s*(\w+)\s*(?:,\s*plural\s*,(.*))?$/s)
  if (!m) return raw
  const name = m[1] as string
  const value = params[name]
  if (value === undefined) return raw
  if (m[2] === undefined) return String(value)
  const branches = new Map<string, string>()
  const re = /(\w+)\s*\{/g
  let b: RegExpExecArray | null = re.exec(m[2])
  while (b !== null) {
    const start = b.index + b[0].length - 1
    const end = matching(m[2], start)
    if (end < 0) break
    branches.set(b[1] as string, m[2].slice(start + 1, end))
    re.lastIndex = end + 1
    b = re.exec(m[2])
  }
  const n = Number(value)
  const pick = (n === 1 ? branches.get('one') : undefined) ?? branches.get('other') ?? ''
  return pick.replace(/#/g, String(value))
}

/** 模板里出现的参数名（守卫比对两种语言的参数是否一致） */
export function paramNames(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(/\{\s*(\w+)\s*(?:,|\})/g)) names.add(m[1] as string)
  return [...names].sort()
}
