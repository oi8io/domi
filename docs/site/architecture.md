# 架构

> 本页是 domi 内部结构的顶层导图：进程模型、包分层、一次提交的数据流、事件流与不变量。
> 用它定位自己在代码库里的位置，然后深入各子系统专项文档（见 [文档导航](index.md)）。

## 系统概览

```text
┌─────────────────────────────────────────────────────────────┐
│                        视图层（零业务逻辑）                    │
│  TUI (Ink)   Web (React)   Desktop (Tauri)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │  Domi Protocol
                               │  JSON-RPC 2.0 over stdio / WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                        domid（唯一真相来源）                   │
│  packages/daemon                                           │
│  ├─ core.ts          JSON-RPC 分发、会话串行、事件唯一写入者    │
│  ├─ runtime-host.ts  把 runtime 的 DomiSession 接到 core 上   │
│  ├─ scheduler/cron   定时任务                                │
│  └─ transport-ws     传输层（谁搬字节不归 core 管）            │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                      packages/runtime（门面）                │
│  DomiSession：kernel + store + capability + 记忆的装配点      │
│  子 agent · 计划 · 提问 · 评审 · 工作树 · 项目 · 记忆服务       │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼───────┐  ┌──────────────────────────────────┐
│ kernel（纯函数，零 IO） │  │ store（SQLite 事件流，唯一写入在  │
│ loop / buildContext / │  │ daemon；FTS5、语义表都是投影）      │
│ 终止条件 / 恢复        │  │  ┌───────────────────────────────┐ │
└───────────────────────┘  │  │ memory / model / prompt /     │ │
                           │  │ capability / mcp / plugin /   │ │
                           │  │ orchestrator / checkpoint /   │ │
                           │  │ codeintel / trace / i18n      │ │
                           │  └───────────────────────────────┘ │
                           └──────────────────────────────────┘
```

## 三条硬边界（INV-02，depcruise + 物理依赖守卫）

1. **kernel 零 IO**：不 import `apps/*`、不 import 具体存储 / 网络 / 模型 SDK。`packages/kernel/package.json` 里除了 `@domi/protocol` 一无所有——物理上装不了就写不出违规代码。它需要的一切（事件读写、工具执行、时钟）都从 [ports](agent-loop.md) 注入。
2. **三端零业务逻辑**：`apps/*` 只经 `@domi/client-core` + Domi Protocol 与 daemon 通信。投影逻辑（轨迹、问题框状态机、会话 store）一律放 `packages/client-core`。
3. **daemon 是事件流的唯一写入者**：客户端只提交意图；同一会话串行，第二个请求直接回 `SESSION_BUSY`（不排队、不静默丢弃）。

## 包结构

```
packages/
├── protocol      事件 / RPC / 问题的契约（zod），唯一的契约来源
├── kernel        纯函数 agent loop：拼上下文、跑一轮、终止条件、恢复
├── runtime       门面：DomiSession、子 agent、计划、评审、记忆服务、工作树
├── daemon        进程宿主：core、runtime-host、调度器、传输、锁、鉴权
├── capability    Tool 注册表、权限引擎、内置工具、Skill 注册表
├── store         SQLite 事件流、迁移、搜索、语义投影、日程
├── memory        压缩、清理、语义抽取、Soul（全是纯函数）
├── model         ModelProvider 接口、AI SDK 适配、能力矩阵、结构化输出
├── prompt        分层提示词拼装、cacheable 边界
├── plugin        插件宿主：manifest、沙箱、安装、脚手架
├── mcp           MCP hub：多 server 连接、白名单、blob 落盘
├── orchestrator  DAG 任务执行循环（不碰 IO，全部注入）
├── cli           非交互命令（doctor / init / session / trace / eval …）
├── config        配置 schema、加载、secrets、厂商模板（vendors）
├── client-core   三端共享的协议客户端：握手、断线续订、去重、投影
├── trace         轨迹的文本 / HTML / 模型渲染
├── observability 日志与状态栏指标
├── checkpoint    影子 git 仓库与回滚
├── codeintel     代码结构 / 诊断工具（M7 会写代码）
├── notify        系统通知
├── eval          L1 回放 + L2 端到端评估（可整体删除）
└── i18n          zh / en 文案（key 必须一致）

apps/
├── tui           终端 UI（Ink 7）；同一二进制经 DOMI_INTERNAL_ROLE=daemon 也可当 domid
├── web           Vite + React + Tailwind v4
└── desktop       Tauri 套壳（Web 的一个打包目标）
```

