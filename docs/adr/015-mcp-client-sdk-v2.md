# 015 MCP client：用 `@modelcontextprotocol/client` 2.0.0

- 日期：2026-09-15
- 状态：已采纳（兑现 `docs/adr/010` 押后清单中的「MCP SDK 版本」；`docs/adr/011` 的重评条件已满足）

**Context**：ADR-010 记的风险是「latest 1.30.0 是旧规范，支持 2026-07-28 的 v2 仍是 beta」。
那条结论只查了 `@modelcontextprotocol/sdk` 这一个包名——**v2 拆成了 `client` / `server` / `core` 三个包**，
`@modelcontextprotocol/client@2.0.0` 已于 2026-07-27 GA，README 明写「v2 is the stable release line, implementing the 2026-07-28 MCP spec」。
ADR-011 的第二条重评条件（v2 GA）早就成立了，只是没人发现。用户 2026-09-15 的指示是「功能需求先推进」，M3 剩下的主线就是 MCP。

进 ADR 前做了一次一次性验证（代码在仓库外，已删），结论：
- **2026-07-28 的新时代握手走 HTTP**：`server/discover` 探测 → `modern 2026-07-28`；stdio 与内存传输上现有 server 仍回落到 2025 的 `initialize`。`versionNegotiation: 'auto'` 两边都能连。
- **MRTR（AC-2）是 SDK 内置的**：`tools/call` 返回 `input_required` 时，客户端用注册的 `elicitation/create` 处理器取得回答、带 `inputResponses` 自动重试；两轮追问实测通过。
- **列表缓存（AC-3）也是内置的**：server 给出 `ttlMs` / `cacheScope` 时，多个连接共用一个 `responseCacheStore`，TTL 内第二次连接不再发 `tools/list`，实测通过。
- 依赖面：`zod ^4.2.0`（与我们的 4.6.5 兼容）、`jose`、`cross-spawn`、`eventsource` 等，全是 OAuth / 传输所需，没有原生模块。

**Decision**：
- `packages/mcp` 依赖 `@modelcontextprotocol/client` **2.0.0**；测试用的 server 端依赖 `@modelcontextprotocol/server` 2.0.0（仅 devDependency）。
  这是 `PRD-VISION.md` §6 的第一类（能引用的真库就引用）：协议本身不是 domi 的差异点，自己实现只会落后于规范。
- 版本协商用 `auto`：modern 能用就用，老 server 回落，不因为对方没升级就连不上。
- **domi 自己负责的是 SDK 不管的那几件事**：
  1. 每个 server 各自连接、各自超时，一个挂了不拖别的（AC-5）；
  2. MCP 工具以 `mcp.<server>.<tool>` 注册成普通 Tool，**走同一条权限路径**，默认拒绝（INV-03）；权限规则支持 `mcp.<server>.*` 通配；
  3. HTTP server 的所有出站请求过域名白名单（AC-6，INV-11）；
  4. 工具结果里的图片 / 二进制不进事件流正文，落到 `~/.domi/blobs/`，事件里只存引用（PRD-M2-009 AC-2）；
  5. 不调用已弃用的 sampling / roots / logging（AC-4，由 `scripts/check-deprecated-mcp.ts` 在 CI 里扫 AST）。
- elicitation（server 向用户要输入）目前**一律 decline**，并在结果里说明；接到确认框是下一步，届时走 `session.ask` 同一条路。

**Consequences**：
- 换来按规范走的 MCP，且 MRTR / 缓存 / 版本协商不用自己维护。代价是多了一组来自上游的依赖，升级 v2.x 时要看它的迁移说明。
- **AC-6 只对 HTTP server 成立**。stdio server 是子进程，它自己发出去的网络请求 domi 管不到——
  要真正约束得靠进程级沙箱或出站代理，归到 M6 的插件隔离（PRD-M6-003）一起做。这个缺口记在 `docs/tasks/M3.md`，不藏。
- ADR-010 表里「MCP SDK 版本」一行由本 ADR 兑现；ADR-011 的推迟到此结束。
