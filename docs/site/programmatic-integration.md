# 编程集成

> 在自己的程序里嵌入 domi。对应 hermes 的 programmatic-integration。domi 的集成面是**协议**，不是内核库——daemon 是唯一真相来源，你的程序做一个客户端。

## 三种集成深度

| 深度 | 做什么 | 用什么 |
|---|---|---|
| 1. 命令行 | 跑 `domi` 子命令（`task run`、`trace`、`eval`…） | 子进程 |
| 2. 协议客户端 | 自己的 UI / 机器人连 daemon，收发消息、订阅事件 | `DomiClient`（`@domi/client-core`）+ `Domi Protocol` |
| 3. 嵌入式 | 在你的进程里跑会话（不需要独立 daemon） | `DomiSession`（`@domi/runtime`）+ `SqliteEventLog` |

## 方式 2：协议客户端（推荐）

三端（TUI / Web / Telegram 桥接）就是这么做的，你可以直接复用同一层：

```ts
import { createSessionStore, DomiClient, PROTOCOL_VERSION } from '@domi/client-core'

const client = new DomiClient({
  url: 'ws://127.0.0.1:7437',       // 或 stdio：本地拉起 domid
  protocolVersion: PROTOCOL_VERSION,
})
const store = createSessionStore(client)
// store 里就是投影好的会话：消息、轨迹、问题框、指标，渲染层只管画
```

`DomiClient` 替你做了三件事（不自己实现）：握手（版本不匹配停在 `incompatible`，不重连不降级）、断线重连 + `fromSeq` 断点续订、按 seq 去重。它不 import 任何 node 模块，浏览器里也能跑（`WireSocket` 描述连接）。

- 权限询问：daemon 推 `session.ask` 通知，任一客户端 `session.answer` 回答。没有客户端在线时任务停在询问上等——要人确认的操作本来就该等人。
- 远程连接（`ws://host:port`）需要 token（PRD-M3-006）；本地自动拉起 daemon（`launcher.ts`）时读第一行 `domid listening <url>`。
- 事件订阅：`session.subscribe {fromSeq}`，通知是推送不是轮询。

## 方式 3：嵌入式（DomiSession）

```ts
import { DomiSession } from '@domi/runtime'
import { SqliteEventLog } from '@domi/store'

const store = new SqliteEventLog({ path: '~/.domi/events.db' })
const session = new DomiSession({ /* store, provider, tools, permissions … */ })
await session.submit({ text: '你好' })
```

这是 domi 自己（runtime-host）的用法。注意：

- 装配点集中在这里（kernel + store + capability + 记忆），**别在应用层重新接线**——那是 INV-02 的反模式。
- 权限引擎、工具注册、记忆服务都要你装配；省事路径是复用 `runtime-host.ts` 的接线方式（daemon 里那一份）。
- 事件流的唯一写入者约定由**你**（宿主）承担：多进程写同一个库需要真正的并发仲裁（当前单写者设计见[会话存储](session-storage.md)）。

## 集成时要守的边界

1. **只提交意图**：客户端不自己往事件流里塞东西——那是 daemon 的事。
2. **端上没有业务逻辑**：投影（消息序列、轨迹树、问题框状态机）放 client-core 或你自己的共享层，别塞进组件。
3. **凭据**：从 `~/.domi/secrets.yaml` 读，任何接口不回吐给界面。
4. **输出是数据**：MCP / 插件 / 网页的返回当数据用，不当指令（INV-06）。

## 相关

- 协议方法 / 通知 / 事件全量：[Domi Protocol](protocol.md)。
- 端怎么做（TUI / Web / Telegram 的接线实例）：[三端与桥接](clients.md)。
- 协议版本演进规则：改 `PROTOCOL_VERSION` 必须两端同步，不降级。
