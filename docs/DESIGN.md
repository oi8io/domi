# domi — 架构与路线图

> 一个有灵魂的、可观测的本地优先 Agent 运行时
> 版本 v0.2 · 2026-08-24 起草，2026-09-14 回写（`docs/adr/003`：§6 包结构新增 checkpoint / eval / bridge-telegram）

---

## 0. 先泼三盆冷水

在进入架构之前，有三件事必须先讲清楚，否则后面所有排期都是自欺欺人。

**第一，你列的 10 项功能全做完，全职大约 6–9 个月。** 这不是吓唬人。光是"三端 + 多模型 + 插件 + MCP + 多 agent 编排"这五项，任意一项在成熟项目里都是一个专职方向。所以本文档的核心工作不是"怎么把 10 项都做出来"，而是**哪些现在就把契约钉死、哪些只留扩展点、哪些必须砍到 v2**。

**第二，2026 年的 agent 框架赛道已经非常拥挤。** Mastra、AI SDK、LangGraph、一票 coding agent CLI 都在抢同一批开发者。你列的 10 项里，有 8 项是 *table stakes*——做得再好也只是"和别人一样"。真正稀缺的只有三个：

- 第 4 项里的 **沉淀 soul**（跨会话的人格/知识沉淀，绝大多数开源 agent 做得很糟）
- 第 6 + 9 项的组合：**跨会话操作 + loop 编排**（有状态的、能被中断和恢复的长任务）
- 第 10 项 **轨迹显示**（可观测性，几乎没人做成一等公民）

开源冲社区，靠的是**一个记忆点**，不是功能清单长度。所以 domi 的定位建议收成一句话：

> **domi = 会积累"人格"的 agent 运行时，你能看见它每一步在想什么，且它在你的机器上。**

Soul 是记忆点，轨迹是信任感，本地优先是立场。其余七项都是支撑这三点的地基。

**第三，你给的端顺序（web → desktop → tui）建议整个倒过来。** 开源 agent 的早期用户 100% 是开发者，他们的第一印象来自一张终端里的 GIF，不是一个需要 `npm run dev` 的网页。TUI 出 demo 最快、心智门槛最低、最容易上 HN 首页。而 Web 做完之后，桌面端用 Tauri 套壳的边际成本几乎为零——桌面端不该是"第二端"，它是"Web 端的一个打包目标"。

**建议端顺序：TUI → Web → Desktop（套壳）。**

---

## 1. 一句话定位与非目标

**是什么**：一个本地优先（local-first）的通用 Agent 运行时。内核是一个可嵌入、无 UI 的 daemon，三端只是它的视图。

**不是什么**（明确写进 README，能挡掉一半无效 issue）：

- 不是 LangChain 那样的"编排 SDK"——domi 是**跑起来的东西**，不是让你写代码的库
- 不是又一个 coding agent——写代码只是 domi 的一个 skill
- 不是 SaaS——v1 没有账号、没有云端存储、没有计费
- 不是 prompt 管理平台

---

## 2. 三个决定性架构决策

整份架构里，只有三个决策是**改起来会伤筋动骨**的。其余都可以后期重构。这三个必须现在想清楚。

### 决策一：Daemon 架构，而不是三端各自嵌内核

```
┌─────────┐  ┌─────────┐  ┌─────────┐
│   TUI   │  │   Web   │  │ Desktop │      ← 视图层，无业务逻辑
└────┬────┘  └────┬────┘  └────┬────┘
     └────────────┼────────────┘
            Domi Protocol (JSON-RPC + 事件流)
                  │
            ┌─────┴─────┐
            │   domid   │                   ← 唯一的真相来源
            │  (daemon) │
            └───────────┘
```

**为什么必须这样**：你的第 6 项（跨会话操作）和第 9 项（多 agent 编排）本质上要求"多个执行体共享同一份状态"。如果三端各自 embed 内核，TUI 里起的长任务在 Web 端就看不见，跨会话操作就无从谈起。Daemon 是这两项功能的**架构前提**，不是可选优化。

