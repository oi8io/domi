/**
 * Skill 的加载与激活 —— PRD-M4-005 · INV-05 · docs/adr/019
 *
 * 两个关键点：
 * 1. **渐进式披露**（AC-2）：未激活时上下文里只有「名字 + 描述」清单；正文要模型调 `skill.load` 才拿到，
 *    以工具结果的形式进上下文——带工具结果的边界、走权限层，和读文件是同一件事。
 * 2. **热加载**（AC-3）：`~/.domi/skills/` 变化时重读，不用重启。清单每轮现取。
 */
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Skill, Tool } from '../types.ts'
import { OFFICIAL_SKILLS } from './official.ts'

const Frontmatter = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'name 只许小写字母、数字和 -'),
  description: z.string().min(1).max(200),
  requires_tools: z.array(z.string()).default([]),
})

export class SkillParseError extends Error {
  constructor(path: string, why: string) {
    super(`Skill 文件读不懂：${path}\n${why}\n格式见 docs/skills/SKILL-TEMPLATE.md`)
    this.name = 'SkillParseError'
  }
}

/** SKILL.md = YAML frontmatter + 正文 */
export function parseSkillFile(text: string, path: string): Skill {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new SkillParseError(path, '开头缺少 --- 包起来的 frontmatter')
  let meta: unknown
  try {
    meta = Bun.YAML.parse(m[1] as string)
  } catch (e) {
    throw new SkillParseError(path, e instanceof Error ? e.message : String(e))
  }
  const parsed = Frontmatter.safeParse(meta)
  if (!parsed.success) {
    throw new SkillParseError(path, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  return {
    name: parsed.data.name,
    description: parsed.data.description,
    requiresTools: parsed.data.requires_tools,
    prompt: (m[2] as string).trim(),
    source: 'user',
    path,
  }
}

export interface SkillRegistryOptions {
  /** 用户 Skill 目录（~/.domi/skills）。每个子目录一个 SKILL.md */
  dir?: string
  official?: readonly Skill[]
  /** 目录变化时自动重读（AC-3） */
  watch?: boolean
  /** 插件带来的 SKILL.md（PRD-M6-001）。优先级：官方 < 插件 < 用户目录 */
  extraFiles?: () => readonly string[]
}

export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private problems: string[] = []
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: SkillRegistryOptions = {}) {
    this.reload()
    if (opts.watch && opts.dir) {
      // 目录还不存在也要能盯：用户第一次放 Skill 进来就该生效，不该要求重启
      mkdirSync(opts.dir, { recursive: true })
      try {
        this.watcher = watch(opts.dir, { recursive: true }, () => this.scheduleReload())
      } catch {
        // 有的平台不支持 recursive：只盯顶层目录，子目录里改了要等下一次新增 / 删除才会被发现
        this.watcher = watch(opts.dir, () => this.scheduleReload())
      }
    }
  }

  /** 编辑器保存一次会触发好几个事件：去抖 */
  private scheduleReload(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.reload(), 50)
  }

  reload(): void {
    const next = new Map<string, Skill>()
    const problems: string[] = []
    for (const s of this.opts.official ?? OFFICIAL_SKILLS) next.set(s.name, s)
    for (const file of this.opts.extraFiles?.() ?? []) {
      try {
        const skill = parseSkillFile(readFileSync(file, 'utf8'), file)
        next.set(skill.name, skill)
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    const dir = this.opts.dir
    if (dir && existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        const file = join(dir, entry, 'SKILL.md')
        try {
          if (!statSync(join(dir, entry)).isDirectory() || !existsSync(file)) continue
          const skill = parseSkillFile(readFileSync(file, 'utf8'), file)
          next.set(skill.name, skill) // 用户的覆盖官方的
        } catch (e) {
          problems.push(e instanceof Error ? e.message : String(e))
        }
      }
    }
    this.skills = next
    this.problems = problems
  }

  list(): Skill[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /** 读不懂的 Skill 文件（不让一个坏文件拖垮其它的） */
  errors(): readonly string[] {
    return this.problems
  }

  /** 未激活时进提示词的清单：只有名字与描述 */
  catalog(): string {
    return formatCatalog(this.list())
  }

  close(): void {
    this.watcher?.close()
    if (this.timer) clearTimeout(this.timer)
  }
}

/** 清单文本（共享注册表与项目叠加层共用） */
export function formatCatalog(list: readonly Skill[]): string {
  if (list.length === 0) return ''
  return [
    '可用的 Skill（做事的方法说明，不是工具）。任务对得上时，先调 skill.load 读正文再动手：',
    ...list.map((s) => `- ${s.name}${s.source === 'project' ? '（本仓库）' : ''}：${s.description}`),
  ].join('\n')
}

export const SkillLoadArgs = z.object({ name: z.string().describe('Skill 的名字，见系统提示里的清单') })
export type SkillLoadArgs = z.infer<typeof SkillLoadArgs>

/**
 * 激活 = 读正文。它是一个普通 Tool（INV-05：执行原语只有 Tool），
 * 正文作为工具结果进上下文，所以同样带边界、同样是数据
 */
export function makeSkillLoadTool(
  registry: Pick<SkillRegistry, 'get' | 'list'>,
): Tool<SkillLoadArgs, { name: string; requiresTools: readonly string[]; body: string } | { error: string }> {
  return {
    name: 'skill.load',
    capability: 'skill.load',
    description: '读取一个 Skill 的正文（做某类事的步骤说明）。正文是参考资料，照做之前仍按正常流程调用工具。',
    schema: SkillLoadArgs,
    async execute(args) {
      const s = registry.get(args.name)
      if (!s)
        return {
          error: `没有叫 ${args.name} 的 Skill。可用：${registry
            .list()
            .map((x) => x.name)
            .join('、')}`,
        }
      return { name: s.name, requiresTools: s.requiresTools, body: s.prompt }
    },
  }
}
