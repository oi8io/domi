/**
 * `domi plugin scaffold <tool|skill|mcp>` —— PRD-M6-004 AC-2
 *
 * 生成的东西不改一个字就能 `bun test` 通过、能 `domi plugin install`。
 * 测试不依赖 domi：它自己造一个假 ctx，调插件的 execute。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ScaffoldKind = 'tool' | 'skill' | 'mcp'

export function scaffoldFiles(kind: ScaffoldKind, name: string): Record<string, string> {
  const head = `name: ${name}\nversion: 0.1.0\napi: 1\n`
  switch (kind) {
    case 'tool':
      return {
        'domi-plugin.yaml': `${head}description: 统计一个文本文件的行数
# 插件只能经 ctx 读写文件、访问网络，这里声明需要哪些（安装时会逐条让用户确认）
permissions:
  read: ["**/*.md", "**/*.txt"]
  write: []
  hosts: []
contributes:
  tools:
    - name: lines
      description: 统计工作目录下一个文本文件的行数
      entry: tools/lines.ts
      input:
        type: object
        properties:
          path: { type: string, description: 相对工作目录的路径 }
        required: [path]
      timeoutMs: 10000
`,
        'tools/lines.ts': `/**
 * 插件工具：default export 一个 execute(args, ctx)。
 * 这段代码跑在沙箱里：没有网络、看不到文件，只能经 ctx 请 domi 代做（并按 manifest 核对权限）。
 */
export interface Ctx {
  cwd: string
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    status: number
    headers: Record<string, string>
    text: string
  }>
  log(message: string): Promise<void>
}

export default {
  async execute(args: { path?: unknown }, ctx: Ctx) {
    if (typeof args.path !== 'string') throw new Error('需要 path')
    const text = await ctx.readFile(args.path)
    const lines = text === '' ? 0 : text.split('\\n').length
    return { path: args.path, lines }
  },
}
`,
        'tools/lines.test.ts': `import { expect, test } from 'bun:test'
import tool, { type Ctx } from './lines.ts'

const fakeCtx = (files: Record<string, string>): Ctx => ({
  cwd: '/work',
  async readFile(path) {
    const f = files[path]
    if (f === undefined) throw new Error('没有声明这个权限')
    return f
  },
  async writeFile() {},
  async fetch() {
    throw new Error('没有网络权限')
  },
  async log() {},
})

test('数行数', async () => {
  expect(await tool.execute({ path: 'a.md' }, fakeCtx({ 'a.md': '一\\n二\\n三' }))).toEqual({ path: 'a.md', lines: 3 })
})

test('没给 path 就报错', async () => {
  await expect(tool.execute({}, fakeCtx({}))).rejects.toThrow('需要 path')
})
`,
        'README.md': readme(name, 'tool'),
      }
    case 'skill':
      return {
        'domi-plugin.yaml': `${head}description: 一个 Skill 插件
permissions: {}
contributes:
  skills: [skills/${name}]
`,
        [`skills/${name}/SKILL.md`]: `---
name: ${name}
description: 一句话说明这个 Skill 什么时候用
requires_tools: [fs.read]
---

# ${name}

1. 第一步做什么
2. 第二步做什么
3. 什么情况下停下来问用户
`,
        'skill.test.ts': `import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('SKILL.md 有 frontmatter 与正文', () => {
  const text = readFileSync(new URL('./skills/${name}/SKILL.md', import.meta.url), 'utf8')
  expect(text.startsWith('---\\n')).toBe(true)
  expect(text).toContain('name: ${name}')
  expect(text).toContain('description:')
})
`,
        'README.md': readme(name, 'skill'),
      }
    case 'mcp':
      return {
        'domi-plugin.yaml': `${head}description: 把一个 MCP server 包成插件
permissions: {}
contributes:
  # MCP server 是独立进程，不在插件沙箱里；它的工具以 mcp.${name}-files.<工具> 出现，仍按你的权限规则确认
  mcp:
    - name: files
      command: npx
      args: [-y, "@modelcontextprotocol/server-filesystem@2026.8.31", "./docs"]
`,
        'mcp.test.ts': `import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('manifest 里声明了一个 stdio server，版本钉死', () => {
  const text = readFileSync(new URL('./domi-plugin.yaml', import.meta.url), 'utf8')
  expect(text).toContain('command: npx')
  expect(text).toMatch(/@\\d{4}\\.\\d+\\.\\d+/)
})
`,
        'README.md': readme(name, 'mcp'),
      }
  }
}

function readme(name: string, kind: ScaffoldKind): string {
  return `# ${name}

domi 插件（${kind} 型），由 \`domi plugin scaffold ${kind}\` 生成。

\`\`\`sh
bun test                      # 跑插件自带的测试
domi plugin install .         # 安装（会逐条列出权限让你确认）
\`\`\`

写法见 docs/site/plugin-dev.md。
`
}

export function scaffold(kind: ScaffoldKind, dir: string, name: string): string[] {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} 不是空目录，不往里写`)
  const files = scaffoldFiles(kind, name)
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text, 'utf8')
  }
  return Object.keys(files)
}
