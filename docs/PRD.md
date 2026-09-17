# domi — 产品需求文档（全量）

> 覆盖 M0–M8 全部 9 个里程碑（M7 为 v1.8 追加，M8 为 v1.10 追加）。
> **v1.2** · 2026-09-14 · 作者：PM 环节
> 上位文档：`PRD-VISION.md` v1.1（不变量，冲突时以其为准）
> 变更：v1.0 经两轮独立门禁审计后修订，见 `docs/qa/prd-gate-audit-v1.0.md`
> **v1.2 回写**（触发：`docs/adr/003` 方向变更）——**原 45 条编号与 AC 全部保留不动**，仅追加 5 条新需求
> （M1-011 步级快照 · M2-008 L1 回放评估 · M2-009 内置 MCP server · M5-007 聊天端桥接 · M6-005 L2 评估集）
> **v1.11.1 回写**（2026-09-17，TASK-M8-005 实现时发现）——PRD-M8-004 AC-2 划掉，改为 AC-7。
> 理由：原文要求「沙盒外的读写先询问」，但全项目的路径收口（PRD-M0-003 AC-5，`capability/src/paths.ts`）对任何会话都是「越出工作目录就拒绝」，
> 没有「越界但可询问」这一档；为自由会话单开一档等于放宽既有的路径不变量。改为：文件工具在沙盒内收口（越界拒绝），`shell.exec` 每次询问。
> PRD-M8-016 AC-3 里对应的半句一并删掉。
> **v1.11 回写**（2026-09-17，`docs/prd/M8.md` §4）——用户拍板进入 M8（`SKETCH` → `COMMITTED`），并把 TUI 原型并入：追加 PRD-M8-014…017；
> 按拍板改写三条 AC（未开工，划掉原文留痕）：M8-001 AC-3 → AC-5（色板存 daemon，TUI 共用）+ AC-6（共享 token）；M8-002 AC-4 → AC-6（项目树）；M8-004 AC-5 → AC-6（会话栏只放自由会话）。
> **v1.10 回写**（2026-09-17，`docs/prd/M8.md`）——触发：用户给出已确认的 Web 高保真原型（`docs/ui-redesign/`），要求按原型重构并补齐后端。
> **仅追加** M8 一章（13 条需求，成熟度 `SKETCH`，进入前过再批准门）；M0–M7 的编号与 AC 一字未改，不变量不增不改。
> **v1.9.1 回写**（2026-09-16，`docs/spec/M7.md` 取舍-1）——PRD-M7-001 AC-5 划掉，改为 AC-6：后台 job 的输出查询归 `fs.read`、终止仍归 `shell.exec`。
> 理由：`shell.exec` 在默认模板里是 `ask`，原写法下每轮询一次后台输出就要确认一次；查询只读已经产生的输出，不执行任何东西。
> **v1.9 回写**（2026-09-16，`docs/prd/M7.md` §6）——用户拍板：M7 全做（001–010），`SKETCH` → `COMMITTED`。
> **改动的 AC 只有 PRD-M7-002**，理由是用户对 §6 第 2 问的回答「规矩文件认 AGENT.md，需要时可在项目下生成 .domi/（如项目级 Skill）」：
> AC-1 划掉（原写 `AGENTS.md` + `DOMI.md`），新增 AC-6（`AGENT.md`，兼认 `AGENTS.md`）与 AC-5（项目目录 `.domi/`）；AC-3 / AC-4 的断言范围扩到项目目录。
> 其余三问（worktree 放 `~/.domi/worktrees/`、ripgrep 有则用无则退回内置实现）与原建议一致，不改 AC。
> **v1.8 回写**（2026-09-16，`docs/prd/M7.md`）——触发：M6 功能落地后用户提出下一步方向「让 domi 能接手编程任务（开发 domi 自身是其一，不限于此）」。
> **仅追加** M7 一章（10 条需求，成熟度 `SKETCH`，进入前过再批准门）；M0–M6 的编号与 AC 一字未改，不变量不增不改。
> **v1.7 回写**（2026-09-15，`docs/prd/M6.md`）——用户拍板：M6 按现有轮廓进入，`SKETCH` → `COMMITTED`，AC 一字未改。
> 没有系统级沙箱的平台上插件代码默认不运行；GitHub issue 与外部贡献者插件（M6-004 AC-4、DoD）只能由用户完成。
> **v1.6 回写**（2026-09-15，`docs/prd/M5.md`）——用户拍板：M5 按现有轮廓进入，`SKETCH` → `COMMITTED`，AC 一字未改。
> 桌面端在当前开发机上无法构建（无 Rust 工具链），其构建与更新类 AC 记为验证待办。
> **v1.5 回写**（2026-09-15，`docs/prd/M4.md`）——用户拍板：M4 按现有轮廓进入，章节成熟度 `SKETCH` → `COMMITTED`。
> **AC 一字未改。** 章首「两个月真实使用数据」的前提不成立，记为已知代价：M4-001 AC-4 与 M4 DoD 留作验证待办，放到最后做。
> **v1.4 回写**（2026-09-15，`docs/adr/014`）——用户拍板：配置文件由 TOML 改为 YAML（`~/.domi/config.yaml`）。
> 只改四处 AC 里的**格式名**（M0-008 AC-1、M1-005 AC-3、M1-010 AC-1、M5-002 AC-1），断言的行为一条不变；旧 `config.toml` 过渡期内仍可读。
> **v1.3.1 回写**（2026-09-14，`docs/spec/M2.md` 取舍-11）——M2-004 AC-1 的**语义（向量）检索**拆出，随 `docs/adr/010` 的时点在 M4 做；全文检索已交付。
> **v1.3 回写**（2026-09-14，`docs/adr/011`）——用户拍板：MCP 暂时用不上，`PRD-M2-001` 与 `PRD-M2-009` 移入 M3。
> M2 预算 19 → 14 天，M3 15 → 20 天，**合计不变**。AC 原文一个字没改。
> **v1.2.3 回写**（2026-09-14，`docs/spec/M2.md`）——M2-005 的两处验收方式：AC-4 的解耦守卫与 M2-008 AC-5 合并成一份实现；AC-5 改用 Bun 内置 HTMLRewriter 而非 Playwright（导出文件里一行 JS 都没有，验的是文档结构不是渲染）。
> **v1.2.2 回写**（2026-09-14，`docs/spec/M2.md`）——M2-008 AC-1 fixture 落盘格式改为单文件 JSON、AC-4 的「跳转轨迹面板」拆到 PRD-M2-005 一起验收。
> **v1.2.1 回写**（2026-09-14，`docs/adr/005`）——M0-007 AC-2 降级、M0-006 新增 AC-4/AC-5（拼装策略改为可选项）。
> 并回写 M0 的"不做什么"（模型层选型见 `docs/adr/004`）。

---

## 0. 阅读说明

### 0.1 成熟度标记

本文档一次性覆盖全部里程碑，但**远期部分不具备约束力**：

| 里程碑 | 成熟度 | 含义 |
|---|---|---|
| M0 · 内核骨架 | `COMMITTED` | 可直接进入架构设计 |
| M1 · 能用 | `COMMITTED` | 可直接进入架构设计 |
| M2 · 可信 | `PROVISIONAL` | 方向定，细节会调整 |
| M3 · 三端 | `PROVISIONAL` | 方向定，细节会调整 |
| M4 · 有灵魂 | `COMMITTED` | 2026-09-15 再批准，见 `docs/prd/M4.md` |
| M5 · 会干活 | `COMMITTED` | 2026-09-15 再批准，见 `docs/prd/M5.md` |
| M6 · 生态 | `COMMITTED` | 2026-09-15 再批准，见 `docs/prd/M6.md` |
| M7 · 会写代码 | `COMMITTED` | 2026-09-16 追加并再批准，见 `docs/prd/M7.md` |

**再批准门**：进入任何非 `COMMITTED` 里程碑之前，必须把该章重写为 `COMMITTED` 并重过 PM 门禁。跳过 = 跑偏。

### 0.2 需求条目格式

每条包含：ID · 用户价值 · 可执行验收标准(AC) · 验收方式 · 层级(Invariant/Negotiable) · 优先级。

**没有可执行验收方式的条目不允许存在。** 自然语言验收 = 主观验收 = 必然放水。
「可执行」的判据：**一个自动化测试、一段带断言的脚本、或一份 golden 快照能判定它通过或失败。**
"合理""清晰""易用""看得懂"这类词出现在 AC 里，就是这条 AC 还没写完。

### 0.3 优先级语义

- **P0** —— 该里程碑 DoD 直接依赖它，不做完不准进下一环
- **P1** —— 应该做，预算紧张时延到下一里程碑
- **P2** —— 预算超 20% 时第一批砍掉，砍的决策进 ADR

### 0.4 nightly 验收的 P0 如何判定

部分 P0 条目的关键验收依赖真实模型调用，而真实调用不进 CI 门禁（INV-08）。
规则：**这类条目的 CI 部分必须全绿，nightly 部分在里程碑退出评审时人工核对最近一次结果并记入 QA 报告。**
nightly 缺失或连续 3 天失败 = 该 P0 未完成。

### 0.5 P0 砍不动时怎么办

如果一个里程碑的 P0 做不完，**正确处理是缩小里程碑范围（把条目整体挪到下一册并记 ADR），不是降级 P0**。
P0 的定义是"DoD 依赖它"，降级 P0 等于偷偷改 DoD——这正是腐蚀。

---

## 1. 里程碑总览

| # | 名称 | 版本 | 预算 | 要回答的问题 | 社区叙事点 |
|---|---|---|---|---|---|
| M0 | 内核骨架 | v0.0.1 | 10 天 | 终端里能否跑通一次完整的读→改→测闭环 | 无（不宣传） |
| M1 | 能用 | v0.1 | **17 天** | 我自己愿不愿意每天用它 | 一张 TUI 的 GIF |
| M2 | 可信 | v0.2 | **14 天** | 用户能否看懂并信任它做的每一步 | 轨迹截图 + 回放评估 |
| M3 | 三端 | v0.3 | **20 天** | 终端起的任务能否在浏览器里接着看；接上 MCP 生态 | 跨端演示 + MCP |
| M4 | 有灵魂 | v0.4 | 20 天 | domi 能否积累出可分享的人格 | Soul（主爆点） |
| M5 | 会干活 | v0.5 | **17 天** | 能否跑一个 30 分钟不断线的长任务 | 长任务 demo |
| M6 | 生态 | v1.0 | **24 天** | 别人能否给它写插件 | v1.0 发布 |

合计 **124 天**全职 ≈ 6 个月；业余（每周 10 小时）约 12 个月。（v1.2：+14 天，来自 5 条新增需求）
（v1.3：MCP 的 5 天从 M2 挪到 M3，**合计不变**——这是排期调整，不是范围变化。见 `docs/adr/011`）

---

# M0 · 内核骨架 `COMMITTED`

**要回答的问题**：domi 能不能在终端里完成一次"读文件 → 改代码 → 跑测试"的完整闭环。

**不做什么**：不做多 provider 配置界面（M0 只跑通一条 provider，但**必须走 `packages/model` 窄接口**，不硬编码进 kernel——见 `docs/adr/004`）· 不做压缩（超长直接报错）· 不做会话列表 · 不做 MCP/Skill/插件 · 不做快照回滚（M1-011）· 不做 Web/桌面端 · 不拆 daemon · TUI 不做美化。

**预算**：10 天。超 12 天必须缩小范围并记 ADR（见 §0.5）。

---

### PRD-M0-001 · 会话以 append-only 事件流持久化

- **用户价值**：任何一次对话都能被完整回放和审计，且未来的压缩不会销毁历史。
- **AC**
  - AC-1：一轮完整对话（输入→模型→工具→结果）产生的事件按 seq 连续写入 SQLite，`SELECT` 出的 seq 序列无空洞、无重复
  - AC-2：`kill -9` 后重启，重放事件流得到的会话状态与崩溃前 **JSON 深比较相等**
  - AC-3：源码中不存在针对事件表的 `UPDATE` / `DELETE` 语句
  - AC-4：事务中途抛异常后重启，事件表中不存在半条事件（字段缺失或 seq 悬空）
  - AC-5：**加载一份包含 3 个历史 schema 版本的混合 fixture，全部事件可解析且重放成功**（守 INV-01 的"永远可解析"，v1.0 缺失此项）
- **验收方式**
  - AC-1/2/4：`bun test store/event-log.spec.ts`
  - AC-3：`scripts/check-append-only.ts`（AST 扫描，CI 阻断）
  - AC-5：`bun test store/schema-compat.spec.ts` + `fixtures/events/legacy-v{1,2,3}.jsonl`
- **层级**：Invariant（INV-01、INV-12）· **优先级**：P0

### PRD-M0-002 · 与单一模型完成多轮工具调用对话

- **用户价值**：这是 agent 的最小可用形态。
- **AC**
  - AC-1：用户提交输入后 **≤100ms 内**渲染等待指示组件（TUI 快照中存在 `<Spinner>` 节点）
  - AC-2：模型请求工具调用时执行并回灌结果继续；单轮达到 20 次工具循环时强制停止，产生 `error{recoverable:true}` 并提示用户
  - AC-3：模型返回畸形 JSON 参数时产生 `error` 事件并把解析错误回灌重试，**最多 3 次**，第 4 次终止
  - AC-4：流式响应在中途截断时产生 `error{recoverable:true}`，会话事件流仍满足 AC-1 of M0-001，用户可继续输入
