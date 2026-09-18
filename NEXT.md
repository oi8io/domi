在做: **M9 PRD 已落地**（2026-09-18）：模型探测（/v1/models）+ Provider 配置升级（厂商/协议/baseUrl/apiKey/启用/默认）+
      对话内扁平模型下拉、中英双语（UI+错误消息）、TUI 输入区（去提示/Shift+Enter/边框/滚动条）。
      状态 `PROVISIONAL`，等用户复核拍板后进 SPEC/任务拆分。文档：`docs/prd/M9.md`。

      **M8「工作台」已收口**（2026-09-18）。19 个任务全部 done，`pnpm check` 全绿：
      typecheck（apps/tui、apps/web 在内）+ **27 道守卫** + **1134 个测试**（122 个文件）+ L1 回放。
      `check-ac-coverage` 现在对 **M0 / M1 / M7 / M8** 强制（190 条 AC 全部有测试点名）。
      **路线图上九个里程碑的功能全部落地**，剩下的只有验证补齐与你那边的 DoD。
      接手材料写在 `HANDOFF.md`（新人从那份开始读）。

      现在能用的（按里程碑）：
      - **三端**：`domi`（TUI，Ink）· `pnpm web`（Web 工作台）· `domi` 子命令（CLI）；后台是 `pnpm domid`
      - **Web 工作台（M8）**：项目树与项目页、自由会话 / 任务分开、目标驱动建任务、定时任务（cron）、
        改动条与工作区自动隔离、Composer（`@` 引文件、`/` 引技能、粘贴与拖入附件、切模型）、
        设置页（通用 / 模型供应商 / 权限只读 / Soul 与记忆 / 插件 / 用量统计）、五套色板 × 深浅主题
      - **TUI（M8）**：同一套概念与配色，`p` / `s` / `t` 弹层、`/` 命令补全、启动上下文、本会话内始终允许
      - **会写代码（M7）**：编码工具集、`AGENT.md` 项目规矩、钩子、完成前验证、计划模式、
        worktree 隔离与改动审阅、代码结构理解、`domi eval mine` 出题、用量上限、`domi review`
      - **灵魂与记忆（M4）**：`~/.domi/soul/soul.md`，`domi soul review/export/import`，Skill 在 `~/.domi/skills/`
      - **长任务与编排（M5）**：`domi task run`、子 agent、DAG、通知、Telegram 桥接、桌面端
      - **插件（M6）**：`domi plugin install/list/scaffold`，bwrap / sandbox-exec 沙箱，可热启停
      - **配置**：`~/.domi/config.yaml`（YAML，ADR-014）；凭据只在 `~/.domi/secrets.yaml`，任何接口都不回吐

      ⚠️ 更新代码后：`pnpm install`（`packages/config` 新加了 `yaml` 依赖），
         并停掉已在跑的 domid（旧进程跑的是旧代码，见 OPT-M3-002）

下一步: 用户规矩不变：**先推进功能，测试验证类最后统一查漏补缺**。功能已经走完，现在全是补缺：
        1. ~~OPT-M8-001~~ —— 已做：domid 无 key 也能起，提交时报 `error.missing_credential`，Web 引导去设置页填
        2. ~~TASK-M7-011~~ —— 已做：十条 spec 补齐、M7 进了 `ACTIVE`；顺带修了 BUG-M7-001…003（见 `docs/tasks/M7.md`）
        3. **TASK-M4-009 / M5-008 / M6-008** —— 同样是各自里程碑的「验证补齐（最后做）」
        4. TASK-M3-008（parity e2e，要先决定引不引 Playwright）、TASK-M3-009（推送延迟基准）

        仍然只有你能做的：M8 DoD（连续一周只用 Web 端做日常工作）、
        **M8 逐屏截图走查**（Web 深浅 × 5 色板抽查、TUI 深浅终端，原型是 `docs/ui-redesign/`）、
        M7 DoD（两个真实仓库各一个真实编码任务 + `domi eval mine` 跑一轮）、M0 真终端走查（TASK-M0-021）、
        `pnpm bench:cache --yes`、独立 QA、M6 DoD、在 GitHub 上开那 5 个 good first issue（草稿在 `docs/good-first-issues.md`）

卡在: **仓库还没有 git remote**——137 个提交只在这一台机器上，交接前先推到远端。
      桌面端打包修复（BUG-M5-001）等你在 Mac 上重跑构建确认；桌面端要一台装了 Rust 的机器，macOS 沙箱要一台 Mac。
      M8 的逐屏截图走查这边做不了（把预览文件传到云端的通道一直报 403），只能你来。
      没有其它功能上的阻塞。体验类问题按你定的规矩只记录不排期，共 12 条 `OPT-Mx-yyy`，登记在各任务文件末尾。
