# domi 开发者文档

> 开发者视角的 domi 全景：架构、各子系统内部机制、扩展指南与贡献方式。
> 面向两类读者：**改 domi 本身的人**（从「架构」和「内幕」开始）与**基于 domi 做扩展的人**（直接看「扩展」）。

## 先读

| 文档 | 讲什么 | 什么时候读 |
|---|---|---|
| [快速开始](quickstart.md) | 装好、配上模型、第一次对话、权限与长任务 | 第一次跑 domi |
| [架构](architecture.md) | 进程模型、包分层、一次提交的数据流、事件流与不变量 | 改任何代码之前 |
| [Agent Loop 内部机制](agent-loop.md) | kernel 的循环：拼上下文 → 生成 → 落盘 → 执行工具 → 回灌 | 想弄懂「一轮对话发生了什么」 |
| [Domi Protocol](protocol.md) | 传输约定、方法 / 通知 / 事件清单、版本演进规则 | 写客户端、改协议 |

## 内部机制（改 domi 本身）

| 子系统 | 文档 | 关键包 |
|---|---|---|
| daemon 宿主 | [daemon 内部机制](daemon-internals.md) | `packages/daemon` |
| 会话存储 | [会话存储与事件流](session-storage.md) | `packages/store` |
| 轨迹与回放 | [轨迹与回放](trajectory-and-replay.md) | `packages/trace` · `packages/eval` |
| 提示词 | [提示词分层与 cache 边界](prompt-assembly.md) | `packages/prompt` |
| 上下文压缩 | [压缩与 prompt cache](context-compression.md) | `packages/memory` · `packages/kernel` |
| 记忆与 Soul | [记忆分层与 Soul](memory-and-soul.md) | `packages/memory` · `packages/runtime` |
| 编排 | [编排：任务 · 子 agent · 计划](orchestration.md) | `packages/orchestrator` · `packages/runtime` |
| 模型层 | [模型运行时](model-runtime.md) | `packages/model` |
| 工具与权限 | [工具与权限运行时](tools-runtime.md) | `packages/capability` |
| MCP | [MCP 接入](mcp-internals.md) | `packages/mcp` |
| 插件 | [插件运行时](plugins.md) | `packages/plugin` |
| 定时任务 | [定时任务](scheduling.md) | `packages/daemon/src/{cron,scheduler}.ts` |
| 配置 | [配置与厂商](config.md) | `packages/config` |
| 命令行 | [CLI 与命令](cli.md) | `packages/cli` |
| 客户端 | [三端与桥接](clients.md) | `apps/tui` · `apps/web` · `apps/desktop` · `apps/bridge-telegram` · `packages/client-core` |
| 评估 | [评估体系 L1 / L2](eval.md) | `packages/eval` |

## 扩展（基于 domi 做东西）

| 想做什么 | 文档 |
|---|---|
| 写一个插件（tool / skill / mcp / ui） | [插件开发](plugin-dev.md) |
| 写一个 Skill | [Skill 编写](skill-writing.md) |
| 给 domi 加内置工具 | [添加工具](adding-tools.md) |
| 接入新的模型厂商 | [添加模型供应商](adding-providers.md) |
| 在自己的程序里嵌入 domi | [编程集成](programmatic-integration.md) |

## 参与

- 仓库规矩与提交规范见根目录 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)，站点版见[贡献指南](contributing.md)。
- 没想好从哪里下手：`docs/good-first-issues.md`。
- 设计背景：`docs/DESIGN.md`（架构与路线图）、`docs/ENGINEERING.md`（工程规约）、`docs/PROCESS.md`（研发流程与回写门）。
- 协议逐字段参考（生成文件，勿手改）：[`docs/protocol.md`](../protocol.md)。