- **验收方式**
  - AC-2/3/4：`bun test kernel/loop.spec.ts`，fixture 覆盖 `20-tool-loop` / `malformed-args` / `truncated-stream`
  - AC-1：`bun test tui/pending-indicator.spec.ts`（渲染快照 + 时间戳断言）
- **层级**：Negotiable · **优先级**：P0

### PRD-M0-003 · 工具执行前需用户确认，默认拒绝

- **用户价值**：用户不会在无感知的情况下被改动文件或执行命令。
- **AC**
  - AC-1：`fs.write` / `shell.exec` 触发确认，TUI 快照中包含完整的待执行内容（写入的 diff / 待执行的命令行）
  - AC-2：用户拒绝后产生 `tool.result{ok:false, reason:'user_denied'}`，模型收到语义化的拒绝说明而非异常
  - AC-3：每次权限决策产生独立事件，**必须含字段**：`capabilityId` / `decision`(allow|deny|ask) / `source`(default|config|user) / `matchedRule`
  - AC-4：未在权限配置中显式声明的能力，**默认拒绝且不询问**（fail-closed）——断言默认配置下 `PermissionEngine.check()` 返回 deny
  - AC-5：`fs.read` 限制在工作目录内；**8 个路径穿越用例**（`../`、绝对路径、符号链接、`..%2f`、NUL 截断、大小写变体、UNC、`~` 展开）全部被拒绝
- **验收方式**
  - AC-2/3/4/5：`bun test capability/permission.spec.ts`
  - AC-1：`bun test tui/confirm-dialog.spec.ts`（渲染快照）
- **层级**：Invariant（INV-03）· **优先级**：P0

### PRD-M0-004 · 三个内置工具

- **用户价值**：读→改→测闭环所需的最小工具集。
- **AC**
  - AC-1：`fs.read` 支持行范围；> 1MB 的文件返回结构化截断提示（含总行数与已返回范围），不返回全文
  - AC-2：`fs.write` 写入前后各产生一条事件，含内容 SHA-256，据此可重建 diff
  - AC-3：`shell.exec` 默认超时 120s；超时产生 `tool.result{ok:false, reason:'timeout'}` 且子进程被终止（断言进程不存在）
  - AC-4：`shell.exec` 输出 > 100KB 时截断为头 20KB + 尾 20KB + 中间省略标记，标记含被省略字节数
- **验收方式**：`bun test capability/builtin-tools.spec.ts`
- **层级**：Negotiable · **优先级**：P0

### PRD-M0-005 · 极简 TUI

- **用户价值**：能看见对话、工具调用和确认提示。
- **AC**
  - AC-1：显示流式输出、工具调用名与参数摘要（**摘要规则：JSON 序列化后取前 80 字符 + `…`**）、工具结果
  - AC-2：确认提示可用 y/n 响应；连续三次渲染后焦点仍在确认组件（断言 focusId 不变）
  - AC-3：Ctrl+C 退出前 flush 事件，退出后重放事件流不丢最后一轮
  - AC-4：在 40 / 60 / 80 / 200 列四种宽度下渲染 golden 快照，**diff 为 0**
- **验收方式**：`bun test tui/*.spec.ts`（OpenTUI 测试渲染器 + golden 快照）；`demos/m0-loop.md` 人工走查作为补充而非主要判据
- **层级**：Negotiable · **优先级**：P0

### PRD-M0-006 · 上下文拼装是纯函数

- **用户价值**（对开发者）：这是 M2 压缩、M4 记忆的可测性基础。
- **AC**
  - AC-1：`buildContext(events, policy)` 所在模块的依赖闭包中不含 `node:fs` / `node:net` / `Date.now` / `Math.random`
  - AC-2：同一事件流两次调用，结果 JSON 序列化后 byte 级相同
  - AC-3：给定 fixture 事件流，输出的 messages 数组可被完整深比较断言
  - **AC-4（2026-09-14 新增，回写自 `docs/adr/005`）**：拼装策略是 `ContextPolicy` 上的可选项，经注册表挂载。断言三件事——① 不传 `strategy` 时默认 `'full'`；② 传入未注册的策略名产生明确错误（含可用策略列表），不静默回退默认；③ **注册一个新策略不需要修改 `buildContext` 本身**（测试中注册一个自定义策略并断言它被调用）
  - **AC-5（同上）**：`'incremental'` 在 M0 是占位——调用时抛出明确指向 `docs/adr/005` 的错误，**不得**静默降级为 `'full'`。ADR-005 的限定是"option 只是注册点，不是两套实现"，静默降级会让这条限定失效且无人察觉
- **验收方式**：`bun test kernel/build-context.spec.ts`；AC-1 由 `dependency-cruiser` 规则 `no-io-in-kernel` 守（CI 阻断）
- **层级**：Invariant（INV-02）· **优先级**：P0

### PRD-M0-007 · 关键风险的 spike 结论落盘

- **用户价值**（对项目）：把最贵的架构风险在第一周暴露掉。
- **AC**
  - AC-1：`docs/adr/001-runtime-choice.md` 存在，且**包含固定字段**：`## 实测-渲染帧耗时P95` / `## 实测-native模块兼容清单` / `## 结论` / `## 若不通的退路`
  - ~~AC-2~~：**已回写（2026-09-14，`docs/adr/005`）**。原要求 `docs/adr/002-buildcontext-perf.md` 含实测毫秒数；压测已从 M0 门禁降级，拼装策略改为运行期可选项。本条替换为：`docs/adr/005-context-strategy-as-option.md` 存在，且含 `## 触发重新激活压测的条件` 段
  - AC-3：`git branch -a` 中无 `spike/*` 分支，且 main 中无 `spike` 目录
- **验收方式**：`scripts/check-adr-fields.ts`（字段存在性 + 数值格式校验，CI 阻断）
- **层级**：Negotiable · **优先级**：P0（**AC-1 的 TUI spike 仍须在 M0 早期完成**；AC-2 已降级，见 `docs/adr/005`）

### PRD-M0-008 · 配置与凭据

- **用户价值**：不用改代码就能填 API key，且 key 不会泄露到任何产物里。
- **AC**
  - AC-1：从 `~/.domi/config.yaml` 与环境变量读取，环境变量优先（断言优先级）—— v1.4 回写：原为 `config.toml`，见 `docs/adr/014`
  - AC-2：**对全量事件流与日志输出做正则扫描，不存在 `sk-[A-Za-z0-9]{20,}` 等 5 类凭据模式**
  - AC-3：缺少凭据时退出码为 2，stderr 输出命中文案 key `error.missing_credential` 且不含 `at Object.<anonymous>` 等堆栈特征
- **验收方式**：`bun test config/*.spec.ts`；AC-2 另由 `scripts/scan-secrets.ts` 在 CI 中对测试产生的全部 fixture 事件流扫描
- **层级**：Invariant（INV-11）· **优先级**：P0

**M0 引用的不变量**：INV-01 / 02 / 03 / 11 / 12（INV-07 / 08 / 10 属流程约束，由 CI 与任务 lint 守，不设 PRD 条目）

**M0 DoD**：`demos/m0-loop.md` 完整走通——在一个真实项目里让 domi 读一个文件、改一处代码、跑测试并报告结果，全程用户可确认每一步。

---

# M1 · 能用 `COMMITTED`

**要回答的问题**：我自己愿不愿意每天用它。

**不做什么**：不做 MCP/Skill/插件/压缩/记忆 · 不做 Web/桌面端 · 不拆 daemon · **不做跨会话内容检索**（只有会话列表与按标题过滤；跨会话内容检索是 M2-004）。

**预算**：15 天。

---

### PRD-M1-001 · 多模型接入

- **用户价值**：不被单一供应商绑定，能用本地模型。
- **AC**
  - AC-1：支持 Anthropic / OpenAI / Google / OpenAI-compatible（覆盖 llama.cpp、vLLM、Ollama）四类，每类至少一组 replay fixture 通过
  - AC-2：每个 provider 声明能力矩阵布尔字段：`toolCall` / `vision` / `reasoning` / `promptCache` / `structuredOutput`
  - AC-3：调用未声明支持的能力时，**在发出 HTTP 请求之前**抛出 `UnsupportedCapabilityError`（断言 fetch 未被调用）
  - AC-4：新增 provider 只需实现接口 + 注册；断言方式：测试中新增一个 mock provider 并跑通完整对话，**`packages/kernel` 与 `packages/model/core` 的 diff 为 0**
  - AC-5：provider 返回 429 / 5xx / 超时时，按指数退避重试（默认 3 次）；重试耗尽后产生 `error{recoverable:true}` 并提示可切换模型，**不丢失会话**
- **验收方式**：`bun test model/*.spec.ts`（含 `retry-backoff.spec.ts` 覆盖 AC-5 的 429/500/timeout 三类 fixture）；AC-4 由 `scripts/check-provider-isolation.sh` 在 CI 中比对 diff
- **层级**：Negotiable · **优先级**：P0

### PRD-M1-002 · 会话中途切换模型

- **用户价值**：贵模型想思路、便宜模型跑体力活。
- **AC**
  - AC-1：切换产生 `model.switch` 事件，轨迹中可定位到起始 seq
  - AC-2：切换到能力更弱的模型时（能力矩阵中有字段从 true 变 false），弹出确认并列出将失去的能力名
  - AC-3：切换后按新模型窗口重新拼装上下文，历史事件零丢失（断言事件总数不变）
- **验收方式**：`bun test kernel/model-switch.spec.ts` + `tui/switch-warning.spec.ts`
- **层级**：Negotiable · **优先级**：P1

### PRD-M1-003 · 分层提示词系统

- **用户价值**：提示词可组合、可覆盖、可调试；也是 prompt cache 能打对的前提。
- **AC**
  - AC-1：提示词由带 `role` 与 `priority` 的层组成，拼装顺序完全由 priority 决定（给定乱序输入，断言输出顺序）
  - AC-2：每层声明 `cacheable`；**存在任一 cacheable 层排在非 cacheable 层之后时，构建期抛错**
  - AC-3：用户可在 `config.yaml` 中覆盖或追加层，不改代码即生效（断言配置注入的层出现在 dump 中）—— v1.4 回写：原为 `config.toml`
  - AC-4：`domi prompt dump` 输出最终拼装结果，含各层 id、边界标记与 token 数
- **验收方式**：`bun test prompt/layering.spec.ts`；AC-2 同时由类型系统（编译期）与运行时断言双重保证
- **层级**：Negotiable · **优先级**：P0

### PRD-M1-004 · prompt cache 实际命中

- **用户价值**：成本和首 token 延迟降低数倍。
- **AC**
  - AC-1：连续多轮对话中，从第二轮起 provider 返回的 `cache_read_tokens` > 0
  - AC-2：**10 轮标准会话的缓存命中率写入趋势文件 `bench/cache-hit.jsonl`；低于 80% 时 nightly 告警并要求人工判定**（非 pass/fail 门槛——它依赖 provider 非确定性行为，见 §0.4）
  - AC-3：缓存前缀 byte 级稳定——同一会话连续两轮，`buildContext` 输出的前 N 层拼装结果完全相同；动态内容（时间戳、状态数据）只出现在最后一条 user message
  - AC-4：命中率与缓存节省的 token 数在状态栏可见
- **验收方式**：AC-3 由 `bun test prompt/cache-prefix.spec.ts` 断言（这是 CI 门禁部分）；AC-1/2 由 `scripts/measure-cache.ts` 在 nightly 跑真实会话（INV-08）
- **层级**：Negotiable · **优先级**：P1

### PRD-M1-005 · 结构化输出

- **用户价值**：会话标题生成、后续的摘要与记忆抽取都依赖能从模型拿到可靠的结构化数据。M1 内的直接消费方是会话标题生成（PRD-M1-006 AC-1）。
- **AC**
  - AC-1：以 zod schema 声明期望结构，返回值类型安全且经运行时校验
  - AC-2：对声明 `structuredOutput: true` 的 provider 走原生通道（断言请求体含 `response_format`）
  - AC-3：对不支持的 provider 降级为"提示词约束 + 解析 + 重试"，**最多 3 次**，接口签名与返回类型对上层完全一致
  - AC-4：3 次仍失败时抛 `StructuredOutputError`，`error.raw` 含最后一次原始返回全文
- **验收方式**：`bun test model/structured-output.spec.ts`，fixture 含 `valid` / `malformed-json` / `schema-mismatch` / `never-valid` 四类
- **层级**：Negotiable · **优先级**：P1

### PRD-M1-006 · 会话管理

- **用户价值**：能回到昨天的对话继续，能从某一步分叉重试。
- **AC**
  - AC-1：列出会话（时间、标题、模型、消息数、花费）；标题由首轮对话经结构化输出自动生成，失败时降级为首条用户输入前 40 字符
  - AC-2：恢复任一会话，状态与离开时深比较相等
  - AC-3：从任一 seq 分支出新会话；断言分支后向任一分支追加事件，**另一分支的事件集合不变**
  - AC-4：删除需二次确认，默认软删除（`deleted_at` 置位，事件保留），`domi session restore <id>` 可恢复
  - AC-5：**时间戳按系统本地时区展示，列表中显示相对时间（"3 小时前"）**，绝对时间在详情中以 ISO-8601 带时区偏移展示