**附带收益**：daemon 可以跑在本地，也可以跑在远程机器上（`domi --connect ssh://box`）。未来若要产品化，服务端形态不需要重写内核——只是把 daemon 部署到别处。

**代价**：多了一层进程管理和协议版本管理。值得。

### 决策二：会话是 append-only 事件流，不是 message 数组

这是整份设计里**杠杆最大的一个决策**。一个决策同时喂饱四项需求：

| 需求 | 事件流如何满足 |
|---|---|
| 第 4 项 上下文压缩 | 压缩是在事件流上做**投影**，原始事件永不丢失，压错了可回滚重压 |
| 第 6 项 会话管理 | 会话分支 / fork / time-travel 天然成立，就是从某个 seq 重放 |
| 第 8 项 实时状态栏 | 状态栏 = 事件流的实时聚合，不用另做埋点 |
| 第 10 项 轨迹显示 | 轨迹 = 事件流的渲染，不用另做 tracing |

如果用传统的 `messages: Message[]`，上面四项每一项都要单独造轮子，而且压缩后原始信息就永久丢失了。

```ts
type DomiEvent =
  | { t: 'user.input';    text: string; attachments?: Ref[] }
  | { t: 'model.request'; provider: string; model: string; tokensIn: number }
  | { t: 'model.delta';   text: string }
  | { t: 'model.reason';  text: string }          // 思维链，轨迹显示的关键
  | { t: 'tool.call';     id: string; name: string; args: unknown }
  | { t: 'tool.result';   id: string; ok: boolean; payload: unknown; ms: number }
  | { t: 'ctx.compact';   fromSeq: number; toSeq: number; summaryRef: string }
  | { t: 'memory.write';  layer: 'L3' | 'L4'; key: string; diff: string }
  | { t: 'task.spawn';    childSessionId: string; goal: string }
  | { t: 'error';         scope: string; message: string; recoverable: boolean }

interface EventEnvelope {
  seq: number
  sessionId: string
  parentSeq: number | null     // 支持分支
  ts: number
  ev: DomiEvent
}
```

**存储**：SQLite（`better-sqlite3` / `bun:sqlite`）。单文件、零运维、支持 WAL 并发读、FTS5 做全文检索、`sqlite-vec` 扩展做向量检索。本地优先项目不要引 Postgres/Redis。

**上下文构建**是一个纯函数：

```ts
buildContext(events: EventEnvelope[], policy: ContextPolicy): ModelMessages
```

纯函数意味着**可单测、可回放、可 A/B 不同压缩策略**。这一点在做第 4 项时会救你的命。

### 决策三：Tool / MCP / Skill / Plugin 的四层关系必须现在钉死

这四个概念极易打架，后期重构成本是所有模块里最高的。定义：

```
Plugin  ── 分发单元（一个可安装的包）
  ├── 提供 Tool（本地可执行体）
  ├── 提供 Skill（提示词 + 资源包）
  ├── 声明 MCP Server（外部 tool 来源）
  └── 提供 UI 扩展（可选，仅 Web/Desktop）

Tool    ── 唯一的执行原语。所有能"做事"的东西最终都归约成 Tool
MCP     ── Tool 的一种**来源**（远程/进程外），不是与 Tool 并列的概念
Skill   ── **不可执行**。是提示词 + 参考资料 + 声明依赖的 Tool 列表，
           作用是"按需注入上下文"，不是"被调用"
```

关键判断：**Skill 不是 Tool**。Skill 的价值在于渐进式披露（progressive disclosure）——只在需要时把大段专业知识注入上下文。把它做成"可调用的 tool"是常见的设计错误，会让模型把"学习一项技能"和"执行一个动作"混淆。

统一的能力注册表：

```ts
interface Capability {
  id: string                              // 'fs.read' | 'mcp:github/create_pr'
  kind: 'tool' | 'skill'
  origin: { type: 'builtin' | 'plugin' | 'mcp'; ref: string }
  schema: JSONSchema                      // tool 用
  permission: PermissionSpec              // 统一权限模型，见 §4
}
```

---

## 3. 十项需求：固化 / 半固化 / 待定 三层分拣

这是你要的核心答案。判据是：**这项功能的"接口契约"现在能不能定死而不后悔。**

