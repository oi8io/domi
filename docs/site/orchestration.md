# 编排：任务 · 子 agent · 计划 · 提问 · 评审

> `packages/orchestrator` + `packages/runtime/src/{subagent,plan,ask-user,task-service,review,budget}.ts` · docs/adr/020
> 对应 hermes 的 agent-loop + delegation + goals。domi 的编排是「上下文隔离的 sub-agent」形态（PRD-VISION：不做协商式多 agent）。

## 三类编排原语

| 原语 | 是什么 | 事件 |
|---|---|---|
| **任务**（DAG） | YAML 定义的依赖图，每个节点一轮独立会话 | `task.spawn`…`task.end` |
| **子 agent** | 一个 Tool：`task.spawn {goal, tools?}`，新会话跑一轮把结论交回 | `task.spawn` |
| **计划** | 任务会话里动手前的计划（`plan.update`，整份替换） | `plan.update` |

## 任务：DAG 执行循环（orchestrator 不碰 IO）

`packages/orchestrator/src/runner.ts` 的 `drive`：**读状态 → 挑下一个节点 → 落 started → 执行 → 落 done/failed → 再来**。每一步之前都重读事件，所以任何时刻被杀，重启后重放事件就知道停在哪（AC-1）。事件读写、四种节点怎么执行，全部由调用方注入（`RunnerDeps`）。

- 运行 = 一个会话（`task.start` 返回的 runId 就是会话 id，订阅它就能看到 `task.*` 事件）。
- 节点：`spec.ts` 定义 DAG（含环 → `INVALID_PARAMS`，什么都不落）；`state.ts` 的 `runState` 从事件算当前状态（`finalStatus` / `nextNode` 纯函数）。
- 重试 / 取消：`task.retry` / `task.cancel`；daemon 重启后 `resumeRuns` 接着跑。
- 定时触发（`schedule.fire`）也进任务：见[定时任务](scheduling.md)。

## 子 agent：权限收窄、上下文隔离

`runtime/src/subagent.ts`：`task.spawn {goal, tools?}` 执行时开一个新会话，**上下文与父会话完全隔离**（AC-2），用父会话收窄后的权限跑一轮（`PARENT_SCOPE_RULE`，范围是「能不能提」——子 agent 只能用父会话允许它用的能力，INV-03），把最后一段回答当作工具结果交回去。子会话的中间过程只在子会话里；父会话里留下的是 `task.spawn` 事件与这段结论。

- `MAX_SPAWN_DEPTH = 2`：最多嵌两层，再深就不给 `task.spawn` 了。
- 目标里要写清完成标准——子 agent 看不到父会话的对话（`SPAWN_PROMPT`）。
- 被拒绝时不要重试，在结论里说明还需要什么。

## 计划：任务会话的「计划必须」闸门

`runtime/src/plan.ts`（PRD-M12-004 AC-5/8/9）：

- 任务会话里，动手（只读之外的工具）之前必须先有计划，否则被 `makePlanGate` 拦（**不进权限引擎**——这不是权限决定，是纪律）。
- 计划是一个工具（`plan.update`，整份替换，同 Claude Code 的 TodoWrite）+ 一条事件（`plan.update`），**常驻上下文，重开会话从事件流恢复**。
- 审批跟确认模式走：每次都问 → 要批准；按需 → 用户说了「先别动」才要；全部放行 → 不审批。审批本身是问题框（批准 / 批准并转长任务 / 其他 = 修改意见）。
- 步骤：`id / text / status (pending | in_progress | done | skipped) / dependsOn`，1–40 步，id 唯一。plan.update 每轮现取提示词（M12-004 AC-8：一轮里计划更新了，下一次请求就要带上新的）。

## 提问：ask.user

`runtime/src/ask-user.ts`（PRD-M12-004 AC-7，形态照 Claude Code 的 AskUserQuestion）：

- 一次 1–4 题，每题 2–4 个选项 + 用户自己写；多端同一个状态机（Web 多 tab、TUI a–d + 其他、核对页提交）。
- 它是「和用户说话」，不碰外部世界：runtime 内置放行（`INTRINSIC_RULES`），不进危险清单。
- 走询问通道（`ctx.elicit`）：form 带扩展键，认识的端画多 tab，不认识的端按普通表单降级。

## 评审与预算

- `review.ts`：`review.start` / `review.findings` —— 把一段事件交给模型出评审报告（`makeReviewReportTool` / `reviewPrompt`），评审会话由 runtime-host 直接发起（不经过 core 的 ActiveTurn，`session.note` 对它回 `SESSION_BUSY`）。
- `budget.ts`：`budget.warn` / `budget.decided` —— 用量 / 花费 / 工具调用数的上限（M7-009），触发 `error{stopReason:'budget'}`。

## 相关

- 子 agent 是 Tool 的证据：[工具与权限运行时](tools-runtime.md)（INV-05：Tool 是唯一执行原语）。
- 任务事件与 RPC：`task.*` / `review.*` 见 [Domi Protocol](protocol.md)。
- 测试：`packages/orchestrator/test/`（DAG 执行、状态恢复）；`packages/runtime/test/`（spawn 权限收窄、plan 闸门、ask.user 状态机）。