- **验收方式**：`bun test store/session.spec.ts`（AC-2/3/4/5）+ `bun test session/title-gen.spec.ts`（AC-1，含结构化输出失败的降级路径 mock）
- **层级**：Negotiable · **优先级**：P0

### PRD-M1-007 · 实时状态栏

- **用户价值**：随时知道花了多少钱、上下文还剩多少——这是"愿意每天用"的关键，不知道成本的工具不敢常用。
- **AC**
  - AC-1：显示当前模型、累计 token（输入/输出/缓存读）、累计花费、本轮耗时、工具调用次数
  - AC-2：显示上下文占用百分比；**≥70% 时渲染为 warn 色，≥90% 时为 danger 色**（颜色状态快照可断言）
  - AC-3：所有数据由事件流聚合得出；断言方式——删除状态栏模块后 `kernel` 全部测试仍绿
  - AC-4：花费按可配置价目表计算；未在价目表中的模型显示 `—`，且不参与累计（断言不产生 NaN 或 0）
- **验收方式**：`bun test kernel/metrics.spec.ts`（AC-1/3/4，给定 fixture 断言聚合结果）+ `bun test tui/statusbar.spec.ts`（AC-2 颜色状态快照）
- **层级**：Negotiable · **优先级**：P0

### PRD-M1-008 · 分发与首次运行

- **用户价值**：五分钟内从零到第一次对话。
- **AC**
  - AC-1：`npx domi` / `bunx domi` 可直接运行
  - AC-2：单二进制产物（macOS arm64/x64、Linux x64/arm64）在无 Node 的干净容器中运行成功
  - AC-3：首次运行的引导流程为固定步骤清单（选 provider → 填凭据 → 校验连通 → 进入对话），**冒烟脚本按步骤逐个断言提示出现**，全程无需外部文档
  - AC-4：`domi doctor` 的每条问题输出**必须含一条可直接复制执行的命令**（断言输出行匹配 `` `^\$ .+` `` 格式）
- **验收方式**：CI 构建四平台产物 + `scripts/smoke-binary.sh`（干净容器）+ `bun test cli/onboarding.spec.ts` / `cli/doctor.spec.ts`
- **层级**：Negotiable · **优先级**：P1

### PRD-M1-009 · 日志与故障排查

- **用户价值**：出问题时能自己查，也能贴给别人看。
- **AC**
  - AC-1：日志写入 `~/.domi/logs/`，按天轮转，保留 7 天，单文件上限 50MB
  - AC-2：级别 `error|warn|info|debug`，默认 `info`，可由 `DOMI_LOG` 覆盖
  - AC-3：**日志与事件流一样经过凭据脱敏**（复用 PRD-M0-008 AC-2 的扫描）
  - AC-4：`domi report-bug` 打包最近日志 + 版本 + 环境信息为单个 zip，**打包前展示将包含的文件清单并要求确认**
- **验收方式**：`bun test observability/logging.spec.ts`；AC-3 复用 `scripts/scan-secrets.ts`
- **层级**：Invariant（INV-11）· **优先级**：P1

### PRD-M1-010 · 卸载与数据清理

- **用户价值**：本地优先意味着数据在你手里——包括随时全部拿走或删掉的权利。
- **AC**
  - AC-1：`domi data export` 导出全部会话事件流与配置为单个归档，格式为可自行解析的 JSONL + YAML（无私有二进制）—— v1.4 回写：原为 TOML
  - AC-2：`domi data purge` 清空 `~/.domi/`；执行前列出将删除的目录与总大小，需输入确认词
  - AC-3：purge 后文件系统中 `~/.domi` 下无残留（断言目录为空或不存在）
  - AC-4：domi 运行期间**不向 `~/.domi/` 与当前工作目录以外的位置写文件**（断言方式：在测试中监控写入路径）
- **验收方式**：`bun test data/portability.spec.ts`；AC-4 由 `scripts/check-write-paths.ts` 在集成测试中拦截 fs 写入
- **层级**：Invariant（INV-11）· **优先级**：P1

### PRD-M1-011 · 步级快照与回滚

> v1.2 新增。算法抄自 Cline 的 shadow git checkpoint（`PRD-VISION.md` §6 第二类：只抄算法）。

- **用户价值**：agent 改坏了文件能一键退回，且不污染用户自己的 git 历史——这是"敢让它动我的代码"的前提。
- **AC**
  - AC-1：每次 `fs.write` / `shell.exec` 成功后产生一个快照，快照 id 写入该步的事件；快照仓库位于 `~/.domi/shadows/<workspace-hash>/`，**断言工作目录下的 `.git/` 在快照前后 `HEAD`、index、reflog 三者均无变化**
  - AC-2：能快照 **untracked 文件**（新建但未 `git add` 的文件回滚后消失），且尊重 `.gitignore` 与内置排除表（`node_modules`/`dist`/`.venv`）
  - AC-3：回滚提供三种粒度：仅文件 / 仅对话 / 两者，各自产生一条 `revert` 事件（**append-only，不删除既有事件**，守 INV-01/INV-12）；被 revert 区间的事件标记为 dead 但可读
  - AC-4：**回滚前自动对当前工作区打一次快照**，因此"回滚"本身可被回滚（断言连续两次回滚可回到初始状态）
  - AC-5：`domi diff <step>` 输出该步的文件变更；**超过 `snapshot.maxFileBytes`（默认 5MB）的文件只记录路径与 SHA-256，不存内容**，diff 中显式标注"内容未快照"
  - AC-6：TUI 明示快照**不覆盖**的副作用范围（已执行的 shell 命令、网络请求、已 push 的 commit）——断言回滚确认框文案中包含该提示
- **验收方式**：`bun test checkpoint/*.spec.ts`（AC-1~5，含一个带 `.gitignore` 与 untracked 文件的 fixture 仓库）+ `bun test tui/revert-dialog.spec.ts`（AC-6 渲染快照）
- **层级**：Invariant（INV-01、INV-12）· **优先级**：P0

**M1 引用的不变量**：INV-01 / 02 / 03 / 11 / 12

**M1 DoD**：连续 5 个工作日用 domi 完成自己的真实开发任务且不切回其他工具；**其中至少发生 1 次真实的步级回滚**；产出一段 30 秒 GIF。

---

# M2 · 可信 `PROVISIONAL`

> 进入前需重写为 `COMMITTED` 并重过 PM 门禁。以下方向确定，细节会随 M0/M1 实现反馈调整。

**要回答的问题**：用户能否看懂并信任 domi 做的每一步。

**不做什么**：不做 Web/桌面端（M2-005 AC-5 的 HTML 导出是**静态快照文件**，不是交互式客户端，二者边界见该条 AC）· 不做 Soul · 不做 Skill/插件 · 不做编排 · **不做 MCP**（`PRD-M2-001` 与 `PRD-M2-009` 已移到 M3，见 `docs/adr/011`）。

**预算**：14 天（v1.3 由 19 天下调，MCP 的 5 天随条目移到 M3）。

### PRD-M2-001 · MCP client（对齐 2026-07-28 规范）—— **已移至 M3**

> **v1.3：本条整体移入 M3**（`docs/adr/011`）。AC 原文不改——这是排期调整，不是范围降级。
> 理由：现在没有具体要接的 MCP server，而上游 SDK 的 v2 仍是 beta；
> 为一个用不上的能力去背破坏性变更税，是先付钱后确认需求。
> 触发重新评估的条件写在 ADR-011。
- **用户价值**：接入生态里已有的大量 MCP server。
- **AC**
  - AC-1：能连接 stdio 与 Streamable HTTP 两类 server，列出并调用其 tool
  - AC-2：实现 MRTR（`resultType:"input_required"` → 带 `inputResponses` 重试），fixture 覆盖单轮与两轮追问
  - AC-3：遵守列表缓存提示（`ttlMs` / `cacheScope`）；断言 TTL 内第二次连接不发出 list 请求
  - AC-4：源码中不存在对已弃用的 `sampling` / `roots` / `logging` 的调用（AST 扫描）
  - AC-5：某 server 连接失败或超时不影响其他 server 与主循环（断言其余 server 的 tool 仍可调用）
  - AC-6：**MCP server 的出站连接受域名白名单约束**，未在配置中声明的 host 被拒绝并产生事件（显式守 INV-11，不依赖 NFR-05 兜底）
- **验收方式**：`bun test mcp/*.spec.ts`；AC-4 由 `scripts/check-deprecated-mcp.ts`（CI 阻断）；对 3 个真实 server 的兼容性测试走 nightly（§0.4）
- **层级**：Invariant（INV-11）· **优先级**：P1（M2 DoD 不依赖 MCP）

### PRD-M2-002 · 确定性上下文清理（压缩第一层）
- **AC**
  - AC-1：去重相同工具结果、规范化冗长输出、清除已解决的错误、截断堆栈
  - AC-2：在 10 个标准会话 fixture 上**平均减少 ≥15% token**，且被后续事件引用过的内容 100% 保留（引用关系由 fixture 显式标注，逐条断言）
  - AC-3：全过程无 LLM 调用（断言 model provider 未被调用）；同输入同输出，byte 级一致
  - AC-4：清理产生 `ctx.cleanup` 事件，含各类别削减的 token 数
- **验收方式**：`bun test memory/structural-cleanup.spec.ts`，含削减比例与引用保留的双重断言
- **层级**：Negotiable · **优先级**：P0

### PRD-M2-003 · LLM 压缩（保边压中 + 结构化摘要）
- **AC**
  - AC-1：上下文达窗口 70–75% 自动触发；`/compact` 可手动触发
  - AC-2：system prompt + 最近 N 轮逐字保留（断言这部分 byte 级未变），中间历史替换为摘要
  - AC-3：摘要为**固定字段结构**（`Intent` / `FilesModified` / `KeyDecisions` / `OpenQuestions` / `NextSteps`），经 zod 校验，非自由文本
  - AC-4：压缩只产生 `ctx.compact` 事件与摘要投影；断言压缩前后事件表行数只增不减，且原事件内容哈希不变（INV-12）
  - AC-5：压缩后从原始事件流重放，可得到与压缩前深比较相等的完整状态
  - AC-6：切换压缩策略实现，`packages/kernel` diff 为 0
- **验收方式**：`bun test memory/compactor.spec.ts`——用例名与 AC 一一对应：`triggers-at-threshold`(AC-1) / `preserves-edges-bytewise`(AC-2) / `summary-schema-valid`(AC-3) / `events-immutable`(AC-4) / `replay-equivalence`(AC-5) / `strategy-pluggable`(AC-6)。**AC-5 是核心断言。** 摘要内容质量走 nightly eval（§0.4）
- **层级**：Invariant（INV-12）· **优先级**：P0

### PRD-M2-004 · L2 跨会话内容检索
- **用户价值**：能问"上次我们怎么解决那个 CORS 问题的"。**与 M1 的会话列表过滤是两回事**：那个按标题匹配当前会话列表，这个按内容检索全部历史事件。
- **AC**
  - AC-1：历史事件可按全文（FTS5，**已交付**）~~与语义（向量）~~检索，每条结果携带 `sessionId` + `seq` 可溯源。**向量那一半随 `docs/adr/010` 的时点走**（M4，做 `PRD-M4-001` 时；在有真实语料之前选向量方案等于抛硬币） —— v1.3.1 回写，理由见 `docs/spec/M2.md` 取舍-11
  - AC-2：检索作为 tool 暴露给模型，由模型决定何时调用
  - AC-3：相似度低于阈值时返回明确的 `{found:false}`，**不返回低相关度结果**（断言：用无关 query 检索时结果为空而非返回 top-k）
  - AC-4：10 万条事件规模下检索 P95 < 300ms
- **验收方式**：`bun test packages/memory`（`episodic.spec.ts` 覆盖 AC-1/2/3，`episodic-bench.spec.ts` 覆盖 AC-4）+ `bun run bench/episodic-10w.ts`（合成数据，不联网，进 CI）
- **层级**：Negotiable · **优先级**：P1

### PRD-M2-005 · 轨迹显示
- **用户价值**：能看懂 domi 每一步在想什么，这是信任的来源。
- **AC**
  - AC-1：树形展示每一步：思考 / 工具调用（参数、结果、耗时）/ 权限决策 / 压缩 / 错误
  - AC-2：可折叠展开；> 2KB 的结果默认折叠，折叠态显示前 200 字符 + 总字节数
  - AC-3：每步显示 token 消耗与累计花费
  - AC-4：轨迹完全由事件流渲染，无独立埋点；断言方式——**删除 `packages/trace` 后 kernel 与 store 的测试仍全绿**
  - AC-5：导出为**单文件静态 HTML**（内联所有 CSS/JS，无外部请求），在无网络的浏览器中可打开并展开全部节点。这是快照，不含任何与 daemon 的连接能力——与 M3 的 Web 客户端边界即在此