### A 层：现在就固化（契约锁定，实现可迭代）

| # | 需求 | 固化什么 | 为什么现在能定 |
|---|---|---|---|
| 1 | 三端 | **Domi Protocol**（daemon ↔ 客户端的 JSON-RPC + 事件订阅）| 协议一旦定死，加端就是纯前端工作，零内核改动 |
| 2 | 多模型 | `ModelProvider` 接口 + 能力矩阵（是否支持 tool call / 视觉 / 思维链 / prompt cache）| 模型 API 已收敛，OpenAI-compatible 是事实标准 |
| 3 | 提示词系统 | 提示词是**分层可组合的结构体**，不是字符串模板 | 见下 |
| 6 | 会话管理 | 会话 = 事件流 + 元数据；分支/fork/归档语义 | 事件流决策一旦定，语义自然确定 |
| 8 | 状态栏 | 统计指标 = 事件流的聚合投影；指标 schema | 指标口径（token/耗时/花费/工具数）业界已标准化 |
| 10 | 轨迹显示 | 轨迹 = 事件流渲染；`model.reason` / `tool.*` 事件必须一开始就埋 | **埋点必须第一天就做**，后补代价极大 |

**关于第 3 项提示词的具体固化建议**——不要做成 Handlebars 模板拼字符串，做成分层结构：

```ts
interface PromptLayer {
  id: string
  role: 'identity' | 'soul' | 'env' | 'capability' | 'skill' | 'task' | 'guardrail'
  priority: number          // 决定拼装顺序
  cacheable: boolean        // 决定能否进 prompt cache 前缀
  render(ctx: RuntimeCtx): string | null
}
```

`cacheable` 这个字段至关重要：**所有 cacheable 层必须在前、且 byte 级稳定**，动态内容（时间戳、状态）一律放最后一条 user message。这直接决定 prompt cache 命中率，进而决定成本和延迟。很多项目是在成本爆炸后才回头改这个，改起来要动整个提示词系统。

结构化输出侧：统一走 JSON Schema，对不支持 structured output 的模型用 `Zod schema → 提示词约束 + 解析重试` 兜底，接口对上层一致。

### B 层：半固化（机制定死，策略可插拔）

| # | 需求 | 定死的部分 | 留白的部分 |
|---|---|---|---|
| 4 | 压缩 + 记忆 | 记忆分层模型 L0–L4；`Compactor` 接口 | 具体压缩策略（可插拔、可 A/B） |
| 7 | Skill + MCP | MCP client（跟标准走）；Skill 的**加载机制** | Skill 的**打包格式**（等社区验证） |

**第 4 项的记忆分层**——这是 domi 的灵魂所在，值得展开：

```
L0  工作记忆    当前上下文窗口                     易失
L1  会话摘要    结构化压缩产物                     随会话
L2  情节记忆    可检索的历史事件片段（向量+FTS）    跨会话
L3  语义记忆    抽取出的事实/偏好/实体             跨会话
L4  Soul       从 L3 蒸馏的稳定人格层              长期
```

`Compactor` 接口保持可插拔，因为压缩策略目前**没有公认最优解**，各家都在试。业界已验证的做法按优先级：

1. **结构化清理**（零成本、确定性）：去重工具结果、规范化冗长输出、清除已解决的错误、截断堆栈。能省 15–30% 上下文且**零信息损失**。这一步必须做在任何 LLM 压缩之前——很多项目直接上 LLM 摘要，白烧钱。
2. **保边压中**（hybrid）：system prompt + 最近 N 轮逐字保留，中间历史换成结构化摘要。当前生产环境最主流。触发阈值 70–75%。
3. **结构化摘要模板**（不要自由文本摘要）：固定字段 `Intent / Files Modified / Key Decisions / Open Questions / Next Steps`。自由文本摘要在"追踪产物变更"上的评测得分只有 2.19–2.45 / 5.0，是主要失效点。
4. **外部记忆卸载**：把重要事实主动写到结构化存储，不参与压缩链。**这是唯一能避免"压缩链累积误差"（context rot）的办法**，也是 L3/L4 的实现基础。

