# 003 推翻 DSH 发行版路线，恢复自建运行时

- 日期：2026-09-14
- 状态：已采纳

> 编号说明：001/002 由 `PRD-M0-007` 预留给两个 spike，故本决策顺延至 003。

**Context**：`docs/RECON-DSH.md`（2026-08-24）建议把 domi 收缩为 DeepSeek Harness 的三插件发行版，理由是六成 PRD 被平台白送或被现有插件占住。该建议成立的前提是**项目目标为社区影响力**。现确认项目真实目标是**个人实践 + 简历包装 + 吸收各家所长**——在这个目标下，「被平台白送」不是省了工作，而是**取消了产出本身**：写 glue code 不产生可讲的技术决策。

**Decision**：推翻发行版路线，恢复自建运行时（`PRD-VISION.md` 原定位），保留原 M0–M6 里程碑编号与 45 条 PRD 条目。RECON 报告降级为**情报文档**——它标定的六个生态真空（终端可导航轨迹面板、确定性压缩层、压缩×prompt cache 交叉、否决即永久、矛盾检测、单文件 soul 导出）不再是收缩理由，改作 domi 自建版本里的**差异化功能点**，因为它们是被生态验证过的空白而非猜测。

同时确立**引用优先原则**（三类分法，进 `ENGINEERING.md`）：
- **可直接引用的真库**：AI SDK（模型层）、`@modelcontextprotocol/sdk`（MCP）、Playwright MCP / computer-use MCP（#10 全部收敛为 MCP server）、grammY（Telegram）、isomorphic-git 或 spawn git（checkpoint）。**这些一律不自写。**
- **只抄算法做精简版**：shadow git checkpoint（Cline）、ReAct / plan-execute loop、确定性压缩。
- **必须自己写**：事件流内核、轨迹面板、压缩与记忆生成、Soul、评估体系。**简历含金量只在这一类里。**

**Consequences**：换来完整的 agent 实践面与可讲的技术决策；付出的是 110 天全职（业余约 11 个月）的排期，且失去 DSH 95k star 的流量。接受"11 项里有 6 项是配置工作、不列为亮点"这一事实。RECON 报告不删除、不改写，在其头部加一行指向本 ADR。
