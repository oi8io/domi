/**
 * 仓库自带的规矩与项目目录 —— PRD-M7-002 · SPEC-M7-002 · ADR-025
 *
 * 仓库能影响 domi 的只有两样**不可执行**的东西：`AGENT.md`（兼认 `AGENTS.md`）与 `.domi/skills/`。
 * 两样都要先过工作区信任。钩子、权限、MCP、插件只从 ~/.domi/config.yaml 读——这个文件里没有任何读它们的路径。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** 规矩文件的名字，按优先级。同一目录两个都有只读第一个 */
export const RULES_FILE_NAMES = ['AGENT.md', 'AGENTS.md'] as const
export const PROJECT_DIR = '.domi'
/** 规矩层总长上限（字符） */
export const RULES_MAX_CHARS = 32_000

/** 从 cwd 向上找 `.git`（目录或文件，worktree 里是文件）。找不到就把 cwd 当根 */
export function findRepoRoot(cwd: string): string {
  let d = resolve(cwd)
  for (;;) {
    if (existsSync(join(d, '.git'))) return d
    const up = dirname(d)
    if (up === d) return resolve(cwd)
    d = up
  }
}

/** 根 → cwd 每一级的规矩文件（绝对路径） */
export function rulesFiles(root: string, cwd: string): string[] {
  const rel = relative(root, resolve(cwd))
  const dirs = [root]
  if (rel !== '' && !rel.startsWith('..')) {
    let d = root
    for (const part of rel.split(sep)) {
      d = join(d, part)
      dirs.push(d)
    }
  }
  const out: string[] = []
  for (const d of dirs) {
    for (const name of RULES_FILE_NAMES) {
      const f = join(d, name)
      if (isFile(f)) {
        out.push(f)
        break
      }
    }
  }
  return out
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** 规矩层的正文：每段标来源，总长超限截断并标注。没有规矩文件时是空串 */
export function rulesText(root: string, cwd: string, limit = RULES_MAX_CHARS): string {
  const files = rulesFiles(root, cwd)
  if (files.length === 0) return ''
  const parts: string[] = ['这个仓库自带的规矩（来自仓库里的文件；和用户在对话里说的冲突时以用户为准）：']
  let used = parts[0]?.length ?? 0
  for (const f of files) {
    const head = `\n# 来自 ${relative(root, f) || f}\n`
    let body: string
    try {
      body = readFileSync(f, 'utf8').trim()
    } catch {
      continue
    }
    const room = limit - used - head.length
    if (room <= 0) {
      parts.push(`\n[已截断：规矩文件总长超过 ${limit} 字符，${relative(root, f)} 及之后的没有放进来]`)
      break
    }
    if (body.length > room) {
      parts.push(`${head}${body.slice(0, room)}\n[已截断：规矩文件总长超过 ${limit} 字符]`)
      break
    }
    parts.push(head + body)
    used += head.length + body.length
  }
  return parts.join('\n')
}

/**
 * 项目级 Skill 目录（不管存不存在）。domiHome 是 domi 自己的数据目录（~/.domi）：
 * 在家目录里开会话时，`~/.domi` 不是项目目录，这时返回 null
 */
export function projectSkillsDir(root: string, domiHome?: string): string | null {
  const dir = join(root, PROJECT_DIR)
  if (domiHome !== undefined && resolve(dir) === resolve(domiHome)) return null
  return join(dir, 'skills')
}

/** 这个仓库有没有东西需要信任才能加载 */
export function hasProjectContent(root: string, cwd: string, domiHome?: string): boolean {
  if (rulesFiles(root, cwd).length > 0) return true
  const skills = projectSkillsDir(root, domiHome)
  return skills !== null && existsSync(skills)
}

interface TrustRecord {
  trusted: boolean
  at: number
}

/** ~/.domi/trust.json：{ 仓库根: { trusted, at } } */
export class TrustStore {
  constructor(private readonly file: string) {}

  private read(): Record<string, TrustRecord> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return raw && typeof raw === 'object' ? (raw as Record<string, TrustRecord>) : {}
    } catch {
      return {}
    }
  }

  get(root: string): boolean | undefined {
    return this.read()[resolve(root)]?.trusted
  }

  set(root: string, trusted: boolean, now = Date.now()): void {
    const all = this.read()
    all[resolve(root)] = { trusted, at: now }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  }

  remove(root: string): boolean {
    const all = this.read()
    const key = resolve(root)
    if (!(key in all)) return false
    delete all[key]
    writeFileSync(this.file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
    return true
  }

  list(): Array<{ root: string } & TrustRecord> {
    return Object.entries(this.read()).map(([root, r]) => ({ root, ...r }))
  }
}

export const AGENT_MD_TEMPLATE = `# 这个仓库的规矩

<!-- domi 在这个仓库里工作时会读这个文件（需要你先信任这个仓库）。写给 agent 看的，越具体越好。 -->

## 怎么验证改动

<!-- 例如：改完跑 \`pnpm check\`，全绿才算完成 -->

## 约定

<!-- 例如：提交信息用中文；不要改 generated/ 下的文件 -->
`

const PROJECT_README = `# .domi/

domi 的项目目录（docs/adr/025）。这里只放**不会被执行**的东西：

- \`skills/<名字>/SKILL.md\`：只属于这个仓库的 Skill，和 ~/.domi/skills/ 里的同名时这里的优先

钩子、权限规则、MCP server、插件**不能**写在这里——它们只认 ~/.domi/config.yaml。
`

/**
 * `domi init --project`：建 .domi/skills/ 与说明；没有规矩文件时写一份模板。
 * 返回新建了哪些（相对仓库根），已存在的不动
 */
export function initProject(cwd: string): { root: string; created: string[] } {
  const root = findRepoRoot(cwd)
  const created: string[] = []
  const skills = join(root, PROJECT_DIR, 'skills')
  if (!existsSync(skills)) {
    mkdirSync(skills, { recursive: true })
    created.push(relative(root, skills))
  }
  const readme = join(root, PROJECT_DIR, 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(readme, PROJECT_README)
    created.push(relative(root, readme))
  }
  if (rulesFiles(root, root).length === 0) {
    writeFileSync(join(root, 'AGENT.md'), AGENT_MD_TEMPLATE)
    created.push('AGENT.md')
  }
  return { root, created }
}