已知失效模式，写进设计文档以便后续对照：压缩链反复摘要会逐层磨平细节；纯淘汰策略会破坏引用链；纯向量检索会**静默失败**（检索不到时没有任何错误信号，模型就是"忘了"）。

**关于 Soul（L4）的具体设计建议**——这是你的传播点，不要做成"又一个长期记忆"：

- Soul 以**人类可读的 Markdown** 存在，不是向量库里的黑盒
- Soul 是 **git 可 diff、可 review、可手改** 的
- Soul 的每次更新产生一个 `memory.write` 事件，用户能看到"domi 今天学到了什么"并且能否决
- Soul **可导出、可导入、可分享**：`domi soul export > my-soul.md`

最后这条是社区裂变点。想象社区里流传"某某的 domi soul"——这是别的 agent 框架给不了的东西。Soul 的内容分区建议：`工作习惯 / 技术偏好 / 沟通风格 / 领域知识 / 对用户的模型 / 失败教训`。

**第 7 项 MCP 的一个重要情报**：MCP 规范在 **2026-07-28** 版本发生了重大转向——协议从**有状态双向**改为**无状态请求/响应**，取消了 `initialize` 握手和 `Mcp-Session-Id`。对你是好消息：client 实现大幅简化。但要注意两个坑：

- **Sampling、Roots、Logging 已官方弃用**（保留 12 个月过渡期）。不要把架构建立在 sampling 之上。
- 新增 **MRTR（多轮请求）**：server 返回 `resultType: "input_required"`，client 带 `inputResponses` 重试。这是取代 server 端主动请求的机制，client 必须实现。
- 新增列表缓存提示 `ttlMs` / `cacheScope`——直接用上，能显著降低启动延迟。

建议直接对齐 2026-07-28，跳过老的 HTTP+SSE transport（同样一年内废弃）。

### C 层：最后做，现在只留扩展点

| # | 需求 | 为什么要押后 | 现在要留的口子 |
|---|---|---|---|
| 5 | 插件系统 | 过早定 plugin API 会把内核锁死。**必须等 5–8 个内置能力跑通、抽象自然浮现之后再抽 API** | 所有内置能力都通过 `Capability` 注册表注册（自己吃自己的狗粮）；预留 `plugins/` 目录与 manifest 草案 |
| 9 | Loop 编排 + 多 agent | 最容易做成玩具的一项。多 agent 协商在开源项目里的实际价值远低于宣传 | `task.spawn` 事件先埋；会话支持父子关系 |
| — | Soul (L4) | 需要真实使用数据才知道该沉淀什么 | L3 语义记忆先跑通并积累数据 |

**关于第 9 项的强烈建议：把"多 agent"降级为"sub-agent"。**

多 agent 通常有两种做法：

- **协商式**（agent 之间对话、辩论、投票）——研究价值高，实用价值低，token 消耗爆炸，且极难调试
- **子任务隔离式**（父 agent 派生子 agent 执行隔离任务，子 agent 有独立上下文窗口，只回传结论）——**这才是实际有用的那种**，核心价值是"上下文隔离"而非"多个大脑"

v1 只做后者。它复用你已有的会话父子关系，几乎零额外架构成本。协商式留到 v2 再说，或者永远不做。

至于 loop 编排，v1 建议做**最朴素但可靠**的形态：一个 DAG，节点是 `agent step | tool | sub-agent | 人工确认`，状态持久化在事件流里，进程重启能恢复。不要一上来就做可视化流程编辑器。

---

## 4. 一个你没列但必须现在做的东西：权限模型

10 项需求里没有安全和权限，但对一个"能执行任意工具 + 装第三方插件 + 连外部 MCP"的 agent，这是**后期无法补上**的东西。它必须和 `Capability` 注册表同时诞生。

```ts
type PermissionMode = 'ask' | 'allow' | 'deny'

interface PermissionSpec {
  fs?:   { read?: string[]; write?: string[] }   // glob，默认仅工作目录
  net?:  { hosts?: string[] }                    // 默认 deny
  exec?: { allowed?: string[] }                  // 默认 ask
  secrets?: string[]                             // 显式声明需要哪些凭据
}
```

