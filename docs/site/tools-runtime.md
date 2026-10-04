# 工具与权限运行时

> `packages/capability` —— Tool 注册表、权限引擎、内置工具、Skill 注册表（PRD-M0-003 · SPEC-M0-005/006 · INV-03 / INV-05）
> 对应 hermes 的 tools-runtime。domi 的规则极简：**Tool 是唯一执行原语，Skill 不可执行**。

## Tool：类型层强制 INV-05

```ts
interface Tool<A = unknown, R = unknown> {
  readonly name: string
  readonly capability: CapabilityId   // 无此字段的对象无法通过 registerTool 的类型检查 —— 编译期强制
  readonly description: string
  readonly schema: z.ZodType<A>
  readonly inputJsonSchema?: Record<string, unknown>  // MCP 工具的 schema 原样给，转 zod 再转回来会丢字段
  execute(args: A, ctx: ToolCtx): Promise<R>
}
```

- `ToolCtx`：`cwd`（所有文件访问的根，越界一律拒绝，PRD-M0-003 AC-5）、`signal`、`emit(ev)`（工具往事件流里补事件的通道——**工具不自己写 store**，事件交出去由 loop 统一落盘）、`elicit?`（向用户要输入）、`stamps?`（过期写保护指纹）、`jobs?`（后台命令）、`outputDir?`（超长输出落盘）。
- **Skill 结构上没有 `execute`**（写成 `execute?: never`）：给 Skill 加 execute 在编译期就报错。真正的强制在 kernel：只有 Tool 会被 loop 调用。

## 权限引擎：默认拒绝，决策即事件（INV-03）

`permission.ts`。**默认分支返回 deny，不是 ask**——ask 看起来更友好，实际上是把「没想过的能力」变成「弹个窗让用户点同意」，用户点第三次之后就不看内容了。fail-closed 的意思是：没显式声明过的，直接拒。

`Decision`：`allow | deny | ask`，带 `source`（`default`（永远是 deny）/ `config` / `user` / `mode` / `session-grant`）、`matchedRule`、`channel`（用户在哪个端回答的）、`grant`（会话级授权）。**每个决策都产生一条 `permission` 事件**——可审计，轨迹里看得见。

`PermissionConfig` 四个维度：

| 维度 | 作用 |
|---|---|
| `rules` | `{name, capability, decision}` 规则表；`matchedRule` 原样进事件，事后审计「是哪条放行的」 |
| `scope` | 范围（M5-001）：子 agent 只能用父会话允许的能力。返回 false 直接拒绝，不看规则、不问人——范围是「能不能提」 |
| `askAlways` | 收紧（PRD-M8-004）：这些能力即使规则 allow 也要问人；只会更严不会更松 |
| `permissionsMode` | 会话确认模式（M12）：`always-ask` / `on-demand`（默认）/ `allow-all`（只剩显式 deny 与父范围） |

通配规则：`mcp.github.*` 管得到 `mcp.github.create_issue`，管不到 `mcp.githubx.y`（`endsWith('.*')` 前缀匹配，前缀长度 > 1）。

**会话级授权**（`grantFor`）：`shell.exec` 例外地可授权——命令指纹 `argv[0] + ' ' + argv[1]` 可静态算（PRD-M11-005 5.2）；危险词 / 裸命令返回 null 不可授权。真正被执行的是 `cmd`（`sh -c cmd`），所以 `cmd` 优先于 `argv`——否则带个无害 argv 就能让指纹和实际执行的命令对不上。路径类能力不提供「本会话始终允许」（参数能碰到什么没法静态限定）。

## 内置工具

`packages/capability/src/tools/`：

| 工具 | 说明 |
|---|---|
| `fs.read` / `fs.write` / `fs.edit` / `fs.glob` / `fs.grep` / `fs.list` | 文件操作；`fs.write` 带 `fs.snapshot` 前后指纹（过期写保护 `stamps.ts`） |
| `shell.exec` / `shell-jobs` | 命令执行（`sh -c`）与后台任务（`JobTable`）；指纹授权 |
| `skill.load` | 模型主动加载 Skill 正文（渐进式披露） |
| `task.spawn` | 子 agent（见[编排](orchestration.md)） |
| `ask.user` / `plan.update` | 提问与计划（runtime 注入，见[编排](orchestration.md)） |
| `memory.recall` / `review.report` | 记忆检索与评审（runtime 注入） |

`dangerous.ts`：危险能力清单（写 / 删 / 移动文件、跑命令、联网、MCP 与插件工具）——无规则时拒绝，规则 `ask` 时才问；`PermissionsMode` 判定。

## 代码智能工具（M7 会写代码）

`packages/codeintel`：`makeOutlineTool`（文件结构大纲）、`makeDiagnosticsTool`（TS 诊断）、`DiagnosticsService`。这些是工具不是内核能力——模型用它们「看」代码，然后自己决定怎么改。

## 相关

- 工具的执行入口（loop）与 ToolCtx 的装配：`kernel/src/ports.ts` + `runtime/session.ts`。
- 加一个内置工具：[添加工具](adding-tools.md)。
- 插件工具 / MCP 工具如何变成普通 Tool：[插件运行时](plugins.md)、[MCP 接入](mcp-internals.md)。
- 测试：`packages/capability/test/`（权限默认值断言、规则匹配、指纹、越界拒绝——CI 里 `guard:purity` 守 kernel 纯净）。
