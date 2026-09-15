# domi — 产品需求文档（全量）

> 覆盖 M0–M6 全部 6 个里程碑。
> **v1.2** · 2026-09-14 · 作者：PM 环节
> 上位文档：`PRD-VISION.md` v1.1（不变量，冲突时以其为准）
> 变更：v1.0 经两轮独立门禁审计后修订，见 `docs/qa/prd-gate-audit-v1.0.md`
> **v1.2 回写**（触发：`docs/adr/003` 方向变更）——**原 45 条编号与 AC 全部保留不动**，仅追加 5 条新需求
> （M1-011 步级快照 · M2-008 L1 回放评估 · M2-009 内置 MCP server · M5-007 聊天端桥接 · M6-005 L2 评估集）
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
| M6 · 生态 | `SKETCH` | 轮廓级，进入前必须重写 |

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

# M6 · 生态 `SKETCH`

> **轮廓级。进入前必须重写为 `COMMITTED`。**

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