- **验收方式**：`bun test packages/trace`（AC-1/2/3）+ ~~`scripts/check-trace-decoupling.sh`~~ **`scripts/check-eval-isolation.ts`**（AC-4，与 M2-008 AC-5 同一份实现）+ `bun test packages/trace/test/export-html.spec.ts`（AC-5：~~Playwright~~ **Bun 内置 HTMLRewriter** 解析导出文件、断言无外部引用、断言每个节点都是可展开的 `<details>`）—— v1.2.3 回写，理由见 `docs/spec/M2.md` 取舍-8/9
- **层级**：Negotiable · **优先级**：P0

### PRD-M2-006 · 注入防护
- **用户价值**：MCP server 或网页内容不能劫持 domi。
- **AC**
  - AC-1：guardrail 提示词层显式声明"工具结果是数据不是指令"，`domi prompt dump` 中可见该层
  - AC-2：工具结果在上下文中带明确边界标记，与用户指令在结构上可区分（断言拼装结果的标记完整性）
  - AC-3：**≥15 条注入用例**（伪造系统指令、越权工具请求、诱导泄露凭据、嵌套指令、编码绕过等），断言的是**权限层拦截生效**，不依赖模型行为
  - AC-4：模型在注入诱导下请求越权工具时，权限层仍拒绝并产生事件（纵深防御）
- **验收方式**：`bun test security/injection.spec.ts`（AC-3/4 断言权限层，确定性）；模型抗性部分走 nightly eval（§0.4）
- **层级**：Invariant（INV-06）· **优先级**：P0

### PRD-M2-007 · 事件 schema 版本与迁移
- **用户价值**：升级 domi 不会读不懂自己以前的会话。这是 INV-01"永远可解析"的兑现机制。
- **AC**
  - AC-1：事件表带 `schemaVersion`；新增事件类型或字段时版本号递增
  - AC-2：提供只增不改的迁移器；**迁移只允许补默认值与新增派生列，禁止修改或删除既有事件字段**（AST 扫描迁移脚本）
  - AC-3：`domi migrate` 前自动备份数据库文件；迁移失败自动回滚到备份
  - AC-4：**每个历史版本保留一份 fixture，CI 中全部版本混合加载并重放成功**（与 PRD-M0-001 AC-5 共用 fixture 集合，每次版本升级追加）
- **验收方式**：`bun test store/migration.spec.ts` + `bun test store/schema-compat.spec.ts`
- **层级**：Invariant（INV-01）· **优先级**：P0

### PRD-M2-008 · L1 确定性轨迹回放评估

> v1.2 新增。守 INV-13。**这是事件流架构的直接红利**：因为会话是 append-only 事件流，真实会话可以原样当作测试 fixture。

- **用户价值**：改了 prompt、换了模型、动了压缩策略之后，能立刻知道有没有把原来能跑通的场景搞坏——而且不花钱、不联网。
- **AC**
  - AC-1：`domi eval record <sessionId>` 把一条真实会话导出为 fixture（~~事件流 JSONL~~ **单文件 JSON**，含每轮模型输出 + 工具调用的输入输出对） —— v1.2.2 回写，理由见 `docs/spec/M2.md` §取舍-1
  - AC-2：`domi eval run` 以 fixture 中的模型响应**逐条回放**，kernel 走真实代码路径，**断言产生的工具调用序列（名称 + 归一化后的参数）与 fixture 一致**
  - AC-3：**L1 在无网络环境下必须通过**——测试进程内对出站 socket 打桩，任何真实模型调用使测试失败（守 INV-13 与 INV-08）
  - AC-4：差异报告指出第一个分叉点的 seq、期望与实际（**跳转到轨迹面板**这一半随 PRD-M2-005 一起验收；现在报告已给出 seq 这个锚点） —— v1.2.2 回写，理由见 `docs/spec/M2.md` §取舍-2
  - AC-5：**删除 `packages/eval` 后 `packages/kernel` 与 `packages/store` 的测试仍全绿**（守 INV-13"不新增埋点"）
  - AC-6：回放对非确定性输入（时间戳、随机 id、绝对路径、耗时）做归一化，**同一 fixture 连续跑 10 次结果完全一致**
- **验收方式**：`bun test packages/eval`（AC-1/2/3/4/6）+ `scripts/check-eval-isolation.ts`（AC-5，CI 阻断，`pnpm guard:eval`）+ `fixtures/sessions/*.json`
- **层级**：Invariant（INV-13）· **优先级**：P0

### PRD-M2-009 · 内置 MCP server 清单（browser use / computer use）—— **已移至 M3**

> **v1.3：随 PRD-M2-001 一起移入 M3**（`docs/adr/011`）。它依赖 MCP client，单独留在 M2 没有意义。

> v1.2 新增。`PRD-VISION.md` §6 第一类：**全部收敛为 MCP server，domi 零实现**。本条不进 §3 成功标准的判据。

- **用户价值**：开箱就能让 agent 看网页、点界面，而 domi 自己不背这两块的维护成本。
- **AC**
  - AC-1：内置配置模板可一键启用 Playwright MCP 与 computer-use MCP；**`packages/` 下不存在任何浏览器或 GUI 自动化的自研实现**（依赖扫描断言：不直接依赖 `playwright` / `puppeteer` / `nut-js`）
  - AC-2：这两类 server 的工具与普通 MCP 工具**走同一条权限路径**，默认拒绝（守 INV-03）；截图/像素数据不写入事件流正文，只存引用
  - AC-3：server 缺失或启动失败**降级为该组工具不可用**，不影响主循环与其他 server（复用 PRD-M2-001 AC-5 的断言）
  - AC-4：其出站访问受 INV-11 的域名白名单约束，未声明的 host 被拒绝并产生事件
- **验收方式**：`bun test mcp/builtin-servers.spec.ts` + `scripts/check-no-selfimpl-automation.ts`（AC-1，CI 阻断）
- **层级**：Invariant（INV-03、INV-11）· **优先级**：P2

**M2 DoD**：一次 100+ 轮的长会话全程不中断；轨迹可完整审计；**L1 回放集 ≥ 10 条且 CI 中全绿**；导出的单文件 HTML 在他人机器上离线打开后能看懂发生了什么。

---

# M3 · 三端 `PROVISIONAL`

**要回答的问题**：终端里起的任务，能否在浏览器里接着看。

**不做什么**：不做桌面端（挪到 M5）· 不做多用户 · 不做云端存储 · 不做移动端适配 · **不做无障碍适配**（v1 范围外，理由：目标用户为 CLI 开发者，Web 端定位为轨迹查看的补充视图；v1 后重新评估）。

**新增**：`PRD-M2-001`（MCP client）与 `PRD-M2-009`（内置 MCP server 清单）v1.3 从 M2 移入本里程碑，
AC 原文不变（`docs/adr/011`）。进入 M3 的批准门上必须重新过一遍 SDK 版本这条。

**预算**：20 天（15 + 移入的 5 天）。

### PRD-M3-001 · Domi Protocol 正式化
- **AC**
  - AC-1：协议以 zod 单一来源定义，可生成 JSON Schema（断言生成产物与手写示例一致）
  - AC-2：握手协商版本；不兼容时返回结构化错误 `PROTOCOL_VERSION_MISMATCH` 含双方版本号，**不进入任何降级兼容路径**（断言不兼容时无后续业务请求）
  - AC-3：协议公开类型有 `.api.md` 快照，任何变更导致快照 diff 非空则 CI 失败（INV-01）
  - AC-4：协议文档由 schema 生成，`scripts/gen-protocol-docs.ts` 输出与仓库中文档一致（CI 断言无 diff）
- **验收方式**：`bun test protocol/*.spec.ts` + API 快照测试
- **层级**：Invariant（INV-01）· **优先级**：P0

### PRD-M3-002 · daemon 独立进程
- **AC**
  - AC-1：`domid` 独立运行；TUI 与 Web 作为客户端连接
  - AC-2：客户端断开不影响执行中的任务；重连后从断点 seq 续订事件流，无重复无遗漏
  - AC-3：daemon `kill -9` 重启后，未完成任务状态可从事件流恢复到最后一个一致点
  - AC-4：`domi` 命令在 daemon 未运行时自动拉起，并发调用只拉起一个实例（文件锁断言）
  - AC-5：**迁移审计**——M0–M2 期间落在 TUI 包内的业务逻辑已全部迁出；断言 `apps/tui` 不依赖 `packages/kernel|store|memory`，仅依赖 `packages/client-core`（INV-04，v1.0 缺失此项）
- **验收方式**：`bun test daemon/*.spec.ts`（含 kill -9 恢复与并发拉起）；AC-5 由 dependency-cruiser 规则 `tui-no-business-logic` 守
- **层级**：Invariant（INV-04）· **优先级**：P0

### PRD-M3-003 · Web 端
- **AC**
  - AC-1：功能对等——**按 `docs/parity-checklist.md` 逐项断言**，清单含：发送消息、流式接收、工具确认、轨迹树展开、会话列表/恢复/分支/删除、状态栏六项指标、模型切换。每项在 TUI 与 Web 各有一个 e2e 用例
  - AC-2：业务逻辑全在 `client-core`；断言 `packages/client-core` 依赖闭包中不含任何 `node:*` 模块（浏览器可运行）
  - AC-3：多客户端连接同一会话时事件推送到全部客户端，两端渲染的事件 seq 序列相同
  - AC-4：本地环境事件推送延迟 P95 < 200ms
- **验收方式**：`bun test client-core/*.spec.ts` + Playwright e2e（按 parity checklist 逐项）；AC-2 由依赖边界规则守（INV-04）
- **层级**：Invariant（INV-04）· **优先级**：P0

### PRD-M3-004 · 并发写仲裁
- **用户价值**：两个客户端同时对一个会话操作时，不会把事件流写坏。
- **AC**
  - AC-1：daemon 是事件流的**唯一写入者**；客户端只能提交意图，不能直接写库（断言 client-core 无 store 依赖）
  - AC-2：同一会话同时有两个客户端提交输入时，串行化处理，seq 无重复无空洞
  - AC-3：第二个客户端在首个请求处理中提交时，收到 `session.busy` 结构化响应而非静默丢弃
  - AC-4：并发压测（10 客户端 × 100 次提交）后事件流满足 PRD-M0-001 的全部 AC
- **验收方式**：`bun test daemon/concurrency.spec.ts` + `bench/concurrent-write.ts`
- **层级**：Invariant（INV-01）· **优先级**：P0

### PRD-M3-005 · 跨会话操作
- **AC**：AC-1 在会话 B 中引用会话 A 的某段轨迹或产物，被引用内容进入 B 的上下文；AC-2 引用为链接（存 `{sessionId, seqRange}`）而非拷贝，可溯源；AC-3 产生事件，轨迹可见。
- **验收方式**：`bun test kernel/cross-session.spec.ts`
- **层级**：Negotiable · **优先级**：P1

### PRD-M3-006 · 远程连接
- **AC**：AC-1 `domi --connect ws://host:port` 可用；AC-2 **默认只监听 127.0.0.1**（断言默认配置），监听非本地地址必须显式配置且强制 token 认证；AC-3 无认证连接被拒绝并产生事件。
- **验收方式**：`bun test daemon/auth.spec.ts`
- **层级**：Invariant（INV-11）· **优先级**：P2

**M3 DoD**：在 TUI 里发起一个长任务，关掉终端，在浏览器里看到它继续执行并完成。

---

# M4 · 有灵魂 `COMMITTED`

> ~~轮廓级。进入 M4 前必须重写本章为 `COMMITTED` 并重过 PM 门禁。~~
> ~~此时 domi 已积累两个月真实使用数据，届时才知道该沉淀什么——现在写死是自欺。~~
> **v1.5（2026-09-15）**：用户拍板按轮廓进入，再批准门材料见 `docs/prd/M4.md`。
> 上面那条前提不成立：抽取类别与 Soul 分区是先验，做成可替换；质量判据（M4-001 AC-4、DoD）留作验证待办。

**要回答的问题**：domi 能否积累出值得分享的人格。

**不做什么**：不做编排/多 agent · 不做桌面端 · 不做插件系统。

**预算**：20 天。

### PRD-M4-001 · L3 语义记忆抽取
- **AC**
  - AC-1：从会话中抽取事实 / 偏好 / 实体三类条目，经 zod schema 校验
  - AC-2：每条携带 `sourceRefs: {sessionId, seq}[]`，可溯源到支撑它的原始事件
  - AC-3：可按关键词与语义检索；用户可删除单条，删除后不再被检索到
  - AC-4：抽取质量以 **precision（抽取条目中人工判定正确的比例）** 度量，在 20 个标注会话上 nightly 跑分并写入 `bench/l3-precision.jsonl`；低于 0.7 时告警（§0.4）
- **验收方式**：`bun test memory/semantic.spec.ts`（AC-1/2/3，确定性）；AC-4 走 nightly + 标注集 `fixtures/l3-labeled/`
- **层级**：Negotiable · **优先级**：P0

