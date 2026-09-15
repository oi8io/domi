# 010 明确押后的选型清单

- 日期：2026-09-14
- 状态：已采纳

**Context**：一次把 M0–M6 的选型全部钉死，正是 `PROCESS.md` 缺口一说的"瀑布"——远期决策在探索性项目里**必然在中途作废**，然后就会出现"改文档太麻烦，先按代码来吧"。但不写下来，同样的候选每隔几周会被重新讨论一次。

**Decision**：以下选型**现在不定**，并写明各自"该在什么时候定"。进入对应里程碑时走再批准门，把结论补成独立 ADR。

| 选型 | 何时定 | 定它之前需要先知道什么 |
|---|---|---|
| **MCP SDK 版本**（`@modelcontextprotocol/sdk`） | 进入 M2 前 | 见下方"已知风险"，这条是四项里最可能出事的 |
| **checkpoint 的 git 实现**（isomorphic-git / 直接 spawn git / simple-git） | M1，做 `PRD-M1-011` 时 | 影子仓库要不要支持用户机器上没装 git 的情况。装了 git 就 spawn（零依赖、行为与用户的 git 一致）；要支持没装的才需要 isomorphic-git |
| **向量检索**（sqlite-vec vs 纯 FTS5/BM25） | M4，做 `PRD-M4-001` 时 | 先有真实的 soul 语料，才知道 BM25 够不够。`RECON-DSH` §2 显示生态里四种切法都有人做完且没有胜者——没有语料就选，纯属抛硬币 |
| **Domi Protocol 传输细节** | M3，做 `PRD-M3-001` 时 | JSON-RPC over stdio / WS 的方向已在 DESIGN §5 定了；用不用现成库要等协议条目稳定 |
| **插件沙箱机制** | M6 | `PRD-VISION` §6 已写"插件 API 必须等 5–8 个内置能力跑通后再抽"，沙箱同理 |
| **Web 技术栈细节 / Tauri 版本** | M3 / M5 | 方向在 DESIGN §5，具体版本进入时再钉 |
| **Telegram 库**（grammY 1.46.0） | M5 | 基本已定，但 M5 还远，现在钉版本没有意义 |
| **computer-use MCP server 选哪个** | M2，做 `PRD-M2-009` 时 | 该条是 `PRD-VISION` §6 第一类（纯引用），domi 零实现，换一个只是改配置 |

## 已知风险：MCP SDK 的版本分裂

> **2026-09-15 更正**：下面的判断只查了 `@modelcontextprotocol/sdk`。v2 拆成了 `@modelcontextprotocol/client` / `server` / `core`，2.0.0 已于 2026-07-27 GA。选型结论见 `docs/adr/015`。

`PRD-M2-001` 明确要求对齐 **2026-07-28** 规范（无状态化，取消 `initialize` 握手与 `Mcp-Session-Id`）。但截至 2026-09-14：

- `@modelcontextprotocol/sdk` 的 **latest 是 1.30.0**（旧的有状态规范）
- 支持 2026-07-28 的是 **v2.0.0-beta**，尚未 GA

**这是一个真实的 PRD 风险，不是选型偏好**：进入 M2 时若 v2 仍未 GA，三条路——① 用 beta 并钉死版本（承担破坏性变更的人力税，`RECON-DSH` §1 记录过 DSH 钉 rc 的代价）；② 用 v1 但 `PRD-M2-001` 的 AC 要回写降级；③ 推迟 MCP 到 M3。**这个决定必须在进入 M2 的再批准门上做，不是开工后临时决定。**

**Consequences**：换来的是"这些事已经想过并且有意推后"这个事实被记下来，避免重复讨论；也避免了现在拍脑袋定一堆到时候必然作废的东西。代价是每个里程碑的再批准门多一项检查——那本来就是再批准门存在的理由。
