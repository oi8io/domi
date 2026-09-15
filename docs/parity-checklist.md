# TUI ↔ Web 功能对等清单（PRD-M3-003 AC-1）

> 上位：`docs/PRD.md` PRD-M3-003 · `docs/prd/M3.md` §3
> 状态：**骨架轮**（2026-09-15）。本表是 AC-1 的判据本身——AC-1 写的是「按本清单逐项断言，每项在 TUI 与 Web 各有一个 e2e 用例」。
> 所以**加一项、删一项都是改 AC**，走回写门。

## 判定规则

- 一项算「对等」，要求 **TUI e2e 与 Web e2e 两列都有用例且都绿**。只有实现、没有用例的，不算。
- 两端断言的是**同一件事**：同一份事件流 fixture 进去，两端渲染出来的 seq 序列与关键文本一致（与 AC-3 同一个判据）。
- 业务逻辑只允许在 `client-core`（AC-2，depcruise 守）。某项如果需要在 `apps/web` 里写判断才能对等，那是 `client-core` 缺东西，先补那边。
- e2e 工具：Web 用 Playwright（下一轮引入，见 `docs/adr/013`）；TUI 用 `ink-testing-library`（已在用）。

## 清单

图例：✅ 有且有测试 · 🟡 有实现、缺 e2e · ⬜ 没做 · — 不适用

| # | 项 | TUI 现状 | Web 现状（骨架） | TUI e2e | Web e2e |
|---|---|---|---|---|---|
| 1 | 发送消息 | ✅ 输入框提交（`apps/tui/src/main.tsx`） | 🟡 输入框 → `session.submit`；忙时按钮禁用（渲染测试） | ⬜ | ⬜ |
| 2 | 流式接收 | ✅ `model.delta` 拼成一段（PRD-M0-005 AC-1） | 🟡 同一个 `client-core` 投影；经真 WebSocket 推到 store 有测试（`daemon/test/transport.spec.ts`） | ⬜ | ⬜ |
| 3 | 工具确认 | ✅ `ConfirmDialog`，默认拒绝（PRD-M0-003） | 🟡 `ConfirmDialog`：完整内容、拒绝在前且默认聚焦；经 `session.ask` / `session.answer` / `session.askDone` 接到 runtime（允许后文件才写下去，`daemon/test/runtime-host.spec.ts`） | ⬜ | ⬜ |
| 4 | 轨迹树展开 | 🟡 `domi trace <id>`（CLI 与 `--html`），不在 TUI 会话界面里 | 🟡 工具调用与结果配对，原生 `<details>` 折叠（渲染测试） | ⬜ | ⬜ |
| 5 | 会话列表 | 🟡 `domi session`（CLI），不在 TUI 会话界面里 | 🟡 侧栏列表，经 `session.list` | ⬜ | ⬜ |
| 6 | 会话恢复 | ⚠️ `domi session restore <id>` 只打印「已恢复」，没有调用 `SessionRepo.restore`（`packages/cli/src/run.ts`） | ⬜ 协议里还没有恢复方法 | ⬜ | ⬜ |
| 7 | 会话分支 | ⬜ store 有 lineage，没有入口 | ⬜ | ⬜ | ⬜ |
| 8 | 会话删除 | ⬜ store 有软删除，没有入口 | ⬜ 协议里还没有删除方法 | ⬜ | ⬜ |
| 9 | 状态栏六项指标 | 🟡 `StatusBar`（PRD-M1-007，颜色快照）；**缺「本轮耗时」** | 🟡 `StatusBar`，经 `session.metrics`，与 TUI 同样五段、同一个 `formatTokens`；同样缺「本轮耗时」 | ⬜ | ⬜ |
| 10 | 模型切换 | 🟡 `DomiSession.switchModel` 有，TUI 里没有入口 | ⬜ 协议里还没有切换方法 | ⬜ | ⬜ |

「状态栏六项指标」按 PRD-M1-007 AC-1/AC-2 数：模型、累计 token（输/出/缓存读）、累计花费、本轮耗时、工具调用次数、上下文占用百分比。

## 从这张表读出来的下一轮工作

1. **协议缺口先补**（改 `packages/protocol/src/rpc.ts`，`guard:protocol` 与 `guard:api` 会逼着文档与快照一起改）：
   `session.restore` / `session.branch` / `session.delete` / `session.switchModel` 四个方法。
   （`session.metrics` 与询问接线已在 2026-09-15 补上。）
2. **「本轮耗时」两端都没有**：kernel 的 `TurnResult.counters.elapsedMs` 有这个数，但没进 metrics。
   PRD-M1-007 AC-1 点了名，这是 M1 的遗留，不是 M3 的新活。
3. **TUI 也要补入口**：第 5–8、10 项目前只在 CLI 或 runtime 里，TUI 会话界面里没有。对等是双向的——
   不能因为 TUI 先出生就默认它是完整的那一边。
4. 两端 e2e 按行补齐，每补一行在这里改一格。