### PRD-M4-002 · Soul 生成与存储
- **AC**
  - AC-1：Soul 存储为 Markdown，含固定六个二级标题分区：`工作习惯` / `技术偏好` / `沟通风格` / `领域知识` / `对用户的模型` / `失败教训`（断言标题存在且顺序固定）
  - AC-2：`~/.domi/soul/` 下无二进制、无向量文件；断言目录中所有文件的 MIME 为 `text/*`（INV-09）
  - AC-3：**单次 Soul 更新引起的 `git diff` 变更行数 ≤ 20**，且不出现整段重写（断言 diff 中 `-` 行数与 `+` 行数之差在 ±10 内）
  - AC-4：每条 Soul 陈述携带 `<!-- src: L3:<id>,<id> -->` 注释，可追溯到支撑它的 L3 条目
- **验收方式**：`bun test memory/soul.spec.ts`（AC-1/2/4）+ `scripts/check-soul-diff.ts`（AC-3：在真实 git 仓库中生成两次 Soul 并比对 diff）
- **层级**：Invariant（INV-09）· **优先级**：P0

### PRD-M4-003 · Soul 审阅与否决
- **AC**
  - AC-1：每次 Soul 更新产生 `memory.write{layer:'L4'}` 事件，含变更前后的 diff
  - AC-2：`domi soul review` 列出自上次审阅以来的变更，逐条可接受/否决
  - AC-3：被否决的条目写入 `~/.domi/soul/.rejected`，后续抽取命中相同语义时不再提议（断言：否决后重跑同一会话的抽取，该条不再出现）
  - AC-4：Soul 文件可直接手工编辑；手工编辑不被下次自动更新覆盖（断言：手改后跑一次更新，手改内容仍在）
- **验收方式**：`bun test memory/soul-review.spec.ts`
- **层级**：Invariant（INV-09）· **优先级**：P0

### PRD-M4-004 · Soul 导出导入 —— 社区传播的核心功能
- **AC**
  - AC-1：`domi soul export` 产出单个自包含 Markdown 文件，不含任何本机路径、凭据或个人可识别信息（断言：对导出文件跑 `scripts/scan-secrets.ts` 与路径扫描，命中数为 0）
  - AC-2：`domi soul import <file>` 可导入他人 Soul
  - AC-3：**导入必须展示逐区 diff 并要求逐区确认**；断言非交互模式下导入直接失败而非静默合并
  - AC-4：导入内容视为不可信（INV-06）——导入的 Soul 文本在注入用例集下不能导致权限提升（复用 PRD-M2-006 的用例，断言权限层拦截）
- **验收方式**：`bun test memory/soul-portability.spec.ts` + `bun test security/soul-injection.spec.ts`
- **层级**：Invariant（INV-06、INV-09）· **优先级**：P0

### PRD-M4-005 · Skill 系统
- **AC**
  - AC-1：Skill 类型上**不存在 `execute` 成员**（编译期断言：为 Skill 编写调用 execute 的代码应无法通过 typecheck，用 `expect-type` 测试）（INV-05）
  - AC-2：渐进式披露——未激活的 Skill 在上下文中只占用其 `description` 字段；断言未激活时该 Skill 正文不出现在 `buildContext` 输出中
  - AC-3：Skill 从 `~/.domi/skills/` 加载，新增文件后无需重启即生效（断言文件监听触发重载）
  - AC-4：提供 3 个官方 Skill 与一份编写模板；每个官方 Skill 有对应的激活/未激活 fixture 测试
- **验收方式**：`bun test capability/skill.spec.ts` + `bun test capability/skill-types.test-d.ts`（类型层断言）
- **层级**：Invariant（INV-05）· **优先级**：P1（M4 DoD 不依赖 Skill）

**M4 DoD**：连续使用两周后导出的 Soul，交给 3 位不认识该用户的开发者阅读，**至少 2 位能正确回答一组关于"这个用户偏好什么技术栈、怎么沟通"的选择题**（题目与标准答案由用户本人预先给出）。

---

# M5 · 会干活 `COMMITTED`

> ~~轮廓级。进入前必须重写为 `COMMITTED`。~~
> **v1.6（2026-09-15）**：用户拍板按轮廓进入，再批准门材料见 `docs/prd/M5.md`。

**要回答的问题**：能否跑一个 30 分钟不断线的长任务。

**不做什么**：**不做协商式多 agent**（辩论/投票）· 不做可视化流程编辑器 · 不做分布式执行。

**预算**：15 天。

### PRD-M5-001 · Sub-agent（上下文隔离的子任务）
- **AC**
  - AC-1：父 agent 可派生子 agent，产生 `task.spawn` 事件含 `childSessionId` 与 `goal`
  - AC-2：子 agent 有独立上下文窗口；断言父上下文中只出现子 agent 的最终结论，不出现其中间事件
  - AC-3：**子 agent 权限是父权限的子集，不可扩大**；断言子 agent 请求父未持有的能力时被拒绝并产生事件
  - AC-4：子 agent 轨迹作为可展开节点嵌套在父轨迹中（渲染快照断言嵌套结构）
- **验收方式**：`bun test orchestrator/subagent.spec.ts`（AC-1/2/3）+ `bun test trace/nested.spec.ts`（AC-4）
- **层级**：Invariant（INV-03）· **优先级**：P0

### PRD-M5-002 · DAG 编排
- **AC**
  - AC-1：节点类型为 `agent-step` / `tool` / `sub-agent` / `human-approval` 四种，以 YAML 配置定义（v1.4 回写：原为 TOML，与主配置同一种格式）
  - AC-2：配置经 zod 校验；环依赖在加载期报错（断言含环的配置无法加载）
  - AC-3：执行状态持久化在事件流；任意时刻可查询各节点状态
  - AC-4：失败节点可单独重试，不重跑已完成节点
- **验收方式**：`bun test orchestrator/dag.spec.ts`
- **层级**：Negotiable · **优先级**：P0

### PRD-M5-003 · 断点恢复
- **AC**
  - AC-1：daemon 重启后未完成的 DAG 从最后一个完成节点继续
  - AC-2：已完成节点不重复执行（断言副作用计数不变）
  - AC-3：恢复动作产生 `task.resume` 事件，含恢复点
  - AC-4：**在 DAG 执行的 10 个随机时点各 kill -9 一次，全部能恢复并最终完成**（fuzz 测试）
- **验收方式**：`bun test orchestrator/resume.spec.ts` + `bench/kill-fuzz.ts`
- **层级**：Negotiable · **优先级**：P0

### PRD-M5-004 · 长任务通知
- **用户价值**：30 分钟的无人值守任务，用户不该盯着屏幕等。
- **AC**
  - AC-1：任务完成 / 失败 / 需要人工确认三种情形触发通知
  - AC-2：支持系统通知（macOS/Linux）与 webhook 两种渠道，可配置
  - AC-3：**通知内容不含凭据与文件内容**（复用 `scripts/scan-secrets.ts` 扫描通知 payload）
  - AC-4：通知渠道失败不影响任务本身（断言：webhook 返回 500 时任务仍正常完成）
- **验收方式**：`bun test notify/*.spec.ts`
- **层级**：Invariant（INV-11）· **优先级**：P1

### PRD-M5-005 · 桌面端
- **AC**
  - AC-1：Tauri v2 打包 Web 产物，macOS / Linux / Windows 三平台 CI 构建成功并通过冒烟
  - AC-2：自动更新——模拟发布新版本后，客户端能检测、下载并重启到新版本（集成测试）
  - AC-3：**除打包与更新外无独立业务代码**；断言 `apps/desktop` 的 TS/Rust 代码总行数 < 500 且不依赖 `packages/kernel|store`（INV-04）
- **验收方式**：CI 三平台构建 + `scripts/smoke-desktop.sh` + `bun test desktop/updater.spec.ts` + 代码行数与依赖断言
- **层级**：Invariant（INV-04）· **优先级**：P1

### PRD-M5-007 · 聊天端桥接（Telegram）

> v1.2 新增。`PRD-VISION.md` §4 的**唯一移动端例外**，范围写死：只读 + 审批，不做发起与编辑。
> 选 Telegram 的理由：长轮询不需要公网 TLS 入口、不过审核、推送免费——是"轻"的那一个（第一类：引用 grammY）。

- **用户价值**：长任务跑着的时候人不在电脑前，也能看到它走到哪、并在它卡在权限请求时放行。
- **AC**
  - AC-1：桥接是**独立进程**，通过 Domi Protocol 连 daemon，**不含业务逻辑**（守 INV-02：断言 `apps/bridge-telegram` 不依赖 `packages/kernel|store`）
  - AC-2：长任务的节点开始/结束/失败推送到绑定的 chat；消息含会话 id 与步骤 seq
  - AC-3：权限请求推送为带按钮的消息，点击产生与 TUI **同构的权限事件**（`source:'user'`，附 `channel:'telegram'`），断言事件结构与 TUI 路径深比较一致（守 INV-03）
  - AC-4：**仅白名单 chat id 可操作**；未绑定 chat 的任何消息被丢弃并记事件。绑定用一次性配对码，**配对码 5 分钟过期**
  - AC-5：**不上传文件内容与代码正文**，只发送步骤标题、状态、耗时与 diff 统计行数（守 INV-11）；断言出站 payload 不含 `fs.read`/`fs.write` 的内容字段
  - AC-6：Telegram 不可达时桥接静默退避重试，**不阻塞主循环**（断言 daemon 在桥接进程被 kill 后任务继续完成）
- **验收方式**：`bun test bridge/telegram.spec.ts`（对 Bot API 打桩）+ `scripts/check-bridge-payload.ts`（AC-5，CI 阻断）+ 依赖边界规则（AC-1）
- **层级**：Invariant（INV-02、INV-03、INV-11）· **优先级**：P2

**M5 DoD**：一个 30 分钟、含 5+ 节点的真实任务跑通；中途 kill daemon 后能恢复并完成；完成时收到通知。

---

# M6 · 生态 `COMMITTED`

> ~~轮廓级。进入前必须重写为 `COMMITTED`。~~
> **v1.7（2026-09-15）**：用户拍板按轮廓进入，再批准门材料见 `docs/prd/M6.md`，SPEC 见 `docs/spec/M6.md`。

**要回答的问题**：别人能否给 domi 写插件。

**预算**：20 天。

### PRD-M6-001 · 插件 API 正式化
- **AC**
  - AC-1：插件可提供 tool / skill / MCP 配置 / UI 扩展四类扩展点，每类有至少一个通过测试的实现
  - AC-2：API 有语义化版本与弃用策略；弃用的 API 在调用时产生 warn 日志并在文档中标注移除版本
  - AC-3：**至少 2 个原内置能力已改写为插件形态，且全部原有测试不修改即通过**（吃自己的狗粮）
  - AC-4：插件 API 的公开类型有 `.api.md` 快照，变更需显式 review
- **验收方式**：`bun test plugin/api.spec.ts` + AC-3 由"改写后跑原测试套件"证明 + API 快照测试
- **设计前置约束**（**不是 AC，是架构环节的 checklist 项**）：API 必须从 ≥5 个已实现的内置能力中归纳而来，不得凭空设计。此项在 SPEC 评审时人工核对，记入 `docs/spec/M6.md`。
- **层级**：Negotiable · **优先级**：P0

### PRD-M6-002 · 插件安装与权限
- **AC**
  - AC-1：manifest 必须显式声明所需权限，缺少声明的插件安装失败
  - AC-2：安装时全量展示所需权限并要求确认；非交互模式下默认拒绝安装
  - AC-3：**未声明的权限运行时一律拒绝**；断言插件请求 manifest 外的能力时被拦截并产生事件（INV-03）
  - AC-4：插件权限不可在运行时提升（断言：插件修改自身 manifest 后重启前不生效）
- **验收方式**：`bun test plugin/permission.spec.ts`
- **层级**：Invariant（INV-03）· **优先级**：P0

### PRD-M6-003 · 插件隔离
- **AC**
  - AC-1：插件在受限环境执行，无法访问未声明的文件路径与网络 host（各 5 条逃逸尝试用例全部被拦截）
  - AC-2：插件抛出未捕获异常时 daemon 不退出，产生 `plugin.error` 事件
  - AC-3：插件执行超过配置超时被强制终止，断言进程/worker 已回收
  - AC-4：插件的输出被视为不可信数据（INV-06），复用 PRD-M2-006 注入用例集断言权限层拦截
- **验收方式**：`bun test plugin/sandbox.spec.ts`
- **层级**：Invariant（INV-03、INV-06）· **优先级**：P0

### PRD-M6-004 · 官方示例插件与文档
- **AC**
  - AC-1：3 个官方插件，分别覆盖 tool 型、skill 型、MCP 包装型
  - AC-2：`domi plugin scaffold <type>` 生成可运行骨架；**断言：脚手架产物在无人工修改的情况下 `bun test` 与 `domi plugin install` 均成功**（这是 v1.0 中"真人验收"的可脚本化替代）
  - AC-3：文档站含快速开始、架构说明、插件开发、Skill 编写四篇；每篇的代码示例被 `scripts/test-docs-snippets.ts` 提取并实际执行通过
  - AC-4：CONTRIBUTING.md 存在；仓库中开放 ≥5 个带 `good first issue` 标签的 issue
- **验收方式**：`bun test plugin/scaffold.spec.ts` + `scripts/test-docs-snippets.ts`（CI）+ `scripts/check-repo-meta.ts`（AC-4）
- **层级**：Negotiable · **优先级**：P0

### PRD-M6-005 · L2 端到端评估集

