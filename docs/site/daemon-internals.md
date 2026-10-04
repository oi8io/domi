# daemon 内部机制

> `packages/daemon` —— 进程宿主（PRD-M3-002 / 003 / 004）
> 对应 hermes 的 gateway：客户端全部经 Domi Protocol 访问它，它是事件流的唯一写入者。

## 入口与启动顺序

`domid` 两个入口：`bun packages/daemon/src/main.ts`（开发），或单二进制里 `DOMI_INTERNAL_ROLE=daemon domi`（`launcher.ts` 拉起）。

启动顺序（`main.ts`）：

1. **先抢锁、再监听**：`acquireLock(~/.domi/domid.lock)`——两个同时启动的进程里输的那个不会先占端口才发现自己不该起（`LockHeldError` → 退出码 3）。
2. 读配置（`loadConfig`，缺 key 也照样起，OPT-M8-001）、定 domid 自己的语言（`setLocale`）、算 server 设置（端口 / host / token / allowedOrigins，`resolveServerSettings`）。
3. **先开门再连 MCP**：`McpHub` 连 server 可能要好几秒（各自超时），不能让拉起 domid 的客户端一直等；工具每轮现取，连上之后自然就有了。
4. 建 `PluginHost`（沙箱 / 无沙箱）、`RuntimeHost`（把每个 `DomiSession` 接到 core 上）、`Daemon`（core）。
5. `serveWs` 监听。**第一行 stdout 是 `domid listening <url>`**——拉起它的客户端读这一行拿地址。`DOMI_PORT=0` 时拿到真实端口后原地改写锁文件。
6. 远程可连（`DOMI_HOST=0.0.0.0`）时强制 token（PRD-M3-006）；token 不打印（这些输出会进日志）。

## core.ts：分发与串行（无传输细节）

core 进来的是 JSON-RPC 请求对象、出去的是响应对象；WS 还是 stdio 由 `transport-ws.ts` 负责。这样拆是因为**并发与顺序的正确性只能在一个地方证明**——两套传输不需要两套调度。

两条硬规则：

1. **daemon 是事件流的唯一写入者**（M3-004 AC-1）。客户端只提交意图。
2. **同一会话串行**（AC-2）。第二个请求进来不排队也不静默丢弃，直接回 `SESSION_BUSY`。

- `DaemonHost` 接口：core 只认这个接口（测试注入假的），生产实现是 `runtime-host.ts` 的 `RuntimeHost`。
- 错误翻译：只有 `SessionNotFoundError` 会翻译成 `SESSION_NOT_FOUND`；其它异常（配置坏了、库打不开）原样作为 `INTERNAL`——把一切打不开都说成「没有这个会话」，用户会去找一个本来就存在的东西。
- 会话列表变化的方法（create / delete / restore / rename / branch / toTask / task.create / review.start / schedule.runNow）之后广播 `sessions.changed`。
- **运行中补充的队列在 core**（M13，SPEC-M13-001 取舍-1）：core 为每个由它发起的轮建 `ActiveTurn { queue, ac }`。「会话忙不忙」的唯一裁判是 core 的 `this.busy`，队列要跟这个判断**原子**地一起做，否则有两个窗口会丢补充。host 自己发起的轮（评审会话、定时任务节点）没有 ActiveTurn，`session.note` 回 `SESSION_BUSY`。
- 收尾的竞态：正常收场（`stopReason === 'completed'`）时队列还有残留 → 不释放 busy，用残留开下一轮（`user.input.noteIds` 带上）；异常收场 → 清空队列并广播 `session.notes.returned`。

## runtime-host.ts：真宿主

- 每个会话一个 `DomiSession`，共用同一个 SQLite 文件（`~/.domi/events.db`）；会话列表由宿主自己的一条连接读。
- 权限询问经 core 推给客户端（`session.ask`），由任一客户端回答（`session.answer`）。没有客户端在线时任务就停在询问上等——「断开不影响任务」：执行一个需要确认的操作，本来就该等人，而不是替人答。
- `extraTools` 每轮现取：MCP 工具 + 插件工具（停用插件带的 MCP server 已连上的工具在此滤掉，启停即时生效）。
- daemon 启动后调 `resumeRuns`：没结束的编排运行接着跑（M5-003）。

## 调度器与定时任务

`scheduler.ts` + `cron.ts`：5 段 cron（分 时 日 月 周，支持 `*` `,` `-` `/` 与英文缩写；不支持 `L` `W` `#` 与秒），时区用 Intl 换算不引依赖。调度器在 domid 进程里跑，时钟与定时器都注入（测试用假时钟）；每次醒来对每个计划看「不晚于现在的最近应触发时刻」是否晚于 `last_due`，是就触发一次（错过多个周期也只补这一次）。应触发时刻之后 60 秒内算准点，超过算 `late`（domid 没开、机器睡着了）。详见[定时任务](scheduling.md)。

## 其它

- `auth.ts`：`resolveServerSettings`、远程 token、`AUDIT_SESSION_ID`、被拒连接的登记。
- `lock.ts`：锁文件（pid / port / host），`rewriteLock` 用于端口重分配。
- `transport-ws.ts`：WebSocket 传输，origin 白名单，握手后校验。
- `daemon/index.ts`：对外导出（`resolveClientToken` 等，client 端拉起 daemon 用）。

## 相关

- 协议方法由 core 分发：见 [Domi Protocol](protocol.md)。
- 会话的装配与提交：见 [Agent Loop](agent-loop.md) 与 `packages/runtime/src/session.ts`。
- 测试：`packages/daemon/test/`（core 单测、transport 测试、调度器测试）。
