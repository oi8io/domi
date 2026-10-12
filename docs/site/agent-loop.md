# Agent Loop 内部机制

> `packages/kernel` —— 纯函数的 agent 循环（PRD-M0-002 · SPEC-M0-007），M15 起整体语义见 SPEC-M15-002
> 对应协议事件：`user.input` → `model.*` → `tool.*` → `error` 收场。

## 一句话

**形状：`submit` → 定格 → 预检降级链 → `runTurn`（buildContext ⊕ prompt → withPrompt → generate → 落盘 → tool 回灌）→ 收场。**

kernel 是 domi 里唯一「跑一轮」的地方，而且它**不碰 IO**（INV-02）。它需要的每一样东西都从 `LoopDeps` 注入：

| 端口 | 干什么 | 谁提供 |
|---|---|---|
| `sink: EventSink` | append / read / head 事件 | `@domi/store` 的 `SqliteEventLog` |
| `provider: ProviderLike` | 模型生成（流式） | `@domi/model` 的 `ModelProvider` 适配 |
| `tools: ToolRunner` | 工具 schema 与执行 | `@domi/capability` 的 `ToolRegistry` |
| `clock: Clock` | 时间（终止条件用） | 系统时钟 / 测试假时钟 |
| `policy: ContextPolicy` | 拼上下文的策略（分页、遮蔽、压缩边界） | runtime |
| `refs?` / `inputs?` / `skills?` | 引用 / 附件 / 技能正文 | runtime |
| `prompt?` | 拼好的提示词（`PromptParts` 或函数，M12 起每轮现取） | runtime 的 `DomiSession.prompt()` |
| `notes?` | 运行中补充队列（M13）与动态变化送达（M15） | daemon 的队列 |
| `fingerprint?` | 上一条 `model.request` 的指纹（M15 前缀断裂观测） | runtime 从事件流读 |

端口接口在 `packages/kernel/src/ports.ts`。kernel 用**结构满足**而不是 import store：让 kernel 的依赖闭包里永远不出现 `bun:sqlite`。

## 第 0 步：定格（freeze，M15）

**turn 开始时定格一次**（`session.freeze()`）：soul / 仓库规矩 / 技能清单 / 计划 / 环境（`collectEnv`）只读这份快照——turn 内来源变化不打扰当前请求，下一 turn 或显式刷新（`ctx.refresh`）才生效（SPEC-M15-003 · INV-12(b)）。这就是「Soul 何时进上下文」的答案：**freeze 时取，prompt() 里作为 `builtin.soul` 层拼进去**（详见[提示词分层](prompt-assembly.md)）。

## 第 1 步：预检降级链（degrade，M15）

发请求前按**预算器**估占用（最近 `model.usage` 输入真值 + 本步增量估算 ÷ 有效窗口，与状态栏 / 守卫 / 上下文 tab 同源）：

| 档位 | 均衡 | 节省 | 动作 |
|---|---|---|---|
| 遮蔽 | ≥60% | ≥45% | `ctx.mask`：冷区 tool.result 换指针（一批 ≥8k token，付一次缓存重写） |
| 压缩 | ≥80% | ≥70% | `compactNow('threshold')` |
| 硬顶 | ≥92%（任何档不降） | 同左 | 本轮停：`error{scope:'context', recoverable:true}` + 可执行出路 |

每级动作后**重估占用**，逐级降（`runtime/src/degrade.ts`）。遮蔽 / 压缩动作失败或腾不出 → 继续往下走，最终由硬顶收口。

## 第 2 步：runTurn —— 两条轨道在 withPrompt 汇合

`runTurn(deps, sessionId, input, signal)`（`loop.ts`）：

