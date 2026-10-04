# Domi Protocol

> daemon ↔ 客户端之间的契约。**逐字段参考在 [`docs/protocol.md`](../protocol.md)（由 `scripts/gen-protocol-docs.ts` 生成，勿手改）**；本页讲约定、方法全景、事件全景与演进规则。
> 唯一契约来源：`packages/protocol/src/{rpc.ts,event.ts}`。改协议：改源码 → 升版本 → 重新生成文档 → 补 fixture，否则 `guard:api` / `guard:protocol` 会红。

## 传输与约定

- **JSON-RPC 2.0**，stdio（本地，单二进制）/ WebSocket（远程）。
- **握手必须是第一个请求**：未握手 → `NOT_HANDSHAKED`；版本不匹配 → `PROTOCOL_VERSION_MISMATCH`（双方版本号都在 `data` 里），**不降级、不重连**。
- **事件推送是通知**（没有 `id`），客户端不轮询。断线重连用 `session.subscribe` 的 `fromSeq` 断点续订。
- **daemon 是事件流的唯一写入者**，客户端只提交意图；同一会话串行，忙时回 `SESSION_BUSY`。
- 错误：`ErrorCode` 枚举（`PROTOCOL_VERSION_MISMATCH` / `UNKNOWN_METHOD` / `INVALID_PARAMS` / `SESSION_NOT_FOUND` / `SESSION_BUSY` / `NOT_HANDSHAKED` / `INTERNAL` 等）；daemon 的报错带 `messageKey` + `params`，端上按自己的语言渲染（i18n）。

## 方法全景（`METHODS` in rpc.ts）

| 组 | 方法 |
|---|---|
| 握手 | `handshake` |
| 会话 | `session.list` `session.create` `session.read` `session.submit` `session.note` `session.note.withdraw` `session.interrupt` `session.subscribe` `session.history` `session.answer` `session.compact` `session.delete` `session.restore` `session.branch` `session.rename` `session.switchModel` `session.budget` |
| 记忆 | `memory.list` `memory.search` `memory.delete` `memory.extract` |
| Soul | `soul.get` `soul.write` `soul.export` `soul.import` `soul.changes` `soul.review` `soul.update` |
| 任务 / 评审 | `task.start` `task.list` `task.get` `task.retry` `task.cancel` `task.create` `review.start` |
| 插件 | `plugin.list` `plugin.ui` |
| 项目 | `project.list` `project.create` `project.update` `project.archive` `project.resolve` |
| 定时 | `schedule.list` `schedule.create` `schedule.update` `schedule.delete` `schedule.runs` `schedule.preview` |
| 配置 / 模型 | `config.get` `config.set` `provider.vendors` `model.list` `skill.list` |
| 工作树 | `worktree.diff` `worktree.discard` `worktree.restore` `worktree.apply` |
| 其它 | `usage.summary` `fs.list` `attachment.put` `audit.record` |

通知（`NOTIFICATIONS`，daemon 主动推，客户端不轮询）：`session.events`（事件流增量推送，订阅后一次一批、seq 连续）、`session.ask`（权限询问）/ `session.askDone`（询问已被任一客户端回答，其余的据此关掉确认框）、`session.metrics`（状态栏指标，订阅时补发最近一份）、`session.busy`（忙闲变化）、`session.notes` / `session.notes.returned`（补充队列变化与退回，M13）、`sessions.changed`（列表该刷新了，500ms 合并，收到后重新 `session.list`）。

## 事件全景（`DomiEventSchema`，SCHEMA_VERSION 15）