三条硬规则，写进内核而不是文档：

1. **默认拒绝**。插件必须在 manifest 里显式声明所需权限，安装时展示给用户。
2. **权限决策产生事件**，进轨迹。用户能事后审计"谁在什么时候动了我的文件"。
3. **MCP server 的输出是不可信数据**，不是指令。提示词层要有 guardrail 层显式声明这一点——prompt injection 通过 MCP 工具结果传入是当前最现实的攻击面。

这一块做扎实，本身就是一个差异化卖点。本地优先 + 可审计轨迹 + 默认拒绝权限，这三者组合起来是一个完整的信任叙事。

---

## 5. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | **Bun**（Node 22+ 兼容兜底） | 启动快、内置 SQLite、内置测试与打包。对 CLI 体验提升明显。风险：部分 native 模块兼容性，需在 M0 验证 |
| 包管理 | **pnpm workspace**（**不用 Turborepo**，见 `docs/adr/008`） | 5 个包、全量检查 10 秒内，任务编排与缓存是纯负担 |
| Lint / 格式化 | **Biome 2.5.13**（`docs/adr/007`） | 单二进制管 lint + format，零 native 依赖，毫秒级全仓检查 |
| 契约校验 | **zod 4.6.5**（`docs/adr/006`） | 事件类型会一直增长，类型实例化开销比解析性能更要紧；现在迁移面最小 |
| 共享状态 | **nanostores 1.5.3** + `@nanostores/react`（`docs/adr/009`） | 消费方有四类，其中桥接进程与评估回放**不是 React**；核心与框架解耦才能让 `client-core` 不依赖 react |
| 模型层 | **自研薄 `ModelProvider` 抽象**，底下默认接 Vercel AI SDK（`ai@7.x`，见 `docs/adr/004`）；同时提供 OpenAI-compatible 直连 provider | 不要把 AI SDK 直接暴露给内核。自研一层薄抽象（约 300 行）保留切换自由，且能表达 AI SDK 覆盖不到的能力（本地 llama.cpp、自定义思维链解析） |
| 网关（可选） | 用户可配置指向 **LiteLLM / OpenRouter** | LiteLLM 可自托管、覆盖 100+ provider、支持本地模型，最契合本地优先定位。但只作为**可选后端**，不作为依赖 |
| 存储 | **SQLite**（WAL + FTS5 + sqlite-vec） | 单文件零运维；全文与向量检索一站解决 |
| 配置 | **YAML**，用 Bun 内置的 `Bun.YAML`（2026-09-15 回写，原为 TOML，见 `docs/adr/014`） | 用户写得顺手；内置的够用就不引库 |
| MCP | `@modelcontextprotocol/sdk` —— **版本未定，见 `docs/adr/010` 的已知风险** | 对齐 2026-07-28 的 v2 仍是 beta，latest 的 1.30.0 是旧规范。进入 M2 的再批准门上决定 |
| TUI | **Ink 7 + React 19**（2026-09-14 回写，见 `docs/adr/001-runtime-choice.md`）；OpenTUI 推后为退路 | 实测推翻了原来的性能理由：Ink 自带 32ms 节流把 300 次 rerender 合并成 82 次写出，端到端 P95 4.6ms，余量在 200fps 量级，而模型每秒只吐几十个 token。真正的决定因素是**架构契合**：Ink 是 React，与 Web 端共用 `client-core` 的 hooks 与状态层（INV-02）；`ink-testing-library` 已验证在 Bun 下可用，`PRD-M0-005` AC-4 的四宽度 golden 快照有着落；零 native 依赖，对 Bun 的兼容风险面增量为 0。OpenTUI 的优势项（高帧率多区域动画）不是 domi 的形态 |
| Web | React + Vite + Tailwind + shadcn/ui | 与 TUI 共享 React 心智，状态层可复用 |
| Desktop | **Tauri v2** 套 Web 产物 | 体积小、内存低；桌面端 = Web 的打包目标，不是独立端 |
| 协议 | JSON-RPC 2.0 over stdio（本地）/ WebSocket（远程），事件走 SSE 或 WS 推送 | 与 MCP 心智一致，实现成本低 |

