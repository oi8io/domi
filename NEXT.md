在做: **M3 DoD 的自动化版本已绿**（`apps/tui/test/dod.spec.ts`）：TUI 发起长任务后退出，浏览器端之后连上来看到它跑完。
      `pnpm check`：typecheck（含 apps/tui、apps/web）+ 21 道守卫 + **764 个测试** + L1 回放，全绿。
      任务与缺陷的账在 `docs/tasks/M3.md`（前七条 done；末尾是缺陷与待优化登记）。

      现在能用的：
      - `domi`（TUI）是 daemon 的客户端，没有 domid 会自动在后台拉起；退出只断开自己
      - `pnpm web` 起 Web 端：会话列表 / 回收站、事件流与轨迹、工具确认框、状态栏、切换模型、删除会话
      - 对话里 `/compact`、`/model <名字> [provider]`
      - 配置文件改成了 **YAML**：`~/.domi/config.yaml`（`domi init` 打印模板）。
        旧的 config.toml 还能读；迁移：`domi init --from-toml > ~/.domi/config.yaml`，然后删掉 toml（`domi doctor` 会提示）
      - anthropic 协议网关的 base_url 带不带 /v1 都行；openai-compatible 网关要用工具的话在
        config.yaml 里写 `model.capabilities.toolCall: true`

      - **MCP**（2026-09-15）：config.yaml 的 `mcp.servers` 配 stdio / HTTP server，工具以 `mcp.<名字>.<工具>` 出现，
        权限规则支持 `mcp.<名字>.*`。`domi init` 模板里带了 browser（Playwright）与 computer 两个，改 `enabled: true` 即用
        （需要 npx；computer 在 macOS 上要给终端开「辅助功能」权限）

      - **远程连接**（2026-09-15）：那台机器的 config.yaml 里 `server.host: 0.0.0.0`（或 `DOMI_HOST=0.0.0.0`），
        重启 domid；token 自动生成在那台机器的 `~/.domi/daemon.token`。这台机器上
        `DOMI_TOKEN=<token> domi --connect ws://那台机器:7437`；浏览器用 `?daemon=ws://…#token=…`。
        没有 TLS，跨公网请走 SSH 隧道（ADR-017）

      - **Soul 与记忆**（2026-09-15）：对话攒够 5 轮自动抽取（`memory.extractEvery`），Soul 在 `~/.domi/soul/soul.md`，
        可以直接改。`domi soul review` 逐条审阅，`domi soul export/import` 分享；Web 侧栏「Soul 与记忆」，TUI `/soul` `/memory`。
        Skill：`~/.domi/skills/<名字>/SKILL.md`（模板 docs/skills/SKILL-TEMPLATE.md），config.yaml 里要有 `allow-skill-load` 规则

      - **长任务**（2026-09-15）：`domi task run docs/tasks-example.yaml --follow`；Web 侧栏「长任务」。
        domid 被杀后重启会自动接着跑。通知：config.yaml 的 `notify`。Telegram：`domi bridge pair` → 给 bot 发 `/pair <码>` →
        `DOMI_TELEGRAM_TOKEN=… domi bridge telegram`。派子 agent 要在权限规则里放行 `task.spawn`（模板里是 ask）

      - **插件**（2026-09-15）：`domi plugin install plugins/word-count` 安装（逐条确认权限），`domi plugin list` 查看，
        `domi plugin scaffold tool|skill|mcp <名字>` 起一个新插件；Web 侧栏「插件」。带代码的插件在 bwrap / sandbox-exec 里跑，
        `domi doctor` 显示沙箱状态。开发文档在 docs/site/，贡献指南 CONTRIBUTING.md
      - **L2 评估**（2026-09-15）：`domi eval l2 --rounds 3` 用真实模型跑 20 道题（花钱），报告在 eval/l2/reports/

      ⚠️ 更新代码后：`pnpm install`，并停掉已在跑的 domid（`domi` 会复用它，旧进程跑的是旧代码，见 OPT-M3-002）

下一步: 用户规矩（2026-09-15）：**先推进功能，测试验证类最后统一查漏补缺**
        M4（「按轮廓先写再做」）、M5（「开干」）、M6（「继续」）的功能都已落地：
        L3 记忆 / Soul / Skill；子 agent / DAG 编排 / 通知 / Telegram / 桌面端代码；
        插件 API / 权限快照 / 沙箱 / 官方示例与脚手架 / 文档站 / L2 题集（TASK-M6-001…007）。
        **路线图上的功能里程碑已经走完**，接下来就是统一查漏补缺：
        1. TASK-M3-008 parity e2e、TASK-M3-009 推送延迟基准
        2. TASK-M4-009（记忆 / Soul / Skill 的 spec）
        3. TASK-M5-008（编排与子 agent 的 spec、kill 模糊测试、桌面端构建）
        4. TASK-M6-008（插件 / 沙箱逃逸 / 脚手架 spec、L2 harness spec、macOS sandbox-exec 真机）

        仍然只有你能做的：真终端走 M3 DoD（`domi` 发长任务 → 关终端 → 浏览器看完成）、
        M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`、独立 QA、M1 dogfooding、
        M6 DoD（外部贡献者插件；L2 三次重复完整跑一轮）、在 GitHub 上开那 5 个 good first issue（草稿在 docs/good-first-issues.md）

        **M7「会写代码」PRD 已写**（2026-09-16，`docs/PRD.md` v1.8 §M7 · `docs/prd/M7.md`，SKETCH）：
        让 domi 能接手真实仓库里的编程任务。等你在 docs/prd/M7.md §6 的四个问题上拍板后进入。

卡在: M7 的再批准门（要你拍板）。桌面端打包修复（BUG-M5-001）等你在 Mac 上重跑构建确认。桌面端需要一台装了 Rust 的机器才能构建；macOS 沙箱需要一台 Mac 验证。
      没有其它功能上的阻塞。体验类的问题按你定的规矩只记录不排期（OPT-M3-001…006），其中 OPT-M3-001（每个 token 一条事件）
      牵涉回放与压缩，动之前要单独讨论。