依赖方向：`protocol ← kernel ← runtime ← daemon ← apps`；`capability / store / memory / model / prompt` 从旁注入，`runtime` 是装配点。SDK 包名只允许出现在 `packages/model/src/factory.ts`，厂商知识只在 `packages/config/src/vendors.ts`（`guard:providers` 扫全仓）。

## 一次提交的数据流

1. 客户端 `session.submit {text, refs?, uploads?, files?, skills?}` → daemon `core.ts` 同步占位 busy，交给 `DomiSession.submit`。
2. `runtime/session.ts` 装配本轮：`buildContext(events, policy)` 从事件流投影出模型消息（只有 `user.input` / `user.note` / `model.reason` / `model.delta` / `tool.*` / `verify.required` 进上下文，其余是轨迹）。
3. `kernel/loop.ts` 跑 `runTurn`：`provider.generate` 流式出 `model.delta` → 逐条经 `sink.append` 落盘 → daemon 把新事件**作为通知**推给所有订阅了该会话的客户端。
4. 模型请求工具 → `capability` 的 `ToolRunner.run` 执行，权限引擎先决策（默认拒绝，决策本身就是一条 `permission` 事件）；`tool.result` 落盘后回灌上下文，再来一轮。
5. 任一终止条件触发（最多 100 次工具调用 / 3 次参数解析重试 / 10 分钟墙钟 / 用户中断），产出带 `stopReason` 的 `error` 事件收场。

事件流是 append-only 的，以上每一步都是「追加事件」，没有一步是「改历史」。压缩、分支、状态栏、轨迹、记忆、编排状态全部是这条流的**投影**。

## 目录结构

```text
domi/
├── packages/      24 个包（见上）
├── apps/          四个端
├── plugins/       官方示例插件（word-count / git-workflow / mcp-filesystem）
├── scripts/       守卫与生成脚本（guard:*，见 package.json）
├── fixtures/      历史事件流 fixture（legacy-v*.jsonl）与会话回放 fixture
├── eval/l2/       L2 评估题（task.yaml + workspace/ + check.ts）
├── docs/
│   ├── site/      本目录：开发者文档站
│   ├── protocol.md 生成的协议逐字段参考（勿手改）
│   ├── prd|spec|tasks|qa/   四层需求文档（每里程碑一册）
│   └── adr/       架构决策记录（27 份）
└── PRD-VISION.md  12 条不变量（唯一跑偏判定依据）
```

## 事件流是唯一的真相

会话不是一个消息数组，而是一串只追加的事件：`user.input`、`model.delta`、`tool.call`、`permission`、`tool.result`……
上下文、状态栏、轨迹、记忆、编排状态全部是这串事件的**投影**。压缩不删事件，只追加一条 `ctx.compact`；
分支不复制事件，只记一个父指针。

投影是纯函数。下面这段和 kernel 里拼上下文的做法同构：只有四类事件进上下文，其余是轨迹。

```ts run
import assert from 'node:assert/strict'

type Ev =
  | { t: 'user.input'; text: string }
  | { t: 'model.delta'; text: string }
  | { t: 'permission'; decision: string }
  | { t: 'model.usage'; raw: Record<string, number> }

function project(events: Ev[]): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = []
  let text = ''
  const flush = () => {
    if (text) out.push({ role: 'assistant', content: text })
    text = ''
  }
  for (const ev of events) {
    if (ev.t === 'user.input') {
      flush()
      out.push({ role: 'user', content: ev.text })
    } else if (ev.t === 'model.delta') text += ev.text
  }
  flush()
  return out
}

const msgs = project([
  { t: 'user.input', text: '你好' },
  { t: 'model.delta', text: '你' },
  { t: 'model.delta', text: '好' },
  { t: 'permission', decision: 'allow' },
  { t: 'model.usage', raw: { input_tokens: 3 } },
])
assert.deepEqual(msgs, [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好' },
])
```

## 不变量

- 事件只增不改，任何历史事件永远可解析（新增类型要升 `SCHEMA_VERSION` 并补历史 fixture）
- kernel 零 IO；三端零业务逻辑，只经协议通信
- 权限默认拒绝，每个决定都是一条事件
- Tool 是唯一的执行原语；Skill 只是文字
- 工具 / MCP / 插件 / 引用的输出是数据，不是指令

这些都有 CI 守卫，见 `package.json` 里的 `guard:*`。

## 延伸阅读

- 一轮对话的内部流程：[Agent Loop 内部机制](agent-loop.md)
- 协议方法 / 事件清单：[Domi Protocol](protocol.md)
- 各子系统：见[文档导航](index.md)