1. **落盘轮边界**：`user.input`（以及 `ctx.ref` 引用、uploads / files / skills、`noteIds`）同一批 append。
2. **循环**（`for (;;)`）：
   - **安全点 ①**：外部中断检查、墙钟检查之后、`sink.read` 之前，取一次 `notes.take()`——运行中补充（M13）在此送达（此时上一步的 `tool.result` 都已落盘，不会插进 tool_use / tool_result 之间）。
   - **左轨 · 事件投影**：`buildContext(events, policy)`——只有 `user.input` / `user.note` / `ctx.note` / `ctx.ref` / `ctx.fileref` / `model.reason`（策略开关）/ `model.delta` / `tool.call` / `tool.result` / `verify.required` 进模型消息，其余是轨迹（`permission`、`model.usage`、`ctx.mask`、`ctx.compact`、`task.*` 等）。跨会话引用经 `refs.ts` 渲染成带标注的文本块。
   - **右轨 · 提示词层**：`prompt()`（runtime）现拼分层提示词——identity / guardrail / conventions / **soul（动态注入层）** / 技能清单 / 工作区 / 计划 + notes（详见[提示词分层](prompt-assembly.md)）。提示词**不进事件流**：它是每次请求现拼的，改配置下一轮就生效，历史不必重写。
   - **汇合**：`withPrompt(history, prompt)`——notes 追加成新的 user 块（不改已发出的消息，前缀稳定）→ system 块放最前 → 稳定 user 块插 index 1。
   - `provider.generate` 流式产出 `model.delta` / `model.reason` / `tool-call` / `usage`，逐条落盘；`model.request` 带 `ctx`（分段估算，M14）与 `fingerprint`（前缀指纹，M15——`fingerprintOf` / `locateBreak` 用于定位前缀断裂）。
   - 有 tool-call → `tools.run` 执行（权限决策先发生）；`tool.result` 与旁路事件（`fs.snapshot` / `fs.checkpoint` 等）统一由 loop 落盘。
   - **动态变化落 `ctx.note`**（M15）：`prompt().notes`（计划提示变化 / 环境变化等）由 loop 落盘成 `ctx.note` 事件——当轮模型已经通过 withPrompt 的追加块看到了，落盘后下一轮 buildContext 也渲染它（追加送达，允许重复，INV-12(b)）。
   - 参数解析失败计入重试；工具调用计数累加；每个循环开头重新检查三个终止条件。
   - **安全点 ②**：本步没有工具调用、`beforeComplete` 没要求再来、准备 `return completed` 之前，再取一次 notes——取到了就追加并 `continue`。
3. **任何拼装阶段异常都转成事件落盘，不穿出 runTurn**（M15 取舍-17 R1）：拼装失败的轮照常收场，下一次 submit 能跑。
4. **中断**：外部 `signal` abort → 已输出保留、工具中止、还没跑的 tool-call 配 `interruptedResult`；`error{stopReason:'interrupted', by}` 落盘；不自动续跑。

## 三个终止条件（独立计数器）

`LoopLimits`（`loop.ts`）：

| 上限 | 默认 | 触发后 |
|---|---|---|
| `maxToolCalls` | 100 | `error{recoverable:true, stopReason:'max_tool_calls'}` |
| `maxArgParseRetries` | 3 | 同一轮参数解析失败第 N+1 次终止（`'max_arg_parse_retries'`） |
| `maxWallClockMs` | 10 分钟 | 单轮墙钟超时（`'wall_clock'`） |

三个计数器是**投影**，不进事件流——进事件流的只有终止那一刻的快照（`error.counters`）。`StopReason` 全集：`completed` / `max_tool_calls` / `max_arg_parse_retries` / `wall_clock` / `stream_error` / `budget` / `interrupted`（带 `by`）。

## 为什么会这样设计

- **决策与效果分离**：kernel 的输出是事件，事件是纯数据，纯数据可断言——三层测试金字塔第一层（纯函数单测）能覆盖 70% 逻辑的原因。
- **loop 不写 store**：append-only 的保证不能被各写各的工具破坏。
- **计数是投影**：状态栏、metrics 与终止快照同源，不会出现「轨迹说 99 次、状态栏说 100 次」的对不上。
- **前缀稳定优先（M15）**：定格、遮蔽、压缩、notes 追加、指纹——全是为了同一个目标：`prompt cache` 前缀 byte 级稳定。动态内容一律走追加（`ctx.note`）而不是改写已发出的消息（INV-12(b)）。

## 相关

- 谁调用 `runTurn`：`packages/runtime/src/session.ts` 的 `DomiSession.submit`；daemon 的 `core.ts` 只做串行与事件推送。
- 分层提示词与 Soul 的动态注入：[提示词分层与 cache 边界](prompt-assembly.md)。
- 遮蔽 / 压缩 / 预算器：[压缩与 prompt cache](context-compression.md)。
- 测试：`packages/kernel/test/loop.spec.ts` 等；L1 回放跑的是**真的** `runTurn`（见[评估体系](eval.md)）。