**共享层设计**：`@domi/client-core` 包含协议客户端、事件订阅、状态 store（**nanostores**，见 `docs/adr/009`；`client-core` 本身不依赖 react，由 dependency-cruiser 守）。TUI 和 Web 只写渲染，不写状态逻辑。这决定了两端的一致性维护成本。

---

## 6. 包结构

```
domi/
├─ packages/
│  ├─ kernel/          # agent loop、事件流、上下文构建（纯逻辑，零 IO 假设）
│  ├─ store/           # SQLite 事件存储、检索、迁移
│  ├─ model/           # ModelProvider 抽象 + 各家实现 + 能力矩阵
│  ├─ prompt/          # 分层提示词系统、结构化输出
│  ├─ memory/          # L1–L4、Compactor 策略、soul 读写
│  ├─ capability/      # Capability 注册表、权限引擎、内置 tool
│  ├─ config/         # config.yaml + 环境变量装载、启动前自检（2026-09-14 新增）
│  ├─ checkpoint/     # 步级快照与回滚（shadow git，M1 / PRD-M1-011）
│  ├─ eval/           # L1 轨迹回放 + L2 题集 harness（M2/M6 · INV-13）
│  ├─ mcp/             # MCP client (2026-07-28)
│  ├─ orchestrator/    # DAG 调度、sub-agent（M5 之前是空壳）
│  ├─ runtime/        # M0 的进程内接线层（DomiSession 门面）；M3 整体搬进 domid（2026-09-14 新增）
│  ├─ protocol/        # Domi Protocol 类型定义 + codegen（唯一契约来源）
│  └─ client-core/     # 三端共享：协议客户端、事件订阅、状态 store
├─ apps/
│  ├─ domid/           # daemon
│  ├─ tui/             # OpenTUI
│  ├─ web/             # React + Vite
│  ├─ desktop/         # Tauri v2 壳
│  └─ bridge-telegram/ # 聊天端桥接：只读轨迹 + 远程审批（M5 / PRD-M5-007）
├─ plugins/            # 官方示例插件（M6）
└─ docs/
```

**依赖方向铁律**：`kernel` 不依赖任何 apps，不依赖 `store` 的具体实现（只依赖接口）。任何时候 `kernel` 里出现 `import` 了 UI 或 IO 的东西，就是架构在腐化。建议第一天就配 `dependency-cruiser` 或 ESLint boundaries 规则**自动强制**，别靠自觉。

---

## 7. 路线图

每个里程碑对应一个可发布版本 + 一个社区叙事点。时间按全职估算，业余时间约 ×2.5。

### M0 — 内核骨架（2 周）· v0.0.1
- 事件流 + SQLite store + 上下文构建纯函数
- 最小 agent loop（单模型、单会话、无压缩）
- 3 个内置 tool：`fs.read` / `fs.write` / `shell.exec`（带权限询问）
- 极简 TUI：能对话、能看到工具调用
- **Bun 与 OpenTUI 的 spike 验证在此完成**——不通就立刻换，越晚越贵
- ✅ 验收：能在终端里完成一次"读文件→改代码→跑测试"的完整循环

### M1 — 能用（3 周）· v0.1 · 首次公开
- 多模型接入（Anthropic / OpenAI / Gemini / OpenAI-compatible / 本地）+ 能力矩阵 + 运行中切换模型
- 分层提示词系统（含 cacheable 分层，第一天就把 prompt cache 打对）
- 会话管理：列表、恢复、分支、归档
- 状态栏：token / 花费 / 耗时 / 当前模型 / 工具计数
- **叙事点**：一张 TUI 的 GIF。这是你的第一批 star 来源，值得花两天专门打磨视觉

### M2 — 可信（3 周）· v0.2
- MCP client（2026-07-28，含 MRTR + 列表缓存）
- 上下文压缩：结构化清理 → 保边压中 → 结构化摘要模板
- L1 会话摘要 + L2 情节记忆（FTS5 + sqlite-vec）
- **轨迹渲染**：树形展开每一步的思考 / 工具调用 / 耗时 / token
- 权限引擎落地
- **叙事点**："你能看见 agent 在想什么"——轨迹截图 + 压缩前后对比

