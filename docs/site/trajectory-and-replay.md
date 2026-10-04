# 轨迹与回放

> `packages/trace` + `packages/eval` 的 L1 —— 轨迹是事件流的渲染，回放是事件流的第二次消费（INV-13）。
> 对应 hermes 的 trajectory-format + 部分 gateway 回放能力；domi 把它做成了一等公民：**轨迹与评估是一体两面**。

## 轨迹 = 事件流的渲染，不是另做 tracing

事件流里每一条 `model.reason`（思维链）、`tool.call` / `tool.result`、`permission`、`error` 都是轨迹的一节。渲染层只是把事件按轮分组、打标签、给序号：

- `packages/trace/src/text.ts` —— 纯文本轨迹（`domi trace <id>`）
- `packages/trace/src/html.ts` —— HTML 轨迹（`domi trace <id> --html <路径>`，可交互）
- `packages/trace/src/model.ts` —— 轨迹的节点模型（用户 / 模型 / 工具 / 权限 / 上下文 / 错误六类标签）

Web 端「轨迹」页（Trajectory tab）用同一份模型：按轮分组、六类标签、Turns / Calls 过滤、搜索、时间线（PRD-M8-008 AC-3）。TUI 的 `domi trace` CLI 与 `--html` 输出同源。

**埋点必须第一天就做**（PRD-VISION §3 的「轨迹显示」）：`model.reason` 与 `tool.*` 事件从 M0 就埋，后补代价极大。

## 回放：真实会话 = 测试 fixture

事件流可回放 ⟹ 真实会话可以当作测试 fixture 重放。这就是 L1（`packages/eval/src/replay.ts`）：

- **回放的是模型与工具，跑的是真的 kernel**：真的 `buildContext`、真的 `runTurn`、真的终止条件、真的事件流。所以它能抓到「改了 prompt 之后工具调用顺序变了」这类回归。
- **不花钱、不联网、可进 CI**（INV-08）。回放期间任何出站调用都让测试失败（`assertNoNetwork`，AC-3 要求无网络环境下通过）。
- fixture 存**模型的原始 SSE 响应流**，不是最终结果——tool 执行、权限检查、事件生成、压缩触发全都还在真实跑，只有「模型推理」这一步被固定住（`fixtures/sessions/`，跟着代码进版本库，是测试资产不是用户数据）。
- 判据是「工具调用序列 + 事件流等价」：从第几次调用开始对不上，给出 `Divergence{index, expected, actual, seq}`——seq 能直接跳到轨迹面板的对应节点。

录制：`domi eval record <sessionId>`（数据来源只有事件流，不新增埋点，INV-13）。

## 轨迹数据的组织

- `fixtures/events/legacy-v*.jsonl` —— 历史事件流 fixture：每次 `SCHEMA_VERSION` 升版补一份，保证旧事件永远可解析（INV-01 的机器验证）。
- 分页 / 引用 / 分支在事件里都有对应：`ctx.ref`（跨会话引用）、`parent_seq`（分支）、`paginateByTurns`（超长会话按轮切页）。

## 相关

- 事件契约：[Domi Protocol](protocol.md)
- L1 / L2 评估体系：[评估体系](eval.md)
- 状态栏指标（另一个事件流投影）：`packages/observability/src/report.ts` 与 `packages/kernel/src/metrics.ts`（`aggregate`）。
