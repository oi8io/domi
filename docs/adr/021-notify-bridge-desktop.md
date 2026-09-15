# 021 通知、Telegram 桥接与桌面端的选型

- 日期：2026-09-15
- 状态：已采纳（PRD-M5-004 / 005 / 007 · 兑现 `docs/adr/010` 的 Tauri 与 Telegram 两行）

**Context**：三块都是「让长任务在人不在屏幕前时也能被看见 / 被放行」。ADR-010 押后了 Tauri 版本与 Telegram 库。

**Decision**：

**通知（M5-004）· `packages/notify`**
- 两个渠道，都在 `config.yaml` 的 `notify` 里显式开：`system: true`（macOS 用 `osascript`，Linux 用 `notify-send`，
  都没有就跳过）与 `webhook: {url}`（POST JSON）。不引库：两条命令加一个 fetch。
- 触发：运行完成、运行失败、有询问等人回答（运行会话或其节点会话里）。同一次询问只通知一次。
- payload 只有 `{kind, title, runId, nodeId?, detail}`，detail 是一句状态说明，**不带任何工具参数或结果**；
  发出前整体过一遍 `redactString`（与事件落盘同一份正则）。
- 渠道失败只记进 domid 日志，不抛：通知是旁路，不能让任务失败（AC-4）。webhook 5 秒超时。

**Telegram 桥接（M5-007）· `apps/bridge-telegram`**
- 库：**grammY 1.46.0**（钉死；2026-08-26 发布，ADR-010 的预判不变）。长轮询，不需要公网入口。
- 独立进程，经 client-core 连 domid（depcruise 规则把它算进「端」）。启动：`domi bridge telegram`。
- 绑定：`domi bridge pair` 生成 6 位配对码，写进 `~/.domi/bridge-telegram.json`，**5 分钟过期**、用一次作废；
  在 Telegram 里给 bot 发 `/pair <码>`，这个 chat id 进白名单。白名单之外的任何消息丢弃，并经协议记一条审计事件。
- 推送：盯住所有运行会话（`run-*`）及其节点会话；节点开始 / 结束 / 失败各一条，带会话 id 与 seq。
- 审批：询问推成带「允许 / 拒绝」按钮的消息，点击走 `session.answer {channel:'telegram'}`，
  落下的 `permission` 事件与 TUI 路径同构，只多一个 `channel` 字段（AC-3）。表单型询问在 Telegram 里只能拒绝。
- 出站文字只由 `formatBridgeMessage` 生成：标题、状态、耗时、diff 行数统计，不含任何工具参数 / 结果 / 文件内容（AC-5）。
  `scripts/check-bridge-payload.ts` 用带文件内容的事件喂它，断言输出里没有那些内容。
- bot token 放 `config.yaml` 的 `bridge.telegram.token` 或 `DOMI_TELEGRAM_TOKEN`；Telegram 不可达时指数退避（最长 60 秒）。

**桌面端（M5-005）· `apps/desktop`**
- **Tauri 2.11**（`@tauri-apps/cli` 2.11.4、`plugin-updater` 2.11.0，2026-09 的当前版本）。
  前端就是 `apps/web` 的构建产物；Rust 侧只有启动与更新检查。
- 桌面端不自己拉起 domid：拉起逻辑（锁、陈锁接管、日志）在 `packages/daemon/src/launcher.ts`，
  在 Rust 里再写一份就有了两份会漂移的实现。所以桌面端假定 domid 已在跑，连不上时页面提示「先在终端运行一次 domi」。
  以后要做到「只装桌面端也能用」，做法是把 `domi` 单二进制作为 sidecar 带上、由它拉起，而不是在 Rust 里重写。
- `scripts/check-desktop-size.ts`：`apps/desktop` 的 TS + Rust 总行数 < 500，且不依赖 kernel / store（AC-3）。
- **本机没有 Rust 工具链**：三平台构建、冒烟、更新集成测试全部是验证待办。

**Consequences**：通知与桥接都不引入新的常驻服务；桌面端是最薄的一层壳，也因此把「自动拉起 domid」留给了终端。
