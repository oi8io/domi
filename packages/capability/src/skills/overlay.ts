/**
 * 项目级 Skill —— PRD-M7-002 AC-5 · SPEC-M7-002
 *
 * 共享的 SkillRegistry（官方 + 插件 + ~/.domi/skills）上叠一层仓库里的 `.domi/skills/`。
 * 同名时项目的覆盖。项目目录要等工作区被信任才给（projectDir 返回 null 就不叠）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Skill } from '../types.ts'
import { formatCatalog, parseSkillFile } from './registry.ts'

/** skill.load 与提示词清单要的最小接口 */
export interface SkillSource {
  list(): Skill[]
  get(name: string): Skill | undefined
  catalog(): string
}

export class SkillOverlay implements SkillSource {
  private cache: { dir: string; stamp: string; skills: Skill[]; problems: string[] } | null = null

  constructor(
    private readonly base: SkillSource | undefined,
    private readonly projectDir: () => string | null,
  ) {}

  private project(): Skill[] {
    const dir = this.projectDir()
    if (!dir || !existsSync(dir)) return []
    // 目录里每个 SKILL.md 的修改时间拼成指纹：没变就用缓存（每轮都会调，别每次都解析）
    const entries: Array<{ file: string; mtime: number }> = []
    for (const e of readdirSync(dir)) {
      const file = join(dir, e, 'SKILL.md')
      try {
        if (statSync(join(dir, e)).isDirectory() && existsSync(file))
          entries.push({ file, mtime: statSync(file).mtimeMs })
      } catch {
        /* 读的时候被删了 */
      }
    }
    const stamp = entries.map((x) => `${x.file}@${x.mtime}`).join('|')
    if (this.cache && this.cache.dir === dir && this.cache.stamp === stamp) return this.cache.skills
    const skills: Skill[] = []
    const problems: string[] = []
    for (const { file } of entries) {
      try {
        skills.push({ ...parseSkillFile(readFileSync(file, 'utf8'), file), source: 'project' })
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    this.cache = { dir, stamp, skills, problems }
    return skills
  }

  list(): Skill[] {
    const all = new Map<string, Skill>()
    for (const s of this.base?.list() ?? []) all.set(s.name, s)
    for (const s of this.project()) all.set(s.name, s)
    return [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(name: string): Skill | undefined {
    return this.project().find((s) => s.name === name) ?? this.base?.get(name)
  }

  catalog(): string {
    return formatCatalog(this.list())
  }

  /** 项目里读不懂的 SKILL.md */
  errors(): readonly string[] {
    this.project()
    return this.cache?.problems ?? []
  }
}
