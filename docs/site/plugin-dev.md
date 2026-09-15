# 插件开发

插件是一个目录，里面有 `domi-plugin.yaml` 与你的代码 / Skill / MCP 配置。四类扩展点：

| 扩展点 | 你写什么 | domi 怎么用 |
|---|---|---|
| tool | 一个 `execute(args, ctx)` | 注册为 `plugin.<插件名>.<工具名>`，跑在沙箱里 |
| skill | 一个 SKILL.md | 进 Skill 清单，模型用 `skill.load` 读 |
| mcp | 一段 MCP server 配置 | 和用户自己配的 server 一起连 |
| ui | 一个静态 HTML | Web 的「插件」页里，在隔离 iframe 中显示 |

## 从脚手架开始

```sh
domi plugin scaffold tool ./my-plugin
cd my-plugin && bun test
domi plugin install .
```

## manifest

```yaml
name: my-plugin
version: 0.1.0
api: 1                      # 插件 API 主版本
description: 做什么的
permissions:                # 必填；什么都不要也写 permissions: {}
  read: ["**/*.md"]         # 相对工作目录的 glob
  write: []
  hosts: [api.example.com]  # ctx.fetch 能访问的主机，*.example.com 匹配子域
contributes:
  tools:
    - name: lines
      description: 统计行数
      entry: tools/lines.ts
      input: { type: object, properties: { path: { type: string } }, required: [path] }
      timeoutMs: 10000      # 最长 120000
```

安装时，domi 会把 `permissions` 逐条列给用户确认；确认过的权限连同 manifest 的哈希一起记下来。
之后 manifest 被改过，插件就停用，直到重新安装确认。

## 工具的写法

工具代码跑在系统级沙箱里（Linux：bubblewrap；macOS：sandbox-exec）：**没有网络，看不到任何用户文件**。
读写文件、发请求都经 `ctx`，domi 按你声明的权限核对，没声明的会被拒绝并记一条权限事件。

```ts run
import assert from 'node:assert/strict'

interface Ctx {
  readFile(path: string): Promise<string>
  fetch(url: string): Promise<{ status: number; text: string }>
}

const tool = {
  async execute(args: { path?: unknown }, ctx: Ctx) {
    if (typeof args.path !== 'string') throw new Error('需要 path')
    const text = await ctx.readFile(args.path)
    return { path: args.path, lines: text === '' ? 0 : text.split('\n').length }
  },
}

// 测试时自己造一个假 ctx——插件的测试不依赖 domi
const ctx: Ctx = {
  async readFile(path) {
    if (path !== 'a.md') throw new Error('没有声明这个权限')
    return '第一行\n第二行'
  },
  async fetch() {
    throw new Error('没有网络权限')
  },
}
assert.deepEqual(await tool.execute({ path: 'a.md' }, ctx), { path: 'a.md', lines: 2 })
await assert.rejects(tool.execute({ path: 'b.env' }, ctx), /没有声明/)
```

`ctx` 的全部能力：`cwd`、`readFile(path)`、`writeFile(path, content)`、`fetch(url, {method, headers, body})`（返回 `{status, headers, text}`）、`log(message)`。

几条规矩：
- 返回值会作为工具结果交给模型，而且会被当作**不可信数据**——不要在里面写「请模型做某事」
- 超时会被强杀；崩溃不会影响 domi，只会让这次调用失败并留一条 `plugin.error`
- 用户仍然要在权限规则里放行 `plugin.<插件名>.*`（或设为 ask）

## 版本与弃用

`api` 只写主版本。小版本只会加可选字段；弃用的字段在加载时打一条 warn 并写明移除版本；
主版本变化意味着不兼容，旧插件会安装失败并说明原因。