### M3 — 三端（3 周）· v0.3
- Domi Protocol 正式化 + 版本协商
- daemon 独立进程化 + `client-core` 抽出
- Web 端（对话 / 轨迹 / 会话管理 / 状态栏）
- 跨会话操作：会话间引用、把 A 会话的产物喂给 B
- **叙事点**："终端起的任务，浏览器里接着看"

### M4 — 有灵魂（4 周）· v0.4
- L3 语义记忆抽取
- **Soul (L4)**：Markdown 化、可 diff、可编辑、可否决、可导出导入
- Skill 系统（加载机制 + 渐进式披露 + 3 个官方 skill）
- **叙事点**：这是整个项目的高光时刻。`domi soul export` 分享自己的 soul，这是最有传播力的一个 feature，值得单独写一篇博客

### M5 — 会干活（3 周）· v0.5
- Sub-agent（上下文隔离的子任务）
- Loop 编排：DAG 调度、断点恢复、人工确认节点
- 桌面端 Tauri 打包 + 自动更新
- **叙事点**：一个跑 30 分钟不断线的长任务 demo

### M6 — 生态（4 周）· v1.0
- 插件系统 API 正式化（**此时抽象已经过 5 个内置模块验证**）
- 插件安装 / 权限展示 / 沙箱
- 3 个官方示例插件
- 文档站 + 贡献指南

**累计约 19 周全职 ≈ 4.5 个月**，业余时间 10–12 个月。如果只能做一半，做到 M4 就已经是一个有独特价值、值得发布的项目了；M5/M6 是锦上添花。

---

## 8. 开源社区策略

**LICENSE**：建议 **Apache-2.0**。相比 MIT 多了专利授权条款，对企业采用更友好，而对个人贡献者没有额外负担。除非你担心云厂商白嫖（对一个本地优先的 CLI 工具来说这个风险很低），否则不必上 AGPL——AGPL 会显著劝退企业用户和贡献者。

**第一批 star 的来源排序**：
1. 一张 TUI 的 GIF（M1）——这是投入产出比最高的一件事
2. Soul 的概念（M4）——这是能被人复述的东西。"一个会积累人格的 agent"，一句话能讲清楚
3. 轨迹可视化（M2）——截图友好

**发布节奏建议**：M1 后小范围发（Twitter / 少数群）收反馈，**不要**发 HN；M2/M3 攒够完整故事；M4 Soul 上线时集中发力——HN、Reddit r/LocalLLaMA、V2EX、掘金同步，配一篇讲 soul 设计思路的长文。一个项目在 HN 上基本只有一次机会，别浪费在半成品上。

**降低贡献门槛**：从 M2 开始就保持 5–10 个 `good first issue`；`ModelProvider` 和 Skill 是最适合外部贡献的两个点（新增一个 provider 是自包含的、易 review 的工作），文档里给出模板。

---

## 9. 现在就该做的三件事

按顺序，不要跳：

1. **写 `packages/protocol` 的类型定义**。哪怕一行实现都没有。协议是三端和内核的唯一契约，先写它能强迫你把"事件流有哪些事件"想清楚，这个思考过程比代码值钱。
2. **做 Bun + OpenTUI 的 spike**。两天时间，验证流式输出下的渲染性能和 native 模块兼容性。不通就换，M0 之后再换成本翻十倍。
3. **建仓库，配依赖边界检查**。`dependency-cruiser` 规则：`kernel` 不得依赖 `apps/*` 和任何 IO 包。第一天配好，往后自动守住架构。

---

## 附：本文档引用的关键判断依据

- MCP 规范 2026-07-28 转向无状态、弃用 sampling/roots/logging、新增 MRTR 与列表缓存
- 上下文压缩的六类策略与各自失效模式，特别是自由文本摘要在产物追踪上的低分（2.19–2.45/5.0）与压缩对 prompt cache 前缀的破坏
- LiteLLM 在自托管与本地模型场景的覆盖优势
- OpenTUI 相对 Ink 的渲染性能优势与项目成熟度风险