| 组 | 事件 |
|---|---|
| 用户侧 | `user.input`（轮边界，可带 uploads / files / skills / noteIds）、`user.note`（运行中补充，M13） |
| 模型侧 | `model.request` `model.delta` `model.reason` `model.usage` `model.switch` |
| 工具侧 | `tool.call` `tool.result` `fs.snapshot`（文件写前/后指纹） `permission`（每个权限决策） `permissions.mode.switch` |
| 上下文 | `ctx.cleanup` `ctx.compact` `ctx.ref` |
| 记忆 | `memory.write`（L3 语义 / L4 Soul 的真相） |
| 任务 | `task.spawn` `task.run` `task.node` `task.resume` `task.retry` `task.end` |
| 计划 | `plan.update`（M12，现行）`plan.proposed` / `plan.decided`（不再产生，类型保留读旧会话）`mode.switch`（不再产生，保留） |
| 工作树 | `worktree.create` `worktree.discard` `worktree.restore` `worktree.apply` |
| 其它 | `snapshot` `revert`（checkpoint）`workspace.trust` `hook.run` `verify.required` `budget.warn` `budget.decided` `session.kind` `project.assign` `schedule.fire` `review.findings` `plugin.error` `error` |

**两条硬规则**（INV-01，`event.ts` 文件头）：
1. 字段只增不改不删；新增字段必须可选且有默认值。
2. 未知事件类型**降级**为 `UnknownEvent` 保留原文，绝不抛错——历史永远可解析。

事件 schema 全部用 `z.looseObject`（zod 4 里 `.passthrough()` 的替代）：**已知类型 + 未来新增字段**时字段必须留下来，否则 payload 还在磁盘上、内存里却没了——那是 INV-01 的另一种违反方式。

## 版本演进

| 版本 | 含义 | 规则 |
|---|---|---|
| `PROTOCOL_VERSION`（=1） | RPC 面 | 加方法 / 通知不用升；不兼容改动才升，且不降级兼容 |
| `SCHEMA_VERSION`（=15） | 事件面 | **新增事件类型或加字段 +1**，并追加一份 `fixtures/events/legacy-v{n}.jsonl`；删类型也不行——不再产生的类型留在联合里读旧会话；迁移只能加列 / 加表 / 加索引（`guard:migrations` 查，现有 14 条迁移） |

版本史（v1→v15）写在 `event.ts` 文件头的注释里：`fs.snapshot`（v2）→ `model.switch`（v3）→ `ctx.cleanup`（v4）→ `ctx.compact`（v5）→ `ctx.ref`（v6）→ `memory.write`（v7）→ `task.*`（v8）→ `plugin.error`（v9）→ M7 一批（v10）→ `session.kind` / `schedule.fire`（v11）→ `model.switch.provider`（v12）→ `permissions.mode.switch`（v13）→ `plan.update`（v14）→ `user.note` + `error.stopReason/by` + `user.input.noteIds`（v15）。

## 客户端侧（`packages/client-core`）

三端（TUI / Web / 桥接）共用 `DomiClient`（`client-core/src/client.ts`）：

1. **握手**：版本不匹配停在 `incompatible`，不重连、不降级——重连只会一遍遍撞同一堵墙，而用户看到的是「一直在连接中」。
2. **断线重连 + 断点续订**：每个会话记着最后收到的 seq，重连后用它续订，断开期间 daemon 上发生的事一条不漏地补回来。
3. **去重**：同一个 seq 只进一次 store——投影是追加式的，重复一次就是重复一条消息。

它必须能在浏览器里跑：**不 import 任何 node 模块，不依赖 DOM 类型**，连接用最小的 `WireSocket` 描述（浏览器 WebSocket 与 Bun WebSocket 的公共子集）。

## 改协议的完整流程

1. 改 `packages/protocol/src/rpc.ts`（方法）或 `event.ts`（事件）；事件变更按上述版本规则升 `SCHEMA_VERSION` 并补 fixture。
2. `bun run scripts/gen-protocol-docs.ts` 重新生成 `docs/protocol.md` / `docs/protocol.schema.json`；`bun run scripts/gen-api-snapshot.ts` 重新生成 `.api.md`。
3. 跑 `pnpm guard`（`guard:protocol` / `guard:api` / `guard:append-only` / `guard:migrations` 都会查）。
4. 在 `docs/tasks/M*.md` 里登记（协议改动是任务的一部分，须有 PRD 引用，INV-10）。
