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
| 5 | 会话列表 | 🟡 对话里 `/sessions [--all]`、`/open <id>`、`/new`；CLI 仍有 `domi session` | 🟡 侧栏列表，经 `session.list`；「显示已删除」开关 | ⬜ | ⬜ |
| 6 | 会话恢复 | 🟡 对话里 `/restore <id>`；CLI `domi session restore <id>` | 🟡 回收站里点「恢复」，经 `session.restore` | ⬜ | ⬜ |
| 7 | 会话分支 | 🟡 对话里 `/branch [seq]`，不带数字从最后一条分，分完切到新会话（BUG-M3-010 已修） | 🟡 每条旁「分支」按钮，经 `session.branch`，分完打开新会话；列表里标「分支」 | ⬜ | ⬜ |
| 8 | 会话删除 | 🟡 对话里 `/delete <id>`（软删除；删的是当前会话就换一个新的） | 🟡 「删除会话」点两下，经 `session.delete`（软删除；正在处理的不许删） | ⬜ | ⬜ |
| 9 | 状态栏六项指标 | 🟡 `StatusBar`（PRD-M1-007，颜色快照）；「本轮」段已补（BUG-M3-003） | 🟡 `StatusBar`，经 `session.metrics`，与 TUI 同样六段、同一个 `formatTokens` / `formatElapsed` | ⬜ | ⬜ |
| 10 | 模型切换 | 🟡 对话里 `/model <名字> [provider]` | 🟡 会话顶部的切换表单，显示会失去的能力；两端对话里都出现「模型切换 a → b」 | ⬜ | ⬜ |

「状态栏六项指标」按 PRD-M1-007 AC-1/AC-2 数：模型、累计 token（输/出/缓存读）、累计花费、本轮耗时、工具调用次数、上下文占用百分比。

## 从这张表读出来的下一轮工作

1. （metrics、询问接线、恢复 / 删除 / 切换模型、会话分支已在 2026-09-15 补上。）
2. （「本轮耗时」已补，BUG-M3-003。）
3. （TUI 的会话入口已补成斜杠命令。它们还没有 TUI 侧的 e2e——Ink 的按键在无 TTY 环境里验不了，见 ADR-001。）
4. 两端 e2e 按行补齐，每补一行在这里改一格。
