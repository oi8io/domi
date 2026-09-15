# 017 远程连接的认证：一个共享 token，放在 WebSocket 子协议里

- 日期：2026-09-15
- 状态：已采纳（PRD-M3-006 · INV-11 · TASK-M3-011）

**Context**：PRD-M3-006 要 `domi --connect ws://host:port` 可用；默认只监听 127.0.0.1；
监听非本地地址必须显式配置且强制 token 认证；无认证的连接被拒并产生事件。
客户端有三个：TUI（Bun）、Web（浏览器）、将来的桥接。浏览器的 `WebSocket` **不能设请求头**。

**Decision**：
- **单个共享 token**，不做用户体系。domi 是一个人的工具；多人共用一个 daemon 不在 v1 的问题里。
- **来源顺序**：`DOMI_TOKEN` → `config.yaml` 的 `server.token` → `~/.domi/daemon.token`。
  监听非回环地址而前两者都没有时，domid **自己生成**一个（32 字节 base64url）写进那个文件，权限 0600。
  「忘了配 token」既不该变成裸奔，也不该变成起不来。token 至少 24 个字符。
- **线上形状**：`Sec-WebSocket-Protocol: domi, domi-token.<token>`，服务端只回 `domi`，不回显 token。
  浏览器只能在这里带凭据；放查询串的话 token 会进反向代理日志和浏览器历史。
  命令行客户端也可以用 `Authorization: Bearer <token>`，服务端两者都认。
- **在升级之前校验**，常数时间比较。没过 → HTTP 401，连 `handshake` 都发不出来。
  配了 token 就一律校验，回环地址也一样：显式配置的意思就是要它生效。
- **有 token 时不再检查 Origin**。Origin 检查是为「没有认证的本地端口」防跨站劫持的；
  有了 token，别的网页拿不到它，而远程访问的页面本来就不是本机来源。
- **被拒的连接落成事件**：`permission{capabilityId:'daemon.connect', decision:'deny', remote, reason}`，
  写进 daemon 自己的审计会话 `_domid`（下划线开头的会话不出现在会话列表里）。
  同一来源、同一原因一分钟只记一条，扫端口的不能把审计会话刷爆。
- **`--connect` 先用普通 HTTP 敲一下门**：WebSocket 客户端看不到 401，只会看到「连接失败」；
  HTTP 请求能分清「token 不对」（401）和「对面没开」（连不上），报错里直接说该去哪拿 token。
- Web 端的 token 放在地址的 `#token=…` 里（片段不会发给服务器），读出来后立刻从地址栏抹掉。

**Consequences**：
- **没有 TLS**。token 在 `ws://` 上是明文。跨不可信网络请走 SSH 隧道或反向代理的 `wss://`；
  domid 自己不做证书管理。这是已知边界，不是遗漏。
- token 泄露后的处置是换 token（改配置或删掉 daemon.token 后重启 domid）；没有吊销列表。
- 以后要做多用户或按客户端授权，替换的是「token → 身份」这一步，线上形状（子协议）可以不变。
