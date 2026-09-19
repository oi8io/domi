# TUI ↔ Web 功能对等清单（PRD-M3-003 AC-1）

> 上位：`docs/PRD.md` PRD-M3-003 · `docs/prd/M3.md` §3
> 状态：**M9 轮**（2026-09-19；M8 轮 2026-09-18，原骨架轮 2026-09-15）。本表是 AC-1 的判据本身——AC-1 写的是「按本清单逐项断言，每项在 TUI 与 Web 各有一个 e2e 用例」。
> 所以**加一项、删一项都是改 AC**，走回写门。

## 判定规则

- 一项算「对等」，要求 **TUI e2e 与 Web e2e 两列都有用例且都绿**。只有实现、没有用例的，不算。
- 两端断言的是**同一件事**：同一份事件流 fixture 进去，两端渲染出来的 seq 序列与关键文本一致（与 AC-3 同一个判据）。
- 业务逻辑只允许在 `client-core`（AC-2，depcruise 守）。某项如果需要在 `apps/web` 里写判断才能对等，那是 `client-core` 缺东西，先补那边。
- e2e 工具：Web 用 Playwright（仍未引入，见 `docs/adr/013`）；TUI 用自己的 `apps/tui/test/render.tsx`
  （M8 里加了假 stdin 与 `press()`，Ink 的按键终于能在无 TTY 环境里驱动了——ADR-001 的退路清单第 1 条到此为止）。
- 两端在 M8 都补了渲染 / 按键级测试（`apps/web/test/*.spec.tsx`、`apps/tui/test/*.spec.tsx`），
  但它们不是 e2e：没有真浏览器、没有真终端。所以下面两列仍然是 ⬜，只更新「现状」。

## 清单

图例：✅ 有且有测试 · 🟡 有实现、缺 e2e · ⬜ 没做 · — 不适用

| # | 项 | TUI 现状 | Web 现状（骨架） | TUI e2e | Web e2e |
|---|---|---|---|---|---|
| 1 | 发送消息 | ✅ 输入框提交（`apps/tui/src/main.tsx`） | ✅ Composer：Enter 发送、Shift+Enter 换行、忙时不可点；可带附件 / 文件引用 / 技能（PRD-M8-010） | ⬜ | ⬜ |
| 2 | 流式接收 | ✅ `model.delta` 拼成一段（PRD-M0-005 AC-1） | 🟡 同一个 `client-core` 投影；经真 WebSocket 推到 store 有测试（`daemon/test/transport.spec.ts`） | ⬜ | ⬜ |
| 3 | 工具确认 | ✅ 内嵌确认框，默认拒绝；`a` 本会话始终允许（PRD-M8-016） | ✅ 内嵌确认卡，默认焦点在拒绝；可授权时多一个「本会话始终允许」 | ⬜ | ⬜ |
| 4 | 轨迹树展开 | 🟡 `domi trace <id>`（CLI 与 `--html`），不在 TUI 会话界面里 | ✅ Trajectory tab：按轮分组、六类标签、Turns / Calls 过滤、搜索、时间线（PRD-M8-008 AC-3） | ⬜ | ⬜ |
| 5 | 会话列表 | ✅ 会话弹层（`s` / `Ctrl+R`）：分组、搜索、状态点；`/sessions` 仍在 | ✅ 侧栏（自由会话）+ 项目树（任务）+ 全部会话页；未读与运行状态由 daemon 推（PRD-M8-009） | ⬜ | ⬜ |
| 6 | 会话恢复 | 🟡 对话里 `/restore <id>`；CLI `domi session restore <id>` | 🟡 回收站里点「恢复」，经 `session.restore` | ⬜ | ⬜ |
| 7 | 会话分支 | 🟡 对话里 `/branch [seq]`，不带数字从最后一条分，分完切到新会话（BUG-M3-010 已修） | 🟡 每条旁「分支」按钮，经 `session.branch`，分完打开新会话；列表里标「分支」 | ⬜ | ⬜ |
| 8 | 会话删除 | 🟡 对话里 `/delete <id>`（软删除；删的是当前会话就换一个新的） | 🟡 「删除会话」点两下，经 `session.delete`（软删除；正在处理的不许删） | ⬜ | ⬜ |
| 9 | 状态栏六项指标 | ✅ `StatusBar`（四宽度 golden）；M8 补了 turns / steps / tok/s / cache 命中 | ✅ pill 版状态栏，同一份 metrics、同样的格式化函数 | ⬜ | ⬜ |
| 10 | 模型切换 | ✅ `/model` 弹层：按 provider 分组、可搜索（PRD-M9-003）；`/model <名字> [provider]` 仍可直接切 | ✅ Composer 下拉按 provider 分组、可搜索，清单里没有的可以手填（PRD-M8-010 AC-5 · PRD-M9-003） | ⬜ | ⬜ |

「状态栏六项指标」按 PRD-M1-007 AC-1/AC-2 数：模型、累计 token（输/出/缓存读）、累计花费、本轮耗时、工具调用次数、上下文占用百分比。

## 从这张表读出来的下一轮工作

1. （metrics、询问接线、恢复 / 删除 / 切换模型、会话分支已在 2026-09-15 补上。）
2. （「本轮耗时」已补，BUG-M3-003。）
3. （TUI 的会话入口已补成斜杠命令。它们还没有 TUI 侧的 e2e——Ink 的按键在无 TTY 环境里验不了，见 ADR-001。）
4. 两端 e2e 按行补齐，每补一行在这里改一格。Web 侧等 Playwright（ADR-013）；TUI 侧现在已经有假 stdin，可以直接写。
5. M8 之后 TUI 多了三个弹层与快捷键、Web 多了项目 / 定时任务 / 设置 / 用量四块；
   这些是 Web 先行的功能，不在这张 M3 的对等表里——要不要进表是改 AC，走回写门。