> v1.2 新增。L1（PRD-M2-008）证明"没改坏"，L2 证明"真能干活"。两层的分工是硬边界：**L1 进 CI，L2 只进 nightly/手动**（INV-08）。

- **用户价值**：换模型、改 loop 范式时有一个能说话的数字，而不是"感觉变好了"。
- **AC**
  - AC-1：题集 20–30 题，**每题的通过判据是一段带断言的脚本**（跑测试、检查文件内容、检查退出码），不含人工判分
  - AC-2：每题在**一次性容器/临时工作区**中执行，题与题之间无状态残留（断言：同一题连跑两次结果一致）
  - AC-3：单次全量运行产出报告：通过率、每题 token 与**金额**、耗时、失败题的轨迹 fixture 路径
  - AC-4：**L2 不进 CI 门禁**（守 INV-08）；断言 CI 配置中不存在 L2 入口
  - AC-5：因模型不确定性，**同一模型同一题集连跑 3 次，报告给出通过率区间而非单一数字**；区间宽度 > 20% 时报告标注"该题集判别力不足"
  - AC-6：失败题自动落一份 fixture，**可直接提升为 L1 回放用例**（与 PRD-M2-008 AC-1 共用格式）
- **验收方式**：`bun test eval/l2-harness.spec.ts`（对模型打桩验证 harness 本身，AC-1/2/6）+ `scripts/check-ci-no-l2.ts`（AC-4，CI 阻断）+ nightly 运行记录（AC-3/5，里程碑退出评审时人工核对，见 §0.4）
- **层级**：Invariant（INV-08、INV-13）· **优先级**：P1

**M6 DoD**：存在至少一个非官方插件（外部贡献者提交并可安装运行）；**L2 题集跑过至少一轮完整三次重复并产出报告**。

---

# M7 · 会写代码 `COMMITTED`

> **v1.8（2026-09-16）新增**。M6 之后的方向由用户提出：让 domi 能接手真实的编程任务——开发 domi 自身是其中一个场景，不是唯一场景。
> ~~本章是轮廓，进入前要过再批准门。~~
> **v1.9（2026-09-16）**：用户拍板全做 001–010，再批准门材料见 `docs/prd/M7.md`，SPEC 见 `docs/spec/M7.md`。

**要回答的问题**：domi 能否在一个陌生仓库里，从一条 issue 做到一个带测试、验证过、可审阅的提交。

**不做什么**：不做代码补全与 IDE 插件 · 不做 LSP server · **不替用户 push 或开 PR**（远程操作一律由用户做）·
不做多仓库联动改动 · 不做语言无关的「完整代码理解」（v1 只对 TS/JS 做结构化理解，其它语言退回文本搜索）。

**预算**：22 天。

### PRD-M7-001 · 编码工具集
- **用户价值**：改一行不用重写整个文件；找代码不用让模型拼 shell 命令；长命令的输出不会把上下文撑爆。
- **AC**
  - AC-1：`fs.edit` 做精确替换：`old` 在文件中必须恰好出现一次，出现 0 次或多次时拒绝，并返回各候选位置的行号；成功时只写入变更，产生与 `fs.write` 相同的步级快照（PRD-M1-011）
  - AC-2：`fs.edit` / `fs.write` 覆盖已有文件前核对该文件自本会话最近一次 `fs.read` 以来未被外部改动（内容哈希）；被改过则拒绝并提示先重读（断言：读 → 外部改 → 编辑 = 拒绝，文件内容不变）
  - AC-3：`fs.glob` 与 `fs.grep` 默认遵守 `.gitignore`，结果条数有上限，超限时结果里标注「已截断」与总数；路径不越出会话允许的范围（复用 `fs.read` 的权限与路径判定）
  - AC-4：`shell.exec` 支持后台运行：返回 job id，可查询增量输出、可终止（断言进程组已回收）；前台与后台的输出超过上限时截断，全文落到 `~/.domi/` 下的文件并在结果中给出路径
  - ~~AC-5：新工具不新增能力类别：`fs.edit` 归 `fs.write`、`fs.glob` / `fs.grep` 归 `fs.read`、后台 job 的查询与终止归 `shell.exec`；断言现有权限规则不改一行即对新工具生效~~
    （v1.9.1 回写，SPEC 环节触发：模板里 `shell.exec` 是 ask，查询归它会让每次轮询后台输出都弹一次确认）
  - AC-6：新工具不新增能力类别：`fs.edit` 归 `fs.write`；`fs.glob` / `fs.grep` 与后台 job 的**输出查询**归 `fs.read`（只读已经产生的输出，不执行任何东西）；
    后台 job 的**终止**归 `shell.exec`；断言现有权限规则不改一行即对新工具生效
- **验收方式**：`bun test capability/coding-tools.spec.ts`
- **归类**（PRD-VISION §6）：搜索优先用系统里的 ripgrep（引用真库），没有时退回内置实现；精确替换与过期写保护抄算法（Claude Code / Codex 的编辑工具）
- **层级**：Invariant（INV-03、INV-05）· **优先级**：P0

### PRD-M7-002 · 项目规矩文件、项目目录与工作区信任
- **用户价值**：每个仓库自己的约定（怎么跑测试、提交信息怎么写、哪些文件不许碰）写一次，domi 每次都照做；
  只属于这个仓库的 Skill 跟着仓库走。
- **AC**
  - ~~AC-1：会话工作目录所在仓库根（向上找到 `.git`）到工作目录之间的 `AGENTS.md` 与 `DOMI.md` 按「根 → 工作目录」顺序读入一个独立提示词层，每段标注来源路径；`domi prompt dump` 能看到~~
    （v1.9 回写：用户拍板规矩文件名为 `AGENT.md`，不另设 `DOMI.md`；domi 专属的东西放项目目录，见 AC-5）
  - AC-6：会话工作目录所在仓库根（向上找到 `.git`）到工作目录之间的 `AGENT.md` 按「根 → 工作目录」顺序读入一个独立提示词层，每段标注来源路径；
    同一目录下没有 `AGENT.md` 而有 `AGENTS.md` 时读后者（多家工具通用的拼写），两者都有只读 `AGENT.md`；`domi prompt dump` 能看到
  - AC-2：规矩文件总长有上限，超出部分截断并在层内标注；文件改动后下一轮生效，不需要重启会话
  - AC-3：**未被信任的工作区不加载规矩文件与项目目录**。第一次在某个仓库根打开会话时询问是否信任，决定落 `workspace.trust` 事件；非交互模式默认不信任（断言：未信任仓库的 `AGENT.md` 内容与项目级 Skill 都不出现在发给模型的请求里）
  - AC-4：规矩文件与项目目录只能影响提示词与 Skill，**不能声明钩子、权限规则、MCP server、插件或要执行的命令**；断言其中写的这类配置不改变任何权限决策、不启动任何进程
  - AC-5：项目目录 `<仓库根>/.domi/`：`.domi/skills/<名字>/SKILL.md` 是项目级 Skill，与用户级同名时项目级覆盖，列表里标注来源；
    domi **不会自己悄悄创建**这个目录——只有用户执行 `domi init --project`，或会话里经 `fs.write` 权限确认后才生成（断言：打开会话、跑完一轮后仓库里没有多出 `.domi/`）
- **验收方式**：`bun test runtime/project-rules.spec.ts`
- **层级**：Invariant（INV-03、INV-06）· **优先级**：P0

### PRD-M7-003 · 钩子
- **用户价值**：「改完自动格式化」「提交前扫密钥」「提交信息不许带某些行」这类规矩由机器执行，不靠模型记得。
- **AC**
  - AC-1：`config.yaml` 的 `hooks` 可在工具调用前（pre）、工具调用后（post）、一轮结束时（stop）运行命令，按能力 id 通配匹配
  - AC-2：pre 钩子退出码非零 → 该工具调用不执行，钩子的输出作为拒绝理由回给模型；断言被拦截的调用没有副作用
  - AC-3：post 钩子的输出附在工具结果后，按不可信数据带边界（INV-06）
  - AC-4：每次钩子执行落 `hook.run` 事件（钩子名、耗时、退出码、是否拦截）；超时的钩子被强杀，按拦截处理（fail-closed）；新事件类型带 legacy fixture（INV-01）
  - AC-5：**钩子只能来自用户配置**；仓库内的任何文件都不能注册钩子（与 PRD-M7-002 AC-4 同一条断言的另一面）
  - AC-6：`domi init` 模板附两个示例钩子：提交信息规则（拦截指定的行，如协作者署名）与暂存区密钥扫描；各有一条先造违规、证明会拦截的测试
- **验收方式**：`bun test runtime/hooks.spec.ts`
- **层级**：Invariant（INV-01、INV-03、INV-06）· **优先级**：P0

### PRD-M7-004 · 完成前必须验证
- **用户价值**：「改完了」必须意味着「测过了」。
- **AC**
  - AC-1：项目的验证命令来自规矩文件里的约定或 `config.yaml`，执行时照常走 `shell.exec` 权限（规矩文件只能**建议**命令，不能免确认执行）
  - AC-2：一轮里有文件改动、之后没有一次成功的验证运行，而模型要结束这一轮时，运行时追加一条提示让它去验证，落 `verify.required` 事件；同一轮最多追加 N 次（可配置），到上限后如实结束并在结果里标「未验证」
  - AC-3：状态栏与轨迹显示「已改未验 / 已验证 / 验证失败」三态，数据只来自事件投影（INV-13，不新增埋点）
  - AC-4：验证失败的输出按 PRD-M7-001 AC-4 截断后回灌，保留失败的测试名与首个错误位置
- **验收方式**：`bun test runtime/verify-gate.spec.ts`（模型打桩）
- **层级**：Negotiable · **优先级**：P0

### PRD-M7-005 · 计划模式
- **用户价值**：大改动先看方案再动手，方案不对只花了读代码的钱。
- **AC**
  - AC-1：计划模式下所有写能力（`fs.write` 类、`shell.exec`、`task.spawn`、MCP 与插件工具）一律拒绝，拒绝决策的来源标为 mode 并落 `permission` 事件
  - AC-2：模型提交计划落 `plan.proposed` 事件；用户批准 / 驳回（可附意见）落 `plan.decided` 事件；批准后同一会话切回执行模式，计划原文作为上下文保留
  - AC-3：批准时可选「转成长任务」：计划的步骤生成一份 PRD-M5-002 格式的 DAG 配置，经同一套校验
- **验收方式**：`bun test runtime/plan-mode.spec.ts`
- **归类**：plan-execute 抄算法（PRD-VISION §6 已列）
- **层级**：Invariant（INV-03）· **优先级**：P1

### PRD-M7-006 · 工作区隔离与改动审阅
- **用户价值**：domi 干活时不碰我正在改的工作区；它改了什么，按文件看、按文件收。
- **AC**
  - AC-1：会话与长任务可以隔离模式启动：在 `~/.domi/worktrees/` 下为该仓库建 git worktree 与 `domi/<会话>` 分支，会话工作目录指向它；落 `worktree.create` 事件
  - AC-2：Web 与 TUI 能列出本会话相对起点的改动（按文件的 diff），可逐文件保留或丢弃；丢弃是可撤销的（经步级快照）
  - AC-3：把改动带回原仓库（合并 / 压扁 / 只留分支）是 human-approval 动作；断言未经批准原工作区一个字节不变
  - AC-4：删除会话时，worktree 里有未提交改动则拒绝清理并提示；断言清理后分支仍在（除非用户显式删除）
  - AC-5：非 git 目录不能隔离时如实拒绝，并回退为步级快照（PRD-M1-011）保护
- **验收方式**：`bun test runtime/worktree.spec.ts` + `apps/web` 渲染快照（AC-2）
- **层级**：Negotiable（AC-3 为 Invariant：INV-03）· **优先级**：P1

### PRD-M7-007 · 代码结构理解
- **用户价值**：陌生仓库先看到骨架，不用一个个文件翻。
- **AC**
  - AC-1：`code.outline` 对 TS/JS 文件或目录给出导出符号与签名的提纲，总长有上限并标注截断；读取归 `fs.read` 权限
  - AC-2：`code.diagnostics` 对指定文件给出类型诊断（文件、行、消息），增量复用编译状态；第二次调用明显快于第一次（基准断言）
  - AC-3：非 TS/JS 文件返回「不支持」而不是空结果
- **验收方式**：`bun test capability/code-intel.spec.ts`
- **归类**：TypeScript 编译器 API（引用真库）
- **层级**：Negotiable · **优先级**：P1

### PRD-M7-008 · 从 git 历史出评估题
- **用户价值**：评估题来自真实仓库的真实改动，而且会随仓库增长；「domi 写代码的能力有没有变好」有持续的数字。
- **AC**
  - AC-1：`domi eval mine <仓库> [--since] [--limit]` 挑出同时改了源码与测试的提交，生成 PRD-M6-005 格式的题：工作区 = 父提交，判据 = 该提交引入或修改的测试，参考答案 = 该提交的 diff
  - AC-2：只有「父提交上判据失败、该提交上判据通过」的题才入库；其余丢弃并在生成报告里写明原因
  - AC-3：题面只含提交说明（去掉协作者署名等元数据行）与失败测试名，**不含 diff 的任何片段**（断言）
  - AC-4：生成与运行都不进 CI（INV-08），运行复用 L2 harness
