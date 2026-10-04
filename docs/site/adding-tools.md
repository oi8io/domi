# 添加工具

> 给 domi 加一个**内置工具**（在 `packages/capability/src/tools/` 里）。想加可分享的扩展工具，走[插件开发](plugin-dev.md)（不需要改 domi 本身）。

## 一个工具长什么样

```ts
import { z } from 'zod'
import type { Tool, ToolCtx } from '../types.ts'

const CountWordsArgs = z.object({ path: z.string().min(1) })

export const countWordsTool: Tool<z.infer<typeof CountWordsArgs>, { words: number }> = {
  name: 'count.words',          // 能力名会变成权限规则的 target
  capability: 'count.words',    // CapabilityId —— 无此字段过不了 registerTool 的类型检查（INV-05）
  description: '统计一个文本文件里的字数。',
  schema: CountWordsArgs,
  async execute(args, ctx) {
    const text = await ctx.readFile(args.path)   // 注意：通过 ctx 而非 node:fs —— 越界与权限由宿主管
    return { words: text.split(/\s+/).filter(Boolean).length }
  },
}
```

## 注册三步

1. **实现 Tool**（`schema` 用 zod；`execute` 用 `ctx` 而不是裸的 node API——`cwd` 是文件访问的根，越界一律拒绝，PRD-M0-003 AC-5）。
2. **登记进 `ToolRegistry`**（`packages/capability/src/registry.ts`；runtime 的 `DomiSession` 里 `registerTool` 或注入）。`ToolRegistry` 把 Tool 集合变成 kernel 的 `ToolRunner` 端口，调用顺序不能乱：

   **参数校验（失败 → `invalid_args`，回灌给模型重试，不是抛异常打断会话）→ 权限检查（每次都产生一条事件，INV-03；用户拒绝 → `user_denied`，规则/默认拒绝 → `permission_denied`）→ 执行。**

   权限检查放在参数校验**之后**是有意的：参数都没解析出来，确认框没法告诉用户「要写什么内容 / 要执行哪条命令」（PRD-M0-003 AC-1）。

3. **考虑权限口径**：
   - 想让它默认拒绝 / 危险：加进 `dangerous.ts` 的 `DANGEROUS_EXACT`（写 / 删 / 移动文件、跑命令、联网）。**为什么是代码常量不是配置**（INV-03）：在「每次都问 / 按需」两档下危险能力不能被自动放行；写成 YAML 就可能被一条配置关掉。常量 + 单测锁定。
   - 想让用户「本会话始终允许」：`grantable()` / `grantFor()` 决定（路径类能力不提供——参数能碰到什么没法静态限定；`shell.exec` 例外，命令指纹可静态算）。
   - 需要向用户要输入：在 `execute` 里用 `ctx.elicit`（`ElicitRequest`，带 JSON Schema 表单）。

## 工具执行时往事件流里补东西

用 `ctx.emit(ev)` 交出去（如 `fs.write` 的前后指纹 `fs.snapshot`），由 loop 统一落盘——**工具不自己写 store**，顺序与事务边界只有一个地方管，append-only 的保证不会被各写各的工具破坏。

## 测试先行（仓库规矩）

- 新行为先写一个会失败的测试（纯函数可断言：给定 args + 假 ctx，断言返回值与 emit 的事件）。
- 权限相关：断言默认拒绝、规则匹配、越界拒绝（CI 有默认值断言）。
- 有 PRD 依据（INV-10）：任务文件里写 `prd: PRD-Mx-yyy`，`guard:tasks` 会查。

## 相关

- 工具类型与 ctx 全量：[工具与权限运行时](tools-runtime.md)。
- 给模型看的 schema：`ToolSchema`（`@domi/protocol` 的 `tool.ts`）；MCP 工具可原样给 `inputJsonSchema`。
- 官方工具清单：`packages/capability/src/tools/`（fs-* / shell-* / list / stamps / shell-jobs）。
