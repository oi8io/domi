在做: **M9「模型配置与体验」功能已落地**（2026-09-19）。TASK-M9-000…011 done，只剩 TASK-M9-012（验证补齐，最后做）。
      当前 `pnpm typecheck` + `pnpm guard`（lint + 22 道守卫，新增 `guard:i18n`）+ `pnpm test`（133 个文件 1242 条）全绿。

      M9 带来的（按需求）：
      - **Provider 配置（PRD-M9-002）**：每个 provider 有 `name / vendor / protocol / base_url / api_key / enabled / capabilities`，
        厂商模板（openai / anthropic / deepseek / gemini / custom）给默认协议、地址与能力；默认只有**一个模型**（`model.provider + model.name`）。
        Web「设置 › 模型供应商」增删改、启停、重新探测模型；停用的 provider 不能设成默认
      - **模型探测（PRD-M9-001）**：`/v1/models` 探测 + 缓存，失败回落到配置里写的清单；`model.list` 按 provider 分组
      - **对话内切模型（PRD-M9-003）**：Web Composer 按 provider 分组可搜索；TUI `/model` 弹层；
        会话里切过的模型重开会话还在（BUG-M9-001）；切到没 key 的 provider 不再把别家的 key 发出去（BUG-M9-002）
      - **中英双语（PRD-M9-004）**：`ui.locale: auto | zh | en`；三端界面 + daemon 错误都走文案 key，端上按自己的语言显示
      - **TUI 渲染（PRD-M9-005）**：照 Claude Code 做双渲染器——`fullscreen`（默认：备用屏、只画可见行、滚动条、
        PgUp/PgDn 半屏、Ctrl+Home/End、滚轮、「N 条新消息」、Ctrl+O 把整段对话倒进终端回滚区）/ `classic`（原生回滚）；
        非 TTY / dumb / 读屏强制 classic，fullscreen 首帧前挂了自动退回并记住。输入区去掉 `›` 与占位，上下横边框

      ⚠️ 更新代码后：`pnpm install`（去掉了 `@ai-sdk/google`），并停掉已在跑的 domid（旧进程跑的是旧代码，OPT-M3-002）

下一步: 用户规矩不变：**先推进功能，测试验证类最后统一查漏补缺**。
        1. **TASK-M9-012** —— M9 逐条 AC 写能证伪它的测试，M9 进 `check-ac-coverage` 的 `ACTIVE`，干净副本跑一遍 `pnpm check`
        2. **TASK-M4-009 / M5-008 / M6-008** —— 各自里程碑的「验证补齐（最后做）」
        3. TASK-M3-008（parity e2e，要先决定引不引 Playwright）、TASK-M3-009（推送延迟基准）

        只有你能做的：
        - **TUI 真终端手测（M9 新增）**：fullscreen 下滚轮、PgUp/PgDn、Ctrl+Home/End、Ctrl+O 往返、窗口缩放；
          `DOMI_TUI_RENDERER=classic` 与 `tui.renderer: classic` 各进一次；iTerm2 / Terminal.app / tmux 里各看一眼
        - **切成 English 走一遍**（Web 设置 › 通用 › 语言；TUI 跟 `ui.locale` 或 `LANG`）
        - M9 DoD、M8 DoD 与逐屏截图走查、M7 DoD、M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`、独立 QA、M6 DoD、
          在 GitHub 上开那 5 个 good first issue（草稿在 `docs/good-first-issues.md`）

卡在: **仓库还没有 git remote**——150 多个提交只在这一台机器上，交接前先推到远端。
      本机残留要你在 Mac 上清一次（挂载盘这边删不了）：`.git/index.lock`、`.git/HEAD.lock`、`_tmp_git_locks/`、`.*.bun-build`、`_tmp_smoke1.ts`。
      工作区里有几处**不是这边改的**本机改动没提交：`package.json`（pnpm 12.4.2、devDependencies 排序）、`pnpm-lock.yaml`、
      `packages/kernel/src/loop.ts`（`maxToolCalls` 20 → 100，会让 PRD-M0-002 AC-2 的测试红）、`packages/daemon/src/main.ts`（只是可执行位）、
      `demos/m0-loop.md`（**别提交**，历史上出现过真 key）。要不要留由你定。
      体验类问题按你定的规矩只记录不排期，登记在各任务文件末尾（M9 新增 OPT-M9-001）。
