# 配置与厂商

> `packages/config` —— 配置 schema、加载、secrets、厂商模板（PRD-M8-011 · PRD-M9-002 · docs/adr/014）
> 对应 hermes 的 configuration。domi 的配置规矩：**配置在 `~/.domi/config.yaml`，凭据只在 `~/.domi/secrets.yaml`**。

## 两份文件，一个原则

- `~/.domi/config.yaml`：模型、权限、MCP、记忆、通知、插件、UI、TUI、hooks、verify、pricing、budget、skills、prompt、server、context、loop、attachments。`loadConfig` 读取（YAML，ADR-014；TOML 支持已删除，PRD v1.18）。
- `~/.domi/secrets.yaml`：凭据（`providers.<id>.api_key`）。`loadSecrets` 读取；**任何接口都不回吐给界面**（凭据脱敏，见[会话存储](session-storage.md)）。

key 也可以用各家惯用的环境变量（`DOMI_<ID>_API_KEY` + 厂商模板里的惯用名，如 `ANTHROPIC_API_KEY`）。

## 厂商模板（vendors.ts）

**「有哪些厂商」这件知识只在这里**（`guard:providers` 守着）。每个模板是纯数据：`{ id, label, protocol, adapter, defaultBaseUrl?, capabilities, envNames, keyHint }`。

- `VENDOR_IDS`：`openai`（`openai-official` 适配器，Responses API）/ `anthropic` / `deepseek`（`openai-compatible`）/ `gemini` / `custom`（自选协议）。
- `PROTOCOLS`：`openai` | `anthropic`；`Adapter`：`openai-official` | `anthropic` | `openai-compatible`。
- 能力矩阵（toolCall / vision / reasoning / promptCache / structuredOutput）是默认值——`custom` 后面挂什么只有用户知道，配置里可显式覆盖。
- 放在 config 而不是 model：apps 不许 import model（那里有 AI SDK），而模板本身不需要 SDK；Web 经 `provider.vendors` 拿去画「新增 provider」表单——两边都不自己写厂商名单。

## 配置 schema 要点（schema.ts，zod）

- `model`：默认模型 = 一个 provider + 一个模型名。
- `providers`：每家一段（vendor / protocol / base_url / models / enabled / capabilities 覆盖）。
- `permissions.rules`：见[工具与权限运行时](tools-runtime.md)。
- `mcp`：servers / allowedHosts / timeoutMs，见[MCP 接入](mcp-internals.md)。
- `memory` / `notify` / `bridge.telegram` / `plugins`（enabled / allowUnsandboxed / disabled）/ `ui.locale`（auto | zh | en）/ `tui.renderer`（fullscreen | classic）/ `hooks` / `verify` / `pricing`（内置定价表 `BUILTIN_PRICING`；用量成本只统计有定价表的模型）/ `budget` / `skills.enabled` / `prompt`（自定义提示词层）/ `server`（port / host / token）/ `context` / `loop`（上限，默认 100）/ `attachments.maxMB`（默认 20）。

## 加载与写回

- `load.ts`：`loadConfig`（无 key 也照起，OPT-M8-001；缺 key 留到提交时报 `error.missing_credential`，`data.reason = MISSING_CREDENTIAL`）、`configPath` / `domiHome`、`ConfigParseError`。
- `preflight.ts`：`domi doctor` 的每一条问题带一条能直接粘贴的修复命令。
- `write.ts`：`writeConfigPatch`——Web 设置页读写的就是启动时读的那一份（PRD-M8-011）；`config.set` 的**白名单必须排除 permissions / hooks / MCP / 插件安装**——界面永远不能给自己提权（HANDOFF 硬规矩 5）。
- `providers.ts`：`providerConnection` / `listProviders` / `credentialEnvNames` / `pricingOf`。

## 相关

- 模型层怎么消费厂商模板：[模型运行时](model-runtime.md)。
- 设置页 RPC：`config.get` / `config.set` / `provider.vendors` 见 [Domi Protocol](protocol.md)。
- 测试：`packages/config/test/`（schema 校验、secrets 加载、vendor 解析、白名单）。
