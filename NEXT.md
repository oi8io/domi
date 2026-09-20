在做: **M11「会话体验深化」**：000–006 全部 done（2026-09-21 夜间自主 TDD）。
      000 自启指引 / 001 默认贴底 / 004 展开全文 / 002 浮条新消息 / 003 Web Markdown / 005 审核三档 / 006 命令指纹。
      引擎：capability/dangerous.ts + permission.check() 三档语义 + fail-closed；runtime session.ts 接 reviewMode；
      config 白名单 permissions.review；Web RuntimeTab 三档下拉 + TUI SettingsOverlay 三档。
      验证：typecheck 绿、biome/i18n/lint-tasks 绿；runtime 141/141、capability 118/118、各 Web/TUI spec 绿。
      剩 **TASK-M11-007 收口**：全量 `pnpm test` 有 ~45 个环境类 flaky（git worktree/MCP 全链路/守卫扫描，单跑全绿、全量并行才红，与 M11 无关）；
      M11 DoD（贴底/浮条/Markdown/三档确认/指纹）只有用户手测。
      阻塞同前：desktop 壳自启（ADR-021 + 无 Rust）；PRD-M11-007 TUI 中断等终止方案 S1–S4 拍板。

      **M10「会话体验与运行控制」**：000–006 全部 done（2026-09-19）。
      TASK-M10-006 收口完成：M10 进了 `check-ac-coverage` ACTIVE（224 条 AC 全点名）、协议/API 快照检查 OK
      （`config.get` 的 loop.* 是运行值，schema 未变）、`pnpm check` 最终全绿（首轮 lint 抓出 12 个 biome 格式错，已修复）。
      剩 **TASK-M10-007（DoD 验证，只有用户能做）**。
      实测反馈已修（1a5ed41e）：侧栏项目展开列表（recentTasks）空标题回退首条输入——M10-001 只改了 session.list 一条 SQL，projects.list 漏了同口径。
      另补提交 loop.ts 默认 100（81ad5dda，M10-000 欠账）。

      进 M10 前的腐蚀已清：`guard:deps` 把 `apps/web/dist` 构建产物扫进架构分析导致 no-circular 红——
      `.dependency-cruiser.cjs` 的 `options.exclude` 加了 `(^|/)dist($|/)`（Vite 产物 chunk 互引是打包器正常行为，不该被拦）。

      **M9「模型配置与体验」功能已落地**（2026-09-19）。TASK-M9-000…012 全部 done，验证已补齐（M9 进了 `check-ac-coverage` 强制范围）。
      干净副本 `pnpm check` 全绿：typecheck + lint + 22 道守卫（新增 `guard:i18n`）+ 135 个文件 1257 条测试 + L1 回放。
      （M10 基线重跑中：修复 depcruise 后需确认仍全绿）

      ⚠️ 更新代码后：`pnpm install`（去掉了 `@ai-sdk/google`），并停掉已在跑的 domid（旧进程跑的是旧代码，OPT-M3-002）

下一步: 用户规矩不变：**先推进功能，测试验证类最后统一查漏补缺**。
        1. TASK-M10-007（DoD 验证）—— M10 收尾的最后一项，只有你能做
        2. ~~TASK-M4-009 / M5-008 / M6-008~~（验证补齐）—— M10 之后
        3. TASK-M3-008（parity e2e，要先决定引不引 Playwright）、TASK-M3-009（推送延迟基准）

        只有你能做的：
        - M10 DoD：新建会话跑完第一轮看侧栏标题；设置页改 loop 上限下一轮生效；TUI 切一次语言重启看界面；长思考链两端默认折叠可展开
        - **TUI 真终端手测（M9 新增）**：fullscreen 下滚轮、PgUp/PgDn、Ctrl+Home/End、Ctrl+O 往返、窗口缩放；
          `DOMI_TUI_RENDERER=classic` 与 `tui.renderer: classic` 各进一次；iTerm2 / Terminal.app / tmux 里各看一眼
        - 切成 English 走一遍（Web 设置 › 通用 › 语言；TUI 跟 `ui.locale` 或 `LANG`）
        - M9 DoD、M8 DoD 与逐屏截图走查、M7 DoD、M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`、独立 QA、M6 DoD、
          在 GitHub 上开那 5 个 good first issue（草稿在 `docs/good-first-issues.md`）

卡在: **仓库还没有 git remote**——150 多个提交只在这一台机器上，交接前先推到远端。
      本机残留要你在 Mac 上清一次（挂载盘这边删不了）：`.git/index.lock`、`.git/HEAD.lock`、`_tmp_git_locks/`、`.*.bun-build`、`_tmp_smoke1.ts`。
      工作区里有几处**不是这边改的**本机改动没提交：`package.json`（pnpm 12.4.2、devDependencies 排序）、`pnpm-lock.yaml`、
      `packages/daemon/src/main.ts`（只是可执行位）、`demos/m0-loop.md`（**别提交**，历史上出现过真 key）。要不要留由你定。
      （`packages/kernel/src/loop.ts` 的 maxToolCalls 100 已随 TASK-M10-000 欠账补提交，不在遗留清单了。）
      体验类问题按你定的规矩只记录不排期，登记在各任务文件末尾（M9 新增 OPT-M9-001）。