- **验收方式**：`bun test eval/mine.spec.ts`（用 fixture 仓库）+ `scripts/check-ci-no-l2.ts`
- **层级**：Invariant（INV-08、INV-13）· **优先级**：P1

### PRD-M7-009 · 任务预算
- **用户价值**：一个任务最多花多少钱、调多少次工具，我事先说了算。
- **AC**
  - AC-1：会话与长任务可设 token、金额、工具调用次数上限；到 80% 通知，到 100% 暂停并转为 human-approval（继续 / 停止 / 提高上限）
  - AC-2：用量只从现有指标投影计算（INV-13）；断言暂停发生在越限后的第一个工具调用之前
- **验收方式**：`bun test runtime/budget.spec.ts`
- **层级**：Negotiable · **优先级**：P2

### PRD-M7-010 · 审阅子 agent
- **用户价值**：提交前有一双「没看过实现过程」的眼睛，按需求逐条找漏洞。
- **AC**
  - AC-1：`domi review` 派一个只读子 agent（权限只有 `fs.read` 类，PRD-M5-001 AC-3 的子集规则），输入是改动 diff 与用户指定的需求文档，**不含实现会话的历史**（断言子会话上下文里没有父会话事件）
  - AC-2：输出为结构化发现（文件、行、问题、依据），落事件并在 Web 中按文件展示
- **验收方式**：`bun test orchestrator/review.spec.ts`
- **层级**：Negotiable · **优先级**：P2

**M7 DoD**：在**一个非 domi 的真实仓库**与 **domi 仓库**里各完成一个真实编码任务——从一条 issue 到一个带测试的本地提交；
全程在隔离 worktree 中进行、结束前有成功的验证记录、用户只做权限审批与最终审阅。另用 PRD-M7-008 从 domi 历史生成 ≥ 20 道题并跑完一轮。

---

# M8 · 工作台（Web + TUI） `COMMITTED`

> **v1.10（2026-09-17）新增**。触发：用户给出已确认的高保真原型 `docs/ui-redesign/index.html`，要求 Web 端按原型重构、后端缺的补齐。
> 再批准门材料与用户拍板见 `docs/prd/M8.md`。
> **v1.11（2026-09-17）**：用户拍板进入（「同步开发吧」），TUI 原型 `docs/ui-redesign/tui.html` 并入本章（M8-014…017）；M8-001 / 002 / 004 各有一条 AC 按拍板改写。

**要回答的问题**：Web 端能否成为 domi 的日常主界面——按项目组织任务、自由会话与任务分开、定时执行，不用回终端改配置；TUI 能否以同一套概念与视觉跟上。

**不做什么**：手机端与窄屏布局 · 通讯工具真实接入（只留入口）· 界面多语言 ·
从 Web 改权限规则 / 钩子 / MCP server / 安装插件 · 真浏览器 e2e（沿用 ADR-013）· 多用户与云同步。

**预算**：36.5 天（v1.10 的 28.5 天 + TUI 8 天）。

### PRD-M8-001 · 设计 token 与主题
- **用户价值**：界面长得和确认过的原型一样；深浅色、主题色按自己习惯选，下次打开还在。
- **AC**
  - AC-1：深浅两套 CSS 变量与 `docs/ui-redesign/HANDOFF.md` §1 色板逐项一致（断言解析 `globals.css` 与 HANDOFF 表格比对）
  - AC-2：主题三选一（跟随系统 / 深色 / 浅色），写在 `<html data-theme>`；跟随系统时响应 `prefers-color-scheme` 变化；选择在本浏览器持久化
  - ~~AC-3：5 个 accent 色板，选中后 `--accent` 及派生色（hover、选中背景、强调边框、实心按钮底色）一起变，深浅主题各有一套取值~~
  - AC-4：实心按钮文字与底色对比度 ≥ 4.5:1，覆盖 5 个色板 × 2 个主题（断言计算）
  - AC-5：5 个 accent 色板，选中后 `--accent` 及派生色（hover、选中背景、强调边框、实心按钮底色）一起变，深浅主题各有一套取值；**所选色板存在 daemon 配置 `ui.accent`**，Web 与 TUI 共用；深浅模式仍按设备保存
  - AC-6：色板与 token 的唯一来源在 `client-core`（`tokens.ts`），Web 的 CSS 变量与 TUI 的配色都从它来（断言两边取值一致）
- **验收方式**：`bun test apps/web/test/theme.spec.ts` + `bun test client-core/tokens.spec.ts`
- **层级**：Negotiable · **优先级**：P0

### PRD-M8-002 · 布局骨架与导航
- **用户价值**：一眼找到项目、最近的会话与任务、设置；前进后退和刷新不丢位置。
- **AC**
  - AC-1：260px 固定侧栏，自上而下：品牌 → 「新对话」主按钮 → 「新任务」「定时任务」次按钮 → 项目栏 → 会话栏 → 设置
  - AC-2：视图由地址的 hash 决定（会话、项目详情、全部项目、全部会话、任务、设置及其 tab），刷新与浏览器前进后退回到同一视图
  - AC-3：项目栏、会话栏点标题折叠，chevron 旋转，折叠状态持久化；标题 hover 出操作（项目栏：添加项目、新建任务、全部项目；会话栏：全部会话）
  - ~~AC-4：项目项 hover 出笔图标，点击在该项目下新建任务；点项目名进项目详情；当前项目高亮~~
  - AC-5：入口映射：新对话 → 空白会话；新任务 → 新建任务（选项目）；定时任务 → 新建任务并展开计划时间
  - AC-6：项目是一棵树：点项目行展开 / 收起（状态持久化），子项是该项目最近 5 个任务（左侧状态点 + 标题，缩进并带竖向引导线），超出时末尾「查看全部 (N)」进项目详情；项目行 hover 出 ↗（进项目详情）与笔图标（在该项目下新建任务）；当前任务所在项目默认展开并高亮
- **验收方式**：`bun test apps/web/test/layout.spec.tsx`
- **层级**：Negotiable · **优先级**：P0

### PRD-M8-003 · 项目
- **用户价值**：任务按仓库归好类；给项目起个自己认得的名字；不再做的项目收起来但记录还在。
- **AC**
  - AC-1：daemon 有项目表（id、名字、规范化后的绝对路径、创建时间、归档标记）；同一路径（解析符号链接后）只有一个项目
  - AC-2：`project.list / create / update / archive`；创建时路径必须是已存在的目录，否则如实拒绝；名字默认取目录名
  - AC-3：在一个没登记过的路径上建任务时自动建项目；升级时按老会话的 cwd 回填（规则见 SPEC-M8-004）
  - AC-4：`project.list` 带每个项目的任务数与最近活动时间；归档的项目不在侧栏出现，其任务仍能在全部会话里看到，可取消归档
  - AC-5：项目详情页：名字（可改）、路径、在该项目下开始任务的输入框、该项目的历史任务；全部项目页可按名字或路径筛选
- **验收方式**：`bun test daemon/projects.spec.ts` + `apps/web/test/project-view.spec.tsx`
- **层级**：Negotiable · **优先级**：P0

### PRD-M8-004 · 会话与任务
- **用户价值**：随便聊聊不会被项目规矩和仓库文件打扰；决定动手了一键变成任务。
- **AC**
  - AC-1：会话有 `kind`：`chat`（不属于任何项目）或 `task`（必属于一个项目）；落 `session.kind` 事件，`session.list` 带 kind、项目 id、cwd
  - ~~AC-2：`chat` 的工作目录是 `~/.domi/scratch/<会话>`；不加载项目规矩文件、项目 Skill、项目信任询问；沙盒外路径的读写与命令一律询问（断言：默认规则允许的 `fs.read` 在沙盒外也会询问）~~
  - AC-7：`chat` 的工作目录是 `~/.domi/scratch/<会话>`；不加载项目规矩文件、项目 Skill、项目信任询问；文件类工具只能碰沙盒内的路径（沙盒外如实拒绝，与任务越出项目目录时同一套路径收口）；`shell.exec` 即使规则放行也每次询问、规则拒绝的照样拒绝（断言：规则 allow 的 `shell.exec` 在会话里仍然询问；子 agent 继承这两条限制）
  - AC-3：`task` 的工作目录是项目路径（或自动隔离后的 worktree，PRD-M8-006），行为与 M7 一致
  - AC-4：会话转任务：选项目、确认目标 → 新建任务，首条输入附带原会话的引用（PRD-M3-005）；原会话事件一条不变
  - ~~AC-5：侧栏会话栏按最近活动混排会话与任务，任务显示项目名；全部会话页按「无项目 / 各项目」分组，可筛选，含回收站与恢复~~
  - AC-6：侧栏会话栏只列自由会话（按最近活动），任务只出现在项目树下；全部会话页列出全部会话与任务，按「无项目 / 各项目」分组，可筛选，含回收站与恢复
- **验收方式**：`bun test runtime/session-kind.spec.ts` + `apps/web/test/sessions-view.spec.tsx`
- **层级**：Negotiable（AC-7 为 Invariant：INV-03）· **优先级**：P0

### PRD-M8-005 · 目标驱动的任务
- **用户价值**：不写 YAML，说清楚要什么就行；是一口气做完还是拆成多步，系统自己判断。
- **AC**
  - AC-1：`task.create {projectId, goal, attachments?, schedule?}` 建一个 `task` 会话并开始；YAML 入口保留为高级选项
  - AC-2：执行形态由系统决定：先规划，计划给出步骤与建议形态（单会话 / 多节点）；多节点时经 PRD-M7-005 AC-3 转成 DAG 运行；决定落 `plan.decided` 的 `shape` 字段
  - AC-3：计划审阅策略按项目设置 `always / auto / never`（默认 auto：多节点或计划涉及写操作超过阈值时才让人审）；不审时自动批准也落 `plan.decided{source:'policy'}`
  - AC-4：任务页列出进行中与历史任务（单会话任务与 DAG 运行统一展示），可看节点、重试失败节点、取消、打开节点会话
- **验收方式**：`bun test runtime/task-create.spec.ts` + `apps/web/test/tasks-view.spec.tsx`
- **层级**：Negotiable · **优先级**：P0

### PRD-M8-006 · 自动隔离与改动条
- **用户价值**：不用理解 worktree；domi 自己判断要不要避开我的工作区，改完了告诉我改了什么。
- **AC**
  - AC-1：任务是否隔离由策略决定：项目设置 `auto / always / never`（默认 auto）；auto 时在 git 仓库里、且（工作区有未提交改动 或 任务是多节点 或 由定时触发）才隔离；决定落 `worktree.create` 或 `session.kind` 的 `isolation` 字段并注明原因
  - AC-2：界面上没有「隔离会话」字样；隔离的任务有待带回的改动时，顶部出现「N 个文件改动 · 查看 · 带回」条，展开即 M7-006 的逐文件审阅
  - AC-3：带回仍是人工批准动作（M7-006 AC-3 不变）；非 git 目录退回步级快照（M7-006 AC-5 不变）
- **验收方式**：`bun test runtime/isolation-policy.spec.ts` + `apps/web/test/changes-bar.spec.tsx`
- **层级**：Negotiable（AC-3 为 Invariant：INV-03）· **优先级**：P1

### PRD-M8-007 · 定时任务
- **用户价值**：每天早上自动跑一遍检查、每周整理一次记忆，不用自己记得。
- **AC**
  - AC-1：任务可带计划：5 段 cron 表达式 + 时区；非法表达式如实拒绝并指出哪一段；界面显示下次运行时间
  - AC-2：到点时建一个 `task` 会话执行同一个目标，落 `schedule.fire {scheduleId, due, late}`；同一个计划上一次还没结束时本次跳过并记录
  - AC-3：domid 没开期间错过的，启动后每个计划最多补跑一次（断言：假时钟跳过 5 个周期只触发 1 次，且 `late:true`）
  - AC-4：可暂停、恢复、立即运行、编辑、删除；可看每个计划的历史运行（打开对应任务）
- **验收方式**：`bun test daemon/scheduler.spec.ts`（假时钟）
- **层级**：Negotiable · **优先级**：P1

### PRD-M8-008 · 会话视图
- **用户价值**：对话、思考、工具、审批一条流看清楚；想查细节切到轨迹。
- **AC**
  - AC-1：Chat / Trajectory 两个 tab；Chat 流按原型样式渲染用户、思考（可折叠，带耗时）、工具调用（状态 pill、耗时、可展开参数与结果）、确认卡（内嵌，默认焦点在拒绝，含计划审批与 elicitation 表单）、assistant、错误
  - AC-2：状态栏 pill：连接状态、turns / steps / tok/s、tokens / cache 命中率、上下文占用、花费、模式与验证状态、主题切换；这些数都由 runtime 的 metrics 推过来（`packages/kernel/src/metrics.ts` 增加字段，客户端不算）
  - AC-3：Trajectory 按轮分组，标签分 system / context / user / assistant / tool / permission 六类；有时间线（输入、模型、工具三行）、Duration / Turns / Calls 过滤与搜索
  - AC-4：原有操作保留：每条消息 hover 出「分支」，用户输入 hover 出「引用这一轮」；会话标题可改、可删除（两步确认）、可转任务
