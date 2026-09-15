# 012 Domi Protocol 传输：Bun 原生 WebSocket，不引库

- 日期：2026-09-15
- 状态：已采纳（补 `docs/adr/010` 押后清单中的「Domi Protocol 传输细节」）

**Context**：`DESIGN.md` §5 定了方向（JSON-RPC 2.0 over stdio / WebSocket），`docs/adr/010` 把「用不用现成库」押到 PRD-M3-001 时再定，前提是协议条目稳定。M3-001 已做完：7 个方法、3 个通知，全部由 zod 方法表定义并生成文档。

**Decision**：WebSocket 传输用 `Bun.serve` 自带的 WebSocket（`packages/daemon/src/transport-ws.ts`），**不引 `ws` 也不引任何 JSON-RPC 库**。stdio 传输推后，到有客户端需要时再加（届时同样只写一层搬运）。

理由：
- 现成 JSON-RPC 库提供的是**方法注册、参数校验、错误码**——这三样在 domi 里已经由 zod 方法表与 `Daemon.handle` 做了，而且必须由它们做（文档与 JSON Schema 从同一张表生成，见 `guard:protocol`）。引库等于再养一份平行的方法表。
- 传输层在这里只有「解析一帧 → 交给 core → 序列化回去」，约 40 行。并发与顺序的正确性全在 core，已有测试证明；传输层越薄，需要另证的东西越少。
- Bun 的 WebSocket 是运行时自带的，零新增依赖；浏览器端直接用标准 `WebSocket`，`client-core` 里用一个最小接口 `WireSocket` 描述它，两边都满足。

两条随传输一起落地的本地边界（都是结构性的，不靠配置）：
1. 只监听回环地址；非回环地址**直接拒绝**，直到 PRD-M3-006 的 token 认证做完（AC-2 要求非本地必须强制认证）。
2. 带 `Origin` 头的升级请求，来源必须是 `localhost` / `127.0.0.1` / `[::1]`，否则 403——没有认证的本地 WebSocket，任何网页都能从用户浏览器里连上来。

**Consequences**：换来零依赖、一张方法表、一层很薄的传输。代价是断线心跳、背压、消息大小限制这些库会顺手给的东西要自己加；目前都没加。

**触发重新决策的条件**：出现需要 stdio 与 WS 之外的第三种传输（比如 Tauri IPC），或者消息量大到需要背压控制时，再评估是否换成带这些能力的库——届时换的也只是 `transport-*.ts`，core 与方法表不动。
