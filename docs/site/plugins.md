# 插件运行时

> `packages/plugin` —— 插件宿主（PRD-M6 · docs/adr/022 · SPEC-M6-001）
> 对应 hermes 的 plugin-llm-access + plugins 索引。**写插件的教程在 [插件开发](plugin-dev.md)；本页讲宿主机制**。

## 插件的四类扩展点

| 扩展点 | 宿主怎么用 |
|---|---|
| tool | 注册为 `plugin.<插件名>.<工具名>`，跑在沙箱里 |
| skill | 进 Skill 清单（同名优先级：项目 > 用户 > 插件 > 官方） |
| mcp | 声明的 server 与用户自己配的一起连 |
| ui | Web「插件」页隔离 iframe 里显示 |

## manifest 与安装

- `domi-plugin.yaml`（`manifest.ts`），`api: 1`（`PLUGIN_API_VERSION`，只认主版本）。字段：`name`（小写字母数字与 `-`，最长 40）、`version`、`description`、**`permissions`（必填）**、`contributes`（tools / skills / mcp / ui）。
- 工具条目：`name` / `description`（≤500）/ `entry` / `input`（JSON Schema）/ `timeoutMs`（默认 30s，最长 120s）。弃用登记：`DEPRECATIONS`（命中时 warn 并写明移除版本，如 `contributes.tools[].main` → `entry`）。
- 安装（`install.ts`）：domi 把 `permissions` 逐条列给用户确认；确认过的权限连同 manifest 的哈希一起记下来。**之后 manifest 被改过，插件就停用**，直到重新安装确认。
- 脚手架：`domi plugin scaffold <tool|skill|mcp> <目录>`（`scaffold.ts`）。

## 沙箱（`sandbox.ts`）

带代码的工具跑在系统级沙箱里（Linux：bubblewrap；macOS：sandbox-exec）：**没有网络，看不到任何用户文件**。读写文件、发请求都经 `ctx`，宿主按插件声明的权限核对：

| ctx 能力 | 权限来源 |
|---|---|
| `cwd` / `readFile(path)` | `permissions.read`（相对工作目录的 glob，宿主代读） |
| `writeFile(path, content)` | `permissions.write` |
| `fetch(url, ...)` | `permissions.hosts`（`*.example.com` 匹配子域） |
| `log(message)` | 无 |

没声明的被拒绝并记一条权限事件。`allowUnsandboxed` 配置可跳过沙箱（`detectSandbox` 探测：`bwrap` / `sandbox-exec` / `none`）。工具超时被强杀；崩溃不影响 domi，只让这次调用失败并留一条 `plugin.error`。

## 宿主接线

- `host.ts`：`PluginHost`——加载 `~/.domi/plugins` 下的插件，提供 `tools(cwd)`（含沙箱包装）、`mcpServers()`、`disabledServers()`、`problems()`（加载问题，daemon 启动时逐条写 stderr）、UI 面板数据（`plugin.ui` RPC）。
- `inprocess.ts`：无沙箱路径的进程内执行。
- 启停是热的（PRD-M8-012）：只有「启动时就停用、且带 MCP server 的插件被重新启用」才回 `restartRequired`。
- 用户仍然要在权限规则里放行 `plugin.<插件名>.*`（或设为 ask）——沙箱管的是「看不见」，权限规则管的是「允不允许」。

## 相关

- 写插件教程与示例：[插件开发](plugin-dev.md)；官方示例在 `plugins/`（word-count / git-workflow / mcp-filesystem）。
- 插件工具与内置工具同走权限路径：[工具与权限运行时](tools-runtime.md)。
- 测试：`packages/plugin/test/`（manifest 校验、权限核对、沙箱包装、哈希失效停用）。