- **验收方式**：`bun test apps/web/test/session-view.spec.tsx` + `bun test kernel/metrics.spec.ts`
- **层级**：Negotiable（AC-1 的默认焦点为 Invariant：INV-03）· **优先级**：P0

### PRD-M8-009 · 运行与未读状态
- **用户价值**：一眼看出哪个还在跑、哪个跑完了我还没看。
- **AC**
  - AC-1：`session.list` 带 `busy` 与 `unread`；列表变化由 daemon 推送（`sessions.changed` 通知），不轮询
  - AC-2：已读位置记在 daemon（按会话的最后已读 seq），在任一客户端看过即为已读，TUI 与 Web 一致
  - AC-3：状态点统一在左侧：运行 = 蓝色脉冲、未读 = 黄、其他 = 灰；侧栏、项目详情、全部会话三处一致
- **验收方式**：`bun test daemon/unread.spec.ts` + `apps/web/test/layout.spec.tsx`
- **层级**：Negotiable · **优先级**：P1

### PRD-M8-010 · Composer
- **用户价值**：引用项目文件、贴截图、指定技能、换模型，都在输入框里完成。
- **AC**
  - AC-1：Enter 发送、Shift+Enter 换行；忙时发送按钮不可点（M3-004 AC-3 不变）；待发送引用以 chip 显示
  - AC-2：「文件」与输入 `@`：从项目文件清单（`fs.list`，遵守 .gitignore，复用 M7-001 的清单）里选，作为引用带进这一轮；会话里选的是沙盒文件
  - AC-3：上传与粘贴附件：存到 `~/.domi/attachments/<会话>/`，单个上限可配置（默认 20MB）；模型支持图片时作为图片输入，不支持时如实提示而不是静默丢弃；`user.input.uploads` 记录附件引用
  - AC-4：「技能」与输入 `/`：列出可用 Skill（`skill.list`），可搜索；选中的 Skill 这一轮强制注入，记在 `user.input.skills`
  - AC-5：模型下拉来自 `model.list`（已配置的供应商与模型）；切换走 `session.switchModel`；模式按钮切换执行 / 计划（M7-005）
- **验收方式**：`bun test runtime/attachments.spec.ts` + `apps/web/test/composer.spec.tsx`
- **层级**：Negotiable · **优先级**：P1

### PRD-M8-011 · 配置读写与凭据
- **用户价值**：在设置页改配置、填 key，不用开终端；key 不会明文出现在配置文件和界面上。
- **AC**
  - AC-1：`config.get` 返回当前生效配置，所有凭据字段只给掩码（前缀 + 末 4 位）与来源（env / secrets / config）
  - AC-2：`config.set {patch}` 只接受白名单内的键；`permissions`、`hooks`、`mcp`、`plugins.install` 等不在白名单（断言：带这些键的 patch 整体被拒，文件不变）
  - AC-3：写入经 schema 校验后回写 `~/.domi/config.yaml`，保留用户的注释与键顺序；daemon 热加载，下一轮生效
  - AC-4：凭据写进 `~/.domi/secrets.yaml`（权限 0600），不写进 config.yaml；读取优先级：环境变量 > secrets.yaml > config.yaml（旧写法继续兼容）
- **验收方式**：`bun test config/write.spec.ts` + `bun test daemon/config-rpc.spec.ts`
- **层级**：Negotiable（AC-2 为 Invariant：INV-03）· **优先级**：P0

### PRD-M8-012 · 设置页
- **用户价值**：所有能在 Web 上改的设置在一个地方。
- **AC**
  - AC-1：7 个 tab：通用 / 模型供应商 / 通讯工具 / 记忆管理 / Soul 与人格 / 插件 / 用量统计；tab 在地址里
  - AC-2：通用：语言（只有简体中文可选）、主题、5 个 accent 色板。模型供应商：默认模型；Anthropic、OpenAI、DeepSeek、OpenAI 兼容网关各自的 key 与 base URL
  - AC-3：通讯工具：Telegram、微信两项显示为「即将支持」，不可操作
  - AC-4：记忆管理：逐字保留轮数、压缩阈值、记忆抽取间隔、结构化清理开关，都经 `config.set` 保存
  - AC-5：Soul 与人格：编辑并保存 Soul 文本、待审阅改动的接受 / 否决（M4-003）、记忆条目的保留 / 否决与检索、导出 / 导入 soul.md（M4-004）
  - AC-6：插件：卡片列出已装插件与沙箱状态，启停开关写配置并即时生效；有 UI 面板的插件仍在无同源沙箱 iframe 里打开（ADR-022）
- **验收方式**：`bun test apps/web/test/settings-view.spec.tsx` + `bun test daemon/plugin-toggle.spec.ts`
- **层级**：Negotiable · **优先级**：P1

### PRD-M8-013 · 用量统计
- **用户价值**：知道这个月花了多少、花在哪个模型上。
- **AC**
  - AC-1：`usage.summary {from, to}` 按月、按模型聚合 tokens、花费、会话数、cache 命中率、工具调用数、权限询问数，只从事件投影（INV-13）
  - AC-2：用量 tab 上方 6 张数字卡，下方按模型的柱状图；未定价模型的花费显示「—」而不是 $0（沿用 PRD-M1-007 AC-4）
- **验收方式**：`bun test daemon/usage.spec.ts`
- **层级**：Negotiable · **优先级**：P2

### PRD-M8-014 · TUI 主界面改版
- **用户价值**：终端里看到的和 Web 是同一套概念与配色；一眼知道在哪个项目、哪个任务里。
- **AC**
  - AC-1：顶栏显示「项目 › 标题」与轮数（自由会话显示「会话 › 标题」）；终端宽度不足时标题截断，项目名保留
  - AC-2：各类行按原型的前缀与颜色渲染：用户 `›`、思考 `·`、工具 `⚙`（右侧「状态 · 耗时」）、结果 `←`、assistant `✓ domi:`、上下文 `✂`（附 tokens 与 cache 命中）、任务 `▸`、错误 `✗`
  - AC-3：权限询问是对话流里的内嵌框（工具、路径、说明），按键 `y` 允许 / `n` 拒绝 / `a` 本会话始终允许；**回车 = 拒绝**，高亮在拒绝上（INV-03）；表单类询问（计划审批、elicitation）同样内嵌
  - AC-4：状态栏：连接、模型、turns / steps / tok/s、tokens / cache、ctx（按级别变色）、模式、验证状态、花费、右侧运行状态；40 列下整体折行（沿用现有测试）；下方一行快捷键提示
  - AC-5：输入行 Enter 发送、`Ctrl+J` 或 `Alt+Enter` 换行（终端支持 kitty 键盘协议时 Shift+Enter 也换行）；提示文案与实际按键一致
  - AC-6：配色取自 PRD-M8-001 AC-6 的共享 token；`tui.theme: auto | dark | light`（auto 读 `COLORFGBG`，读不到按深色）；终端不支持 truecolor 时退回 16 色；`NO_COLOR` 时不输出颜色
- **验收方式**：`bun test apps/tui/test/golden.spec.tsx`（更新金样）+ `bun test apps/tui/test/theme.spec.ts`
- **层级**：Negotiable（AC-3 的默认拒绝为 Invariant：INV-03）· **优先级**：P0

### PRD-M8-015 · TUI 弹层与快捷键
- **用户价值**：不离开终端就能切项目、翻会话、看和建任务。
- **AC**
  - AC-1：输入框为空时 `p` 项目、`s` 会话、`t` 任务、`?` 帮助；任何时候 `Ctrl+P` / `Ctrl+R` / `Ctrl+T` 等价；`Esc` 关闭弹层；不占用 `Ctrl+S`（断言：输入框非空时按 p 是输入字符）
  - AC-2：项目弹层：可搜索，列出名字、路径、任务数，`↑↓` 选择、`Enter` 在该项目下开始新任务
  - AC-3：会话弹层：可搜索，按「无项目 / 各项目」分组，左侧状态点（运行 / 未读 / 其他），`Enter` 打开
  - AC-4：任务弹层：进行中与定时两组；`Enter` 打开任务或立即运行定时任务，`n` 打开新建表单（项目、目标、可选 cron，非法 cron 当场提示），`p` 暂停 / 恢复定时任务
  - AC-5：输入 `/` 弹出命令补全，`@` 弹出文件补全（同 PRD-M8-010 AC-2 的清单）
- **验收方式**：`bun test apps/tui/test/overlays.spec.tsx`（扩展 `test/render.tsx`，用假 stdin 驱动按键；不引 ink-testing-library）
- **层级**：Negotiable · **优先级**：P1

### PRD-M8-016 · 本会话内始终允许
- **用户价值**：同一个任务里连续改十个文件，不用点十次允许；换个任务照样会问。
- **AC**
  - AC-1：询问可以回答「本会话始终允许」：同一会话内同一能力（路径类限定在同一目录及其子目录下）之后自动允许，落 `permission{source:'session-grant'}` 事件
  - AC-2：授权只活在这个会话里：不写配置、不影响其它会话与子 agent 之外的会话（子 agent 仍只能收窄，PRD-M5-001 AC-3）；会话重开后从事件恢复
  - AC-3：Web 确认卡与 TUI 权限框都提供这个选项；`shell.exec` 不提供（命令触达范围无法静态限定）
- **验收方式**：`bun test capability/session-grant.spec.ts`
- **层级**：Invariant（INV-03）· **优先级**：P1

### PRD-M8-017 · TUI 启动上下文
- **用户价值**：在仓库里敲 `domi` 就是在这个项目里干活；在别处敲就是随便聊聊。
- **AC**
  - AC-1：`domi` 在已登记项目的目录（或其子目录）、git 仓库、含 `AGENT.md` / `AGENTS.md` 的目录里启动 → 在该项目下开任务（未登记则自动登记）；其它目录 → 自由会话
  - AC-2：`domi --chat` 强制自由会话；`domi -p <项目名或路径>` 在指定项目下开任务；项目不存在时如实报错并列出相近的项目名
  - AC-3：`domi -c` / 会话弹层打开已有会话时不改变它的 kind
- **验收方式**：`bun test apps/tui/test/launch-context.spec.ts`
- **层级**：Negotiable · **优先级**：P1

**M8 DoD**：用户连续一周只用 Web 端做日常工作（至少两个项目的任务、一个定时任务、在设置页换过一次 key），
期间没有因为界面缺功能而回终端；旧的七个面板组件已被替换，`docs/parity-checklist.md` 更新；TUI 按新原型走查一遍（深浅终端各一次）。

---

## 2. 全局非功能需求

| ID | 需求 | 验收方式 |
|---|---|---|
| NFR-01 | 冷启动到可输入 < 500ms（单二进制） | `scripts/bench-startup.sh`（CI） |
| NFR-02 | 10 万条事件的会话，`buildContext` P95 < 200ms | `bench/build-context-10w.ts`（CI） |
| NFR-03 | 空闲 daemon 常驻内存 < 300MB | nightly 内存监测 |
| NFR-04 | CI 全量跑完 < 3 分钟 | CI 耗时看板，超时则 CI 失败 |
| NFR-05 | 出站网络仅限用户显式配置的模型端点与 MCP server | `scripts/check-egress.ts`：集成测试中拦截所有出站请求并比对白名单（INV-11） |
| NFR-06 | 所有用户数据默认存于 `~/.domi/`，不上传 | `scripts/check-write-paths.ts`（见 PRD-M1-010 AC-4） |
| NFR-07 | 支持 macOS(arm64/x64)、Linux(x64/arm64)；Windows 经 WSL | CI 矩阵构建 + 冒烟 |
| NFR-08 | 崩溃时事件流不损坏，重启可恢复 | `bench/kill-fuzz.ts`：随机时点 kill × 50 次 |
| NFR-09 | **CI 门禁在无任何真实 API key 的环境中全绿**（INV-08 的可核查形式） | CI 中显式 unset 所有 provider 环境变量后跑全量门禁 |
| NFR-10 | 无障碍：**v1 显式不做**。理由：目标用户为 CLI 开发者，Web 端定位为轨迹查看的补充视图。v1.0 发布后重新评估并记 ADR | 无（范围声明，非需求） |

---

## 3. 术语表

| 术语 | 定义 |
|---|---|
| **事件流** | 会话的唯一真相来源，append-only，见 INV-01 |
| **投影** | 从事件流派生的只读视图（上下文、摘要、统计、轨迹） |
| **Tool** | 唯一的执行原语，见 INV-05 |
| **Skill** | 提示词 + 资源包，不可执行，只注入上下文 |
| **Plugin** | 分发单元，可打包 tool / skill / MCP 配置 / UI 扩展 |
| **Capability** | Tool 与 Skill 的统一注册抽象，携带权限声明 |
| **Soul** | L4 人格层，人类可读 Markdown，可 diff、可否决、可导出 |
| **轨迹** | 事件流的可视化渲染，无独立埋点 |
| **回写门** | 下游发现上游文档问题时，必须先改文档再继续，见 `PROCESS.md` |
| **再批准门** | 非 COMMITTED 里程碑进入前必须重写并重过 PM 门禁 |
| **parity checklist** | `docs/parity-checklist.md`，TUI 与 Web 的功能对等清单，M3-003 AC-1 的判据 |
