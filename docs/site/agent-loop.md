# Agent Loop 内部机制

> `packages/kernel` —— 纯函数的 agent 循环（PRD-M0-002 · SPEC-M0-007）
> 对应协议事件：`user.input` → `model.*` → `tool.*` → `error` 收场。

## 一句话

**形状：`buildContext` → `provider.generate` → 事件落盘 → tool 执行 → 回灌 → 再来一轮。**

kernel 是 domi 里唯一「跑一轮」的地方，而且它**不碰 IO**（INV-02）。它需要的每一样东西都从 `LoopDeps` 注入：

| 端口 | 干什么 | 谁提供 |
|---|---|---|
| `sink: EventSink` | append / read / head 事件 | `@domi/store` 的 `SqliteEventLog` |
| `provider: ProviderLike` | 模型生成（流式） | `@domi/model` 的 `ModelProvider` 适配 |
| `tools: ToolRunner` | 工具 schema 与执行 | `@domi/capability` 的 `ToolRegistry` |
| `clock: Clock` | 时间（终止条件用） | 系统时钟 / 测试假时钟 |
| `policy: ContextPolicy` | 拼上下文的策略（分页、压缩边界） | runtime |
| `refs?: RefResolver` | 跨会话引用内容 | runtime |
| `inputs?: InputResolver` | 附件 / 技能正文 | runtime |
| `prompt?: PromptParts \| fn` | 拼好的提示词（BUG-M3-015） | `@domi/prompt` |
| `beforeComplete?` | 模型要结束时问一次（M7-004） | runtime |
| `notes?: NoteSource` | 运行中补充（M13-001），只在安全点取 | daemon 的队列 |

端口接口在 `packages/kernel/src/ports.ts`。kernel 用**结构满足**而不是 import store：让 kernel 的依赖闭包里永远不出现 `bun:sqlite`。

## 三个终止条件（独立计数器）

`LoopLimits`（`loop.ts`，M10 起默认值坐实，勿回退）：

| 上限 | 默认 | 触发后 |
|---|---|---|
| `maxToolCalls` | 100 | 产出 `error{recoverable:true, stopReason:'max_tool_calls'}` |
| `maxArgParseRetries` | 3 | 同一轮参数解析失败第 N+1 次终止（`'max_arg_parse_retries'`） |
| `maxWallClockMs` | 10 分钟 | 单轮墙钟超时（`'wall_clock'`） |

三个计数器是**投影**，不进事件流——进事件流的只有终止那一刻的快照（`error.counters`）。所以轨迹里能看出「它停了」，也能看出「为什么停」。

`StopReason` 全集：`completed` / `max_tool_calls` / `max_arg_parse_retries` / `wall_clock` / `stream_error` / `budget`（用量到顶或用户选择停止）/ `interrupted`（用户中断，signal 带 `{by: 端名}`）。M13 起 `error` 事件带 `stopReason` 与可选的 `by`。

## runTurn：一轮的完整流程

`runTurn(deps, sessionId, input, signal)`（`loop.ts`）：

1. **落盘轮边界**：`user.input`（以及这句话带的 `ctx.ref` 引用、uploads / files / skills、`noteIds`）同一批 append。引用紧挨在它所属的那句话前面——轨迹里看得见是哪句话引用了什么。
2. **循环**（`for (;;)`）：
   - **安全点 ①**：外部中断检查、墙钟检查之后、`sink.read` 之前，取一次 `notes.take()`——运行中补充在此时送达（此时上一步的 `tool.result` 都已落盘，不会插进 tool_use / tool_result 之间）。
   - `buildContext(events, policy)` 投影出模型消息；`withPrompt` 拼上提示词分层（M12 起是函数，每轮现取——计划更新后下一次请求就带新的）。
   - `provider.generate` 流式产出 `model.delta` / `model.reason` / `tool-call` / `usage`，逐条落盘并**只提交意图**，不自己写 store。
   - 有 tool-call → `tools.run` 执行（权限决策先发生，见 [工具与权限运行时](tools-runtime.md)）；`tool.result`（含 `fs.snapshot` 指纹等旁路事件）统一由 loop 落盘——顺序与事务边界只由这一个地方管。
   - 参数解析失败计入重试；工具调用计数累加；每个循环开头重新检查三个终止条件。
   - **安全点 ②**：本步没有工具调用、`beforeComplete` 没要求再来、准备 `return completed` 之前，再取一次 notes——取到了就追加并 `continue`。
3. **中断**：外部 `signal` abort → 已输出保留、工具中止、还没跑的 tool-call 配 `interruptedResult`（悬空的 tool_use 会让下一轮请求被 provider 拒掉，BUG-M3-014 的教训）；`error{stopReason:'interrupted', by}` 落盘；不自动续跑。

## 拼上下文：哪些事件进上下文

`build-context.ts`（与 [架构页](architecture.md) 的 `project` 同构）：只有

- `user.input`（用户话）
- `user.note`（运行中补充，连续多条合并成一条 user 消息，前缀 `[运行中补充]`）
- `model.reason` / `model.delta`（助手侧）
- `tool.call` / `tool.result`（工具回合）
- `verify.required`（M7 运行时追加的验证提示）

进模型上下文；`permission`、`model.usage`、`ctx.*`、`memory.write`、`task.*` 等一律是轨迹，不进上下文。跨会话引用经 `refs.ts` 渲染成带标注的文本块。

## 恢复与分页

- `recovery.ts`：`recoveryEvents`——被打断 / 停止的轮如何呈现给下一次请求（`interruptedResult` / `notRunResult`）。
- `paginate.ts`：`paginateByTurns` 与 `weightLines`——超长会话按轮分页，M13 起 `user.note` 按 `user.input` 同样计行但不切轮。
- `verify.ts`：M7 的「验证提示」状态机（改完代码要跑测试确认）。

## 为什么会这样设计

- **决策与效果分离**：kernel 的输出是事件，事件是纯数据，纯数据可断言——这是三层测试金字塔第一层（纯函数单测）能覆盖 70% 逻辑的原因。
- **loop 不写 store**：append-only 的保证不能被各写各的工具破坏。
- **计数是投影**：状态栏、metrics（`metrics.ts` 的 `aggregate`）与终止快照同源，不会出现「轨迹说 99 次、状态栏说 100 次」的对不上。

## 相关

- 谁调用 `runTurn`：`packages/runtime/src/session.ts` 的 `DomiSession.submit`；daemon 的 `core.ts` 只做串行与事件推送。
- 测试：`packages/kernel/test/loop.spec.ts` 等；L1 回放跑的是**真的** `runTurn`（见[评估体系](eval.md)）。
