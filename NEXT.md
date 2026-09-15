在做: **M3 DoD 的自动化版本已绿**（`apps/tui/test/dod.spec.ts`）：TUI 发起长任务后退出，浏览器端之后连上来看到它跑完。
      `pnpm check`：typecheck（含 apps/tui、apps/web）+ 18 道守卫 + **695 个测试** + L1 回放，全绿。
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

      ⚠️ 更新代码后：`pnpm install`，并停掉已在跑的 domid（`domi` 会复用它，旧进程跑的是旧代码，见 OPT-M3-002）

下一步: 用户规矩（2026-09-15）：**先推进功能，测试验证类最后统一查漏补缺**
        （已完成：TASK-M3-016 elicitation 接确认框；TASK-M3-014 会话分支，Web「分支」按钮 / TUI `/branch`；
          TASK-M3-010 kill -9 后打开会话自动补到一致点；TASK-M3-011 远程连接 + token，见 ADR-017；
          TASK-M3-012 跨会话引用，Web「引用这一轮」/ TUI `/ref`；TUI 会话命令 /sessions /open /new /delete /restore；
          BUG-M3-003 本轮耗时、BUG-M3-008 陈锁并发接管、BUG-M3-012 配置提示词层、BUG-M3-015 提示词从未发给模型）
        M3 缺陷登记里已没有 open 的 BUG。
        1. 进 M4（Soul）：PRD 要求先把 M4 章节从 SKETCH 重写成 COMMITTED 并过 PM 门禁——等你拍板（见「卡在」）
        2. 最后统一：TASK-M3-008 parity e2e（Playwright）；TASK-M3-009 推送延迟基准

        仍然只有你能做的：真终端走 M3 DoD（`domi` 发长任务 → 关终端 → 浏览器看完成）、
        M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`、独立 QA、M1 dogfooding

卡在: M4 的进入条件。PRD 写的是「此时 domi 已积累两个月真实使用数据，届时才知道该沉淀什么」，
      现在没有这份数据。要么按现有轮廓先写 docs/prd/M4.md（范围、不做什么、反悔条件）照做，要么先 dogfooding 一段。
      体验类的问题按你定的规矩只记录不排期（OPT-M3-001…006），其中 OPT-M3-001（每个 token 一条事件）
      牵涉回放与压缩，动之前要单独讨论。
